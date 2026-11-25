import { useRef, useState } from 'react'
import {
  defaultParamValues,
  findModel,
  MODEL_CATALOG,
  MODEL_CATALOG_CHECKED_AT,
  paramsFor,
  reconcileParams,
  type ModelKind,
  type ParamSpec,
} from '../domain/modelCatalog'
import { customParamsError, defaultBaseUrl } from '../domain/providerFunctions'
import type { ProviderApiFormat, ProviderModelConfig } from '../domain/types'

const apiFormatLabels: Record<ProviderApiFormat, string> = {
  openai: 'OpenAI-compatible',
  gemini: 'Gemini',
}

const CUSTOM_MODEL = '__custom__'

const formatValue = (value: string | number | boolean | undefined) => (value === undefined ? 'unset' : String(value))

/**
 * Model, API format, the model's own parameters (from the capability catalog), custom JSON parameters and the
 * connection. Switching model or format keeps what the new one supports and says what was reset.
 */
export function ProviderModelSettings<T extends ProviderModelConfig>({
  kind,
  config,
  onChange,
  label,
}: {
  kind: ModelKind
  config: T
  onChange: (next: T) => void
  /** Prefix for accessible names, e.g. "Image" or "LLM". */
  label: string
}) {
  const [resetNotice, setResetNotice] = useState<string[]>([])
  // Opens by itself when the key is missing; afterwards the user decides (typing the key must not collapse it).
  const [connectionOpen, setConnectionOpen] = useState(() => !config.apiKey.trim())
  // The typed model ID applies (format + parameters) when the field is left, not on every keystroke.
  const modelAtFocus = useRef(config.model)
  const entry = findModel(kind, config.model)
  const { params: specs, known } = paramsFor(kind, config.model, config.apiFormat)
  const catalogModels = MODEL_CATALOG.filter((model) => model.kind === kind)
  const customError = customParamsError(config)

  /** `previousModel`: the model the parameters were chosen for (the typed ID is already in `config` on blur). */
  const switchTo = (patch: Partial<ProviderModelConfig>, previousModel = config.model) => {
    const next = { ...config, ...patch }
    const previousSpecs = paramsFor(kind, previousModel, config.apiFormat).params
    // A Base URL left at the old format's default follows the format.
    if (patch.apiFormat && patch.apiFormat !== config.apiFormat && next.baseUrl.trim().replace(/\/+$/, '') === defaultBaseUrl(config.apiFormat)) {
      next.baseUrl = ''
    }
    const nextSpecs = paramsFor(kind, next.model, next.apiFormat).params
    const reconciled = reconcileParams(nextSpecs, config.params ?? {})
    next.params = { ...defaultParamValues(nextSpecs), ...reconciled.values }
    // Only choices the user made are worth a notice; values meaning "model default" were never sent anyway.
    const previousSpec = (id: string) => previousSpecs.find((spec) => spec.id === id)
    const madeChoice = (id: string, value: string | number | boolean) => {
      const spec = previousSpec(id)
      return !spec || (spec.default !== value && !(spec.omitValues ?? []).includes(value as string | number))
    }
    setResetNotice(
      reconciled.changed
        .filter((change) => madeChoice(change.id, change.from))
        .map((change) => {
          const name = previousSpec(change.id)?.label ?? change.label
          return change.to === undefined
            ? `${name}: ${formatValue(change.from)} is not available for this model, so it is no longer sent`
            : `${name}: ${formatValue(change.from)} is not supported, reset to ${formatValue(change.to)}`
        }),
    )
    onChange(next)
  }

  const changeModel = (model: string, previousModel = config.model) => {
    const catalogEntry = findModel(kind, model)
    switchTo({ model, ...(catalogEntry ? { apiFormat: catalogEntry.apiFormat } : {}) }, previousModel)
  }

  const setParam = (spec: ParamSpec, value: string) => {
    const params = { ...config.params }
    if (value === '') delete params[spec.id]
    else params[spec.id] = spec.kind === 'number' ? Number(value) : value
    onChange({ ...config, params })
  }

  let host = config.baseUrl.trim() || defaultBaseUrl(config.apiFormat)
  try {
    host = new URL(host).host
  } catch {
    // Show the raw value while the user is still typing a URL.
  }

  return (
    <div className="provider-model-settings">
      <div className="function-run-provider-fields provider-model-fields">
        <label>
          <span>Model</span>
          <select
            aria-label={`${label} model list`}
            value={entry ? entry.id : CUSTOM_MODEL}
            onChange={(event) => {
              if (event.target.value !== CUSTOM_MODEL) changeModel(event.target.value)
            }}
          >
            {(['openai', 'gemini'] as const).map((format) => (
              <optgroup key={format} label={`${apiFormatLabels[format]} API`}>
                {catalogModels
                  .filter((model) => model.apiFormat === format)
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.status === 'current' ? '' : ` (${model.status})`}
                    </option>
                  ))}
              </optgroup>
            ))}
            <option value={CUSTOM_MODEL}>Custom model ID…</option>
          </select>
        </label>
        <label>
          <span>Model ID</span>
          <input
            aria-label={`${label} model`}
            value={config.model}
            placeholder="Any model ID your endpoint accepts"
            onChange={(event) => onChange({ ...config, model: event.target.value })}
            onFocus={() => {
              modelAtFocus.current = config.model
            }}
            onBlur={(event) => {
              if (event.target.value.trim() !== modelAtFocus.current) changeModel(event.target.value.trim(), modelAtFocus.current)
            }}
          />
        </label>
        <label>
          <span>API format</span>
          <select
            aria-label={`${label} API format`}
            value={config.apiFormat}
            onChange={(event) => switchTo({ apiFormat: event.target.value as ProviderApiFormat })}
          >
            {(['openai', 'gemini'] as const).map((format) => (
              <option key={format} value={format}>
                {apiFormatLabels[format]}
              </option>
            ))}
          </select>
        </label>
        <p className="provider-model-status function-run-provider-wide" role="note">
          {known && entry ? (
            <>
              <strong>{entry.label}</strong>
              {entry.status !== 'current' ? <em className={`provider-model-badge is-${entry.status}`}>{entry.status}</em> : null}
              <span>
                {apiFormatLabels[entry.apiFormat]} API · parameters from the official docs, checked {MODEL_CATALOG_CHECKED_AT}
                {entry.maxInputImages ? ` · up to ${entry.maxInputImages} reference images` : ''}
              </span>
              {entry.note ? <span className="provider-model-note">{entry.note}</span> : null}
              <span className="provider-model-sources">
                Sources:{' '}
                {entry.sources.map((source, index) => (
                  <a key={source} href={source} target="_blank" rel="noreferrer">
                    [{index + 1}]
                  </a>
                ))}
              </span>
            </>
          ) : entry ? (
            <span>
              The catalog lists {entry.label} for the {apiFormatLabels[entry.apiFormat]} API; with the{' '}
              {apiFormatLabels[config.apiFormat]} format only common parameters are offered.
            </span>
          ) : (
            <span>
              Not in the catalog: capabilities unknown, so only common {apiFormatLabels[config.apiFormat]} parameters are
              offered. Anything else goes in custom parameters.
            </span>
          )}
        </p>
        {resetNotice.length ? (
          <div className="dialog-note is-warning function-run-provider-wide provider-model-reset" role="status">
            <span>Switched model settings:</span>
            <ul>
              {resetNotice.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button type="button" aria-label="Dismiss model change notice" onClick={() => setResetNotice([])}>
              OK
            </button>
          </div>
        ) : null}
        {specs.map((spec) => {
          const value = config.params?.[spec.id]
          return (
            <label key={spec.id} title={spec.note}>
              <span>
                {spec.label}
                {spec.note ? <small className="provider-param-note">{spec.note}</small> : null}
              </span>
              {spec.kind === 'enum' ? (
                <select
                  aria-label={`${label} ${spec.label}`}
                  value={value === undefined ? '' : String(value)}
                  onChange={(event) => setParam(spec, event.target.value)}
                >
                  {spec.default === undefined ? <option value="">Not sent</option> : null}
                  {spec.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label ?? option.value}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={`${label} ${spec.label}`}
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  placeholder="Not sent"
                  value={value === undefined ? '' : String(value)}
                  onChange={(event) => setParam(spec, event.target.value)}
                />
              )}
            </label>
          )
        })}
        <label className="function-run-provider-wide">
          <span>
            Custom parameters (JSON)
            <small className="provider-param-note">
              Merged into the request body last: on a conflict these win over the parameters above.
            </small>
          </span>
          <textarea
            aria-label={`${label} custom parameters`}
            aria-invalid={customError ? true : undefined}
            rows={3}
            spellCheck={false}
            placeholder={config.apiFormat === 'gemini' ? '{"generationConfig": {"seed": 42}}' : '{"user": "my-app"}'}
            value={config.customParams ?? ''}
            onChange={(event) => onChange({ ...config, customParams: event.target.value })}
          />
          {customError ? <span className="field-error">{customError}</span> : null}
        </label>
      </div>
      <details className="dialog-advanced" open={connectionOpen} onToggle={(event) => setConnectionOpen(event.currentTarget.open)}>
        <summary>
          <span>Connection</span>
          <small>{host}</small>
          {config.apiKey.trim() ? null : <em>API key needed</em>}
        </summary>
        <div className="dialog-advanced-body function-run-provider-fields">
          <label>
            <span>API key</span>
            <input
              aria-label={`${label} API key`}
              autoComplete="off"
              type="password"
              value={config.apiKey}
              onChange={(event) => onChange({ ...config, apiKey: event.target.value })}
            />
          </label>
          <label className="provider-base-url">
            <span>Base URL</span>
            <input
              aria-label={`${label} base URL`}
              value={config.baseUrl}
              placeholder={defaultBaseUrl(config.apiFormat)}
              onChange={(event) => onChange({ ...config, baseUrl: event.target.value })}
            />
          </label>
        </div>
      </details>
    </div>
  )
}
