import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import JSZip from 'jszip'
import {
  Download,
  FileInput,
  History,
  Image as ImageIcon,
  Network,
  Plus,
  Route,
  RotateCcw,
  RotateCw,
  Settings,
  Trash2,
  Upload,
  Volume2,
  X,
  Zap,
} from 'lucide-react'
import { isBuiltInFunction } from '../domain/builtInFunctions'
import {
  isRequestFunction,
  mergedRequestConfig,
  normalizeRequestOutputForParse,
  normalizeRequestOutputsForParse,
  requestDefaultEncoding,
  requestMethods,
  requestOutputSourcesForParse,
  requestOutputTypesForParse,
  requestParseModes,
} from '../domain/requestFunction'
import { defaultOpenAILlmConfig, isOpenAILlmFunction, mergedOpenAILlmConfig } from '../domain/openaiLlm'
import { defaultGeminiLlmConfig, isGeminiLlmFunction, mergedGeminiLlmConfig } from '../domain/geminiLlm'
import { getNodeRunHistory } from '../domain/runHistory'
import { collectProjectAssetFiles, hydrateProjectAssetFiles, type ProjectAssetFileEntry } from '../domain/projectAssets'
import type {
  ComfyEndpointConfig,
  ComfyUiWorkflow,
  ComfyWorkflowEditorMetadata,
  ComfyWorkflow,
  ExecutionInputSnapshot,
  ExecutionTask,
  FunctionInputDef,
  FunctionOutputDef,
  GenerationFunction,
  GeminiLlmConfig,
  ProjectState,
  OpenAILlmConfig,
  RequestFunctionConfig,
  Resource,
  ResourceType,
} from '../domain/types'
import { comfyProxyUrl } from '../domain/comfyProxy'
import {
  exportApiWorkflowFromComfyEditor,
  exportUiWorkflowFromComfyEditor,
  loadApiWorkflowIntoComfyEditor,
  openApiWorkflowJsonFileInComfyEditor,
  openWorkflowJsonFileInComfyEditor,
} from '../domain/comfyEditorBridge'
import { projectStore, useProjectStore } from '../store/projectStore'
import { FullResourcePreviewModal } from './ResourcePreviewModal'

const resourceTypes: ResourceType[] = ['text', 'number', 'image', 'video', 'audio']
const outputSources: FunctionOutputDef['extract']['source'][] = [
  'history',
  'node_output',
  'final_images',
  'final_videos',
  'final_audios',
  'file_output',
]
const requestInputTargets: NonNullable<FunctionInputDef['bind']['requestTarget']>[] = ['url_param', 'header', 'body']

const activeTaskStatuses = new Set<ExecutionTask['status']>(['pending', 'queued', 'running', 'fetching_outputs'])

const commitActiveTextControl = () => {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    activeElement.blur()
  }
}

const mediaValue = (resource: Resource) =>
  typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value ? resource.value : undefined

const resourceLabel = (resource: Resource) => resource.name ?? resource.id

const resourceSummary = (resource: Resource) => {
  const media = mediaValue(resource)
  if (media?.filename) return media.filename
  return String(resource.value)
}

const resourceOwnerNodeId = (project: ProjectState, resource: Resource) => {
  const nodeExists = (nodeId: string | undefined) =>
    Boolean(nodeId && project.canvas.nodes.some((node) => node.id === nodeId))
  const sourceNodeId = [resource.source.resultGroupNodeId, resource.source.functionNodeId].find(nodeExists)
  if (sourceNodeId) return sourceNodeId

  const resourceNode = project.canvas.nodes.find(
    (node) => node.type === 'resource' && typeof node.data.resourceId === 'string' && node.data.resourceId === resource.id,
  )
  if (resourceNode) return resourceNode.id

  const resultNode = project.canvas.nodes.find(
    (node) =>
      node.type === 'result_group' &&
      Array.isArray(node.data.resources) &&
      node.data.resources.some(
        (ref) => typeof ref === 'object' && ref !== null && 'resourceId' in ref && ref.resourceId === resource.id,
      ),
  )
  return resultNode?.id
}

const shouldProxyMedia = (resource: Resource) => {
  const media = mediaValue(resource)
  return Boolean(media?.url && (media.comfy || resource.metadata?.endpointId))
}

function useResourceMediaSource(resource: Resource) {
  const media = mediaValue(resource)
  const key =
    media?.url && shouldProxyMedia(resource)
      ? [
          resource.id,
          media.url,
          media.comfy?.endpointId ?? resource.metadata?.endpointId ?? '',
          media.comfy?.filename ?? '',
          media.comfy?.subfolder ?? '',
          media.comfy?.type ?? '',
        ].join('|')
      : undefined
  const [objectUrl, setObjectUrl] = useState<{ key: string; url: string }>()

  useEffect(() => {
    if (!key) return undefined

    let canceled = false
    let nextObjectUrl: string | undefined
    projectStore
      .getState()
      .fetchResourceBlob(resource.id)
      .then((blob) => {
        if (canceled) return
        nextObjectUrl = URL.createObjectURL(blob)
        setObjectUrl({ key, url: nextObjectUrl })
      })
      .catch(() => {
        if (!canceled) setObjectUrl((current) => (current?.key === key ? undefined : current))
      })

    return () => {
      canceled = true
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
    }
  }, [key, resource])

  if (!media?.url) return undefined
  return key ? (objectUrl?.key === key ? objectUrl.url : undefined) : media.url
}

const endpointQueueCounts = (tasks: Record<string, ExecutionTask>) =>
  Object.values(tasks).reduce<Record<string, number>>((counts, task) => {
    if (!task.endpointId || !activeTaskStatuses.has(task.status)) return counts
    counts[task.endpointId] = (counts[task.endpointId] ?? 0) + 1
    return counts
  }, {})

const workflowNodeTitle = (id: string, workflowNode: ComfyWorkflow[string]) => workflowNode._meta?.title?.trim() || id

const workflowNodeOptions = (workflow: ComfyWorkflow) =>
  Object.entries(workflow).map(([id, workflowNode]) => ({
    id,
    title: workflowNodeTitle(id, workflowNode),
    classType: workflowNode.class_type ?? 'Unknown',
  }))

const findWorkflowNodeById = (workflow: ComfyWorkflow, value: string) => {
  const id = value.trim()
  if (!id) return undefined
  return workflowNodeOptions(workflow).find((node) => node.id === id)
}

const findWorkflowNodeByTitle = (workflow: ComfyWorkflow, value: string) => {
  const title = value.trim()
  if (!title) return undefined
  return workflowNodeOptions(workflow).find((node) => node.title === title)
}

const bindingStatus = (workflow: ComfyWorkflow, bind: { nodeId?: string; nodeTitle?: string }) => {
  const idValue = bind.nodeId?.trim() ?? ''
  const titleValue = bind.nodeTitle?.trim() ?? ''
  if (idValue) {
    return {
      idInvalid: !findWorkflowNodeById(workflow, idValue),
      titleInvalid: false,
      message: 'Workflow node not found',
    }
  }

  return {
    idInvalid: false,
    titleInvalid: Boolean(titleValue && !findWorkflowNodeByTitle(workflow, titleValue)),
    message: idValue || titleValue ? 'Workflow node not found' : undefined,
  }
}

const jsonTokenPattern =
  /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g

export function highlightedJson(value: string): ReactNode[] {
  const parts: ReactNode[] = []
  let cursor = 0

  for (const match of value.matchAll(jsonTokenPattern)) {
    const index = match.index ?? 0
    if (index > cursor) {
      parts.push(<Fragment key={`text-${cursor}-${index}`}>{value.slice(cursor, index)}</Fragment>)
    }

    const token = match[0]
    const className = match[1]
      ? 'json-key'
      : match[2]
        ? 'json-string'
        : match[3]
          ? 'json-number'
          : 'json-literal'

    parts.push(
      <span className={className} key={`${index}-${token}`}>
        {token}
      </span>,
    )
    cursor = index + token.length
  }

  if (cursor < value.length) {
    parts.push(<Fragment key={`text-${cursor}-${value.length}`}>{value.slice(cursor)}</Fragment>)
  }
  return parts
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function downloadPackage(filename: string, entries: Record<string, unknown>, files: ProjectAssetFileEntry[] = []) {
  const zip = new JSZip()
  for (const [path, value] of Object.entries(entries)) {
    zip.file(path, JSON.stringify(value, null, 2))
  }
  for (const file of files) {
    zip.file(file.path, file.blob)
  }
  downloadBlob(filename, await zip.generateAsync({ type: 'blob' }))
}

async function readPackageFile(file: File) {
  if (file.name.endsWith('.json')) {
    return JSON.parse(await file.text())
  }

  const zip = await JSZip.loadAsync(file)
  const manifestFile = zip.file('manifest.json')
  const projectFile = zip.file('project.json')
  const configFile = zip.file('config.json')
  const assetManifestFile = zip.file('config/assets.json') ?? zip.file('assets.json')
  const assetManifest = assetManifestFile ? JSON.parse(await assetManifestFile.async('text')) : undefined
  const project = projectFile ? JSON.parse(await projectFile.async('text')) : undefined
  const hydratedProject = project
    ? await hydrateProjectAssetFiles(project, assetManifest, async (assetPath) => {
        const normalizedPath = assetPath.startsWith('assets/') ? assetPath : `assets/${assetPath}`
        return (await (zip.file(normalizedPath) ?? zip.file(assetPath))?.async('blob')) ?? undefined
      })
    : undefined

  return {
    manifest: manifestFile ? JSON.parse(await manifestFile.async('text')) : undefined,
    project: hydratedProject,
    config: configFile ? JSON.parse(await configFile.async('text')) : undefined,
  }
}

function ResourceListPreview({ resource }: { resource: Resource }) {
  const label = resourceLabel(resource)
  const mediaSource = useResourceMediaSource(resource)

  if (resource.type === 'image' && mediaSource) {
    return <img className="asset-thumb-image" src={mediaSource} alt={label} />
  }

  if (resource.type === 'video' && mediaSource) {
    return <video aria-label={`${label} video preview`} className="asset-thumb-image" src={mediaSource} muted />
  }

  if (resource.type === 'audio') {
    return (
      <span className="asset-thumb-icon" aria-hidden="true">
        <Volume2 size={18} />
      </span>
    )
  }

  if (resource.type === 'image') {
    return (
      <span className="asset-thumb-icon" aria-hidden="true">
        <ImageIcon size={18} />
      </span>
    )
  }

  return <span className="asset-thumb-text">{String(resource.value).slice(0, 2) || '--'}</span>
}

function EndpointStatusList({
  endpoints,
  queueCounts,
}: {
  endpoints: ComfyEndpointConfig[]
  queueCounts: Record<string, number>
}) {
  return (
    <div className="endpoint-list" aria-label="ComfyUI server list">
      {endpoints.length > 0 ? (
        endpoints.map((endpoint) => {
          const status = endpoint.enabled ? (endpoint.health?.status ?? 'unknown') : 'disabled'
          const queueCount = queueCounts[endpoint.id] ?? 0
          return (
            <div key={endpoint.id} className="server-list-item">
              <span className={`status-dot ${status}`} />
              <span className="server-copy">
                <span title={endpoint.name}>{endpoint.name}</span>
                <small title={endpoint.baseUrl}>{endpoint.baseUrl}</small>
              </span>
              <strong>{status}</strong>
              <em>queue {queueCount}</em>
            </div>
          )
        })
      ) : (
        <div className="empty-list">No servers</div>
      )}
    </div>
  )
}

const inputSnapshotDisplayValue = (input: ExecutionInputSnapshot) => {
  if (input.value === null || input.value === undefined) return ''
  if (typeof input.value === 'object') {
    if ('filename' in input.value && input.value.filename) return input.value.filename
    return JSON.stringify(input.value, null, 2)
  }
  return String(input.value)
}

const runFinalWorkflowSnapshot = (task: ExecutionTask) => {
  if (task.compiledWorkflowSnapshot && Object.keys(task.compiledWorkflowSnapshot).length > 0) {
    return task.compiledWorkflowSnapshot
  }
  return task.requestSnapshot
}

const inputTargetNodeId = (project: ProjectState, task: ExecutionTask, input: ExecutionInputSnapshot) => {
  if (input.source === 'inline' || input.source === 'default') return task.functionNodeId
  if (!input.resourceId) return undefined

  const directResourceNode = project.canvas.nodes.find(
    (node) => node.type === 'resource' && node.data.resourceId === input.resourceId,
  )
  if (directResourceNode) return directResourceNode.id

  const resource = project.resources[input.resourceId]
  if (resource?.source.resultGroupNodeId) return resource.source.resultGroupNodeId
  if (resource?.source.functionNodeId) return resource.source.functionNodeId
  return undefined
}

function RunInspector({
  project,
  task,
  onFocusNode,
}: {
  project: ProjectState
  task: ExecutionTask
  onFocusNode: (nodeId: string) => void
}) {
  const inputs = Object.values(task.inputValuesSnapshot ?? {})
  const finalWorkflow = runFinalWorkflowSnapshot(task)
  const finalWorkflowJson = finalWorkflow ? JSON.stringify(finalWorkflow, null, 2) : ''
  const detailRows = [
    { key: 'status', label: 'Status', value: task.status },
    { key: 'created', label: 'Created', value: task.createdAt },
    { key: 'started', label: 'Started', value: task.startedAt ?? '-' },
    { key: 'completed', label: 'Completed', value: task.completedAt ?? '-' },
  ]

  return (
    <div className="run-inspector" aria-label="Run execution details">
      <h3>Run Details</h3>
      <div className="run-detail-grid">
        {detailRows.map((row) => (
          <label key={row.key} className="run-detail-field">
            <span>{row.label}</span>
            <input aria-label={`Run detail ${row.label}`} readOnly value={row.value} />
          </label>
        ))}
      </div>

      <h3>Inputs</h3>
      {inputs.length > 0 ? (
        <div className="run-input-list">
          {inputs.map((input) => {
            const targetNodeId = inputTargetNodeId(project, task, input)
            return (
              <div key={input.key} className="run-input-row">
                <div className="run-input-title-row">
                  <strong>{input.label}</strong>
                  <span>{input.required ? 'required' : 'optional'}</span>
                </div>
                <div className="run-input-meta-row">
                  <small>
                    {input.type} · {input.source}
                    {input.resourceName ? ` · ${input.resourceName}` : ''}
                  </small>
                  {targetNodeId ? (
                    <button
                      type="button"
                      className="run-input-focus-button"
                      onClick={() => onFocusNode(targetNodeId)}
                      aria-label={`Locate ${input.label} node`}
                      title={`Locate ${input.label} node`}
                    >
                      Locate node
                    </button>
                  ) : null}
                </div>
                <textarea
                  aria-label={`Input value ${input.label}`}
                  className="run-input-value"
                  readOnly
                  rows={Math.min(8, Math.max(2, inputSnapshotDisplayValue(input).split('\n').length))}
                  value={inputSnapshotDisplayValue(input)}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="inspector-empty">No captured inputs</div>
      )}

      <h3>Final Workflow</h3>
      {finalWorkflow ? (
        <pre className="run-workflow-json">
          <code>{highlightedJson(finalWorkflowJson)}</code>
        </pre>
      ) : (
        <div className="inspector-empty">No workflow snapshot</div>
      )}
    </div>
  )
}

const taskFunctionName = (project: ProjectState, task: ExecutionTask) =>
  project.functions[task.functionId]?.name ?? task.functionId

const taskServerName = (project: ProjectState, task: ExecutionTask) => {
  if (!task.endpointId) return 'Pending server'
  const endpoint = project.comfy.endpoints.find((item) => item.id === task.endpointId)
  if (endpoint) return endpoint.name
  const builtInServers: Record<string, string> = {
    openai: 'OpenAI',
    gemini: 'Gemini',
    openai_image: 'OpenAI Image',
    gemini_image: 'Gemini Image',
  }
  return builtInServers[task.endpointId] ?? task.endpointId
}

const taskTypeName = (project: ProjectState, task: ExecutionTask) => {
  const outputTypes = Object.values(task.outputRefs ?? {})
    .flat()
    .map((ref) => ref.type)
  const functionOutputTypes = project.functions[task.functionId]?.outputs.map((output) => output.type) ?? []
  const types = [...new Set([...outputTypes, ...functionOutputTypes])]
  return types.length > 0 ? types.join(', ') : 'unknown'
}

function ProjectTaskCard({
  project,
  task,
  expanded,
  onToggle,
  onFocusNode,
}: {
  project: ProjectState
  task: ExecutionTask
  expanded: boolean
  onToggle: () => void
  onFocusNode: (nodeId: string) => void
}) {
  const detailsId = `job-details-${task.id}`

  return (
    <article className={`job-card job-card-${task.status}`}>
      <button
        type="button"
        className="job-card-button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className="job-card-title-row">
          <strong>{taskFunctionName(project, task)}</strong>
          <span className={`job-status job-status-${task.status}`}>{task.status}</span>
        </span>
        <span className="job-card-meta">
          <span>
            <small>Server</small>
            <em>{taskServerName(project, task)}</em>
          </span>
          <span>
            <small>Type</small>
            <em>{taskTypeName(project, task)}</em>
          </span>
        </span>
        <code>{task.id}</code>
      </button>
      {expanded ? (
        <div id={detailsId} className="job-card-details">
          <RunInspector project={project} task={task} onFocusNode={onFocusNode} />
        </div>
      ) : null}
    </article>
  )
}

function ModalShell({
  label,
  children,
  onClose,
  modalClassName,
}: {
  label: string
  children: ReactNode
  onClose: () => void
  modalClassName?: string
}) {
  return (
    <div className="modal-backdrop">
      <div className={`manager-modal${modalClassName ? ` ${modalClassName}` : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <div className="manager-header">
          <h3>{label}</h3>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${label}`}
            onMouseDown={commitActiveTextControl}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

type FunctionManagerProps = {
  functions: GenerationFunction[]
  comfyEndpoints: ComfyEndpointConfig[]
  selectedFunctionId?: string
  allowCreate?: boolean
  allowDelete?: boolean
  onSelectFunction: (functionId: string | undefined) => void
  onAddWorkflow: (
    name: string,
    workflow: ComfyWorkflow,
    options?: { uiJson?: ComfyUiWorkflow; editor?: ComfyWorkflowEditorMetadata },
  ) => string | undefined
  onAddRequestFunction: (name: string, config: Partial<RequestFunctionConfig>) => string | undefined
  onAddOpenAIFunction: (name: string, config: Partial<OpenAILlmConfig>) => string | undefined
  onAddGeminiFunction: (name: string, config: Partial<GeminiLlmConfig>) => string | undefined
  onUpdateFunction: (functionId: string, patch: Partial<Omit<GenerationFunction, 'id' | 'createdAt'>>) => void
  onDeleteFunction: (functionId: string) => void
  onUpdateEndpoint?: (endpointId: string, patch: Partial<ComfyEndpointConfig>) => void
  onClose: () => void
}

type WorkflowJsonDraft = {
  functionId?: string
  value: string
  error?: string
}

type SearchableOption = {
  value: string
  label: string
  meta?: string
  searchText?: string
}

const normalizedSearch = (value: string) => value.trim().toLowerCase()

const optionMatches = (option: SearchableOption, query: string) => {
  const value = normalizedSearch(query)
  if (!value) return true
  return normalizedSearch(`${option.label} ${option.value} ${option.meta ?? ''} ${option.searchText ?? ''}`).includes(value)
}

function useCommittedTextDraft(value: string | number | null | undefined, onCommit: (value: string) => void) {
  const externalValue = String(value ?? '')
  const composingRef = useRef(false)
  const [draft, setDraft] = useState({
    value: externalValue,
    editing: false,
  })
  const visibleValue = draft.editing ? draft.value : externalValue

  const commit = (nextValue: string) => {
    if (composingRef.current) return
    setDraft({ value: nextValue, editing: false })
    if (nextValue !== externalValue) onCommit(nextValue)
  }

  return {
    value: visibleValue,
    begin: () =>
      setDraft((current) => ({
        value: current.editing ? current.value : externalValue,
        editing: true,
      })),
    change: (nextValue: string) => setDraft({ value: nextValue, editing: true }),
    compositionStart: () => {
      composingRef.current = true
      setDraft((current) => ({ ...current, editing: true }))
    },
    compositionEnd: (nextValue: string) => {
      composingRef.current = false
      setDraft({ value: nextValue, editing: true })
    },
    commit,
  }
}

function CommittedTextInput({
  ariaLabel,
  className,
  disabled,
  type,
  value,
  onCommit,
}: {
  ariaLabel: string
  className?: string
  disabled?: boolean
  type?: string
  value: string | number | null | undefined
  onCommit: (value: string) => void
}) {
  const draft = useCommittedTextDraft(value, onCommit)

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      type={type}
      value={draft.value}
      onBlur={(event) => draft.commit(event.currentTarget.value)}
      onChange={(event) => draft.change(event.target.value)}
      onCompositionEnd={(event) => draft.compositionEnd(event.currentTarget.value)}
      onCompositionStart={draft.compositionStart}
      onFocus={draft.begin}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

function CommittedTextarea({
  ariaLabel,
  rows,
  value,
  onCommit,
}: {
  ariaLabel: string
  rows?: number
  value: string | number | null | undefined
  onCommit: (value: string) => void
}) {
  const draft = useCommittedTextDraft(value, onCommit)

  return (
    <textarea
      aria-label={ariaLabel}
      rows={rows}
      value={draft.value}
      onBlur={(event) => draft.commit(event.currentTarget.value)}
      onChange={(event) => draft.change(event.target.value)}
      onCompositionEnd={(event) => draft.compositionEnd(event.currentTarget.value)}
      onCompositionStart={draft.compositionStart}
      onFocus={draft.begin}
    />
  )
}

function SearchableSelect({
  label,
  value,
  options,
  invalid,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  options: SearchableOption[]
  invalid?: boolean
  placeholder?: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const filteredOptions = useMemo(() => options.filter((option) => optionMatches(option, draft)).slice(0, 12), [draft, options])

  const commit = (nextValue = draft) => {
    onCommit(nextValue)
    setOpen(false)
  }

  return (
    <div className="searchable-select">
      <input
        aria-autocomplete="list"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-label={label}
        className={invalid ? 'invalid-field' : undefined}
        placeholder={placeholder}
        role="combobox"
        value={open ? draft : value}
        onBlur={() => commit()}
        onChange={(event) => {
          setDraft(event.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setDraft(value)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(filteredOptions[0]?.value ?? draft)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(value)
            setOpen(false)
          }
        }}
      />
      {open ? (
        <div className="searchable-options" role="listbox">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                aria-selected={option.label === value || option.value === value}
                className="searchable-option"
                key={`${label}_${option.value}`}
                role="option"
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  setDraft(option.label)
                  commit(option.value)
                }}
              >
                <span>{option.label}</span>
                {option.meta ? <small>{option.meta}</small> : null}
              </button>
            ))
          ) : (
            <div className="searchable-option empty-option">No matches</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

const workflowNodeSearchOptions = (workflow: ComfyWorkflow): SearchableOption[] =>
  workflowNodeOptions(workflow).map((node) => ({
    value: node.id,
    label: `${node.id} · ${node.title}`,
    meta: node.classType,
    searchText: node.title,
  }))

const bindingValueSeparator = '\u001F'

const bindingValue = (nodeId: string, path: string) => `${nodeId}${bindingValueSeparator}${path}`

const parseBindingValue = (value: string) => {
  const [nodeId, path] = value.split(bindingValueSeparator)
  if (!nodeId || !path) return undefined
  return { nodeId, path }
}

const workflowInputBindingOptions = (workflow: ComfyWorkflow): SearchableOption[] =>
  workflowNodeOptions(workflow).flatMap((node) =>
    Object.keys(workflow[node.id]?.inputs ?? {}).map((key) => ({
      value: bindingValue(node.id, `inputs.${key}`),
      label: `${node.id} · ${node.title} / inputs.${key}`,
      meta: node.classType,
      searchText: `${node.id} ${node.title} ${node.classType} ${key}`,
    })),
  )

const matchOptionValue = (options: SearchableOption[], rawValue: string) => {
  const value = rawValue.trim()
  const exact = options.find((option) =>
    [option.value, option.label].some((candidate) => normalizedSearch(candidate) === normalizedSearch(value)),
  )
  if (exact) return exact.value
  const matches = options.filter((option) => optionMatches(option, value))
  return matches.length === 1 ? matches[0]!.value : value
}

const matchWorkflowNode = (workflow: ComfyWorkflow, rawValue: string) => {
  const value = rawValue.trim()
  if (!value) return undefined
  const options = workflowNodeOptions(workflow)
  const exact = options.find((node) =>
    [node.id, node.title, `${node.id} · ${node.title}`].some((candidate) => normalizedSearch(candidate) === normalizedSearch(value)),
  )
  if (exact) return exact

  const matches = options.filter((node) =>
    normalizedSearch(`${node.id} ${node.title} ${node.classType}`).includes(normalizedSearch(value)),
  )
  return matches.length === 1 ? matches[0] : undefined
}

const nodeDisplayValue = (workflow: ComfyWorkflow, bind: { nodeId?: string; nodeTitle?: string }) => {
  const node = bind.nodeId
    ? findWorkflowNodeById(workflow, bind.nodeId)
    : bind.nodeTitle
      ? findWorkflowNodeByTitle(workflow, bind.nodeTitle)
      : undefined
  if (node) return `${node.id} · ${node.title}`
  return bind.nodeId?.trim() || bind.nodeTitle?.trim() || ''
}

const workflowBindingDisplay = (workflow: ComfyWorkflow, bind: { nodeId?: string; nodeTitle?: string; path?: string }) => {
  const node = bind.nodeId
    ? findWorkflowNodeById(workflow, bind.nodeId)
    : bind.nodeTitle
      ? findWorkflowNodeByTitle(workflow, bind.nodeTitle)
      : undefined
  if (node) return `${node.id} · ${node.title}${bind.path ? ` / ${bind.path}` : ''}`
  return bind.nodeId?.trim() || bind.nodeTitle?.trim() || ''
}

const workflowKeyFromPath = (path: string) => path.replace(/^inputs\./, '').replace(/^outputs\./, '')

const labelFromKey = (key: string) =>
  key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')

const shouldReplaceGeneratedLabel = (currentLabel: string, currentKey: string) => {
  const normalizedLabel = normalizedSearch(currentLabel)
  return (
    !normalizedLabel ||
    normalizedLabel === normalizedSearch(currentKey) ||
    normalizedLabel === normalizedSearch(labelFromKey(currentKey)) ||
    /^input \d+$/.test(normalizedLabel) ||
    /^output \d+$/.test(normalizedLabel)
  )
}

const uniqueFunctionKey = (baseKey: string, usedKeys: string[]) => {
  const normalizedBase = baseKey.trim() || 'field'
  if (!usedKeys.includes(normalizedBase)) return normalizedBase
  let suffix = 2
  while (usedKeys.includes(`${normalizedBase}_${suffix}`)) suffix += 1
  return `${normalizedBase}_${suffix}`
}

function updateInput(
  fn: GenerationFunction,
  index: number,
  patch: Partial<Omit<FunctionInputDef, 'bind'>> & { bind?: Partial<FunctionInputDef['bind']> },
  updateFunction: FunctionManagerProps['onUpdateFunction'],
) {
  const inputs = fn.inputs.map((input, inputIndex) =>
    inputIndex === index ? { ...input, ...patch, bind: { ...input.bind, ...patch.bind } } : input,
  )
  updateFunction(fn.id, { inputs })
}

function updateInputBindingSelection(
  fn: GenerationFunction,
  index: number,
  value: string,
  updateFunction: FunctionManagerProps['onUpdateFunction'],
) {
  const input = fn.inputs[index]
  const matchedValue = matchOptionValue(workflowInputBindingOptions(fn.workflow.rawJson), value)
  const binding = parseBindingValue(matchedValue)
  if (!input || !binding) {
    updateInput(fn, index, { bind: { nodeId: value.trim(), nodeTitle: '' } }, updateFunction)
    return
  }

  const node = findWorkflowNodeById(fn.workflow.rawJson, binding.nodeId)
  const workflowKey = workflowKeyFromPath(binding.path)
  const shouldReplaceKey = !input.key.trim() || /^input_\d+$/.test(input.key)
  const key = shouldReplaceKey
    ? uniqueFunctionKey(
        workflowKey,
        fn.inputs.map((item, inputIndex) => (inputIndex === index ? '' : item.key)),
      )
    : input.key
  updateInput(
    fn,
    index,
    {
      key,
      label: shouldReplaceKey || shouldReplaceGeneratedLabel(input.label, input.key) ? labelFromKey(key) : input.label,
      bind: {
        nodeId: node?.id ?? binding.nodeId,
        nodeTitle: node?.title ?? '',
        path: binding.path,
      },
    },
    updateFunction,
  )
}

function updateOutput(
  fn: GenerationFunction,
  index: number,
  patch: Partial<Omit<FunctionOutputDef, 'bind' | 'extract'>> & {
    bind?: Partial<FunctionOutputDef['bind']>
    extract?: Partial<FunctionOutputDef['extract']>
  },
  updateFunction: FunctionManagerProps['onUpdateFunction'],
) {
  const outputs = fn.outputs.map((output, outputIndex) =>
    outputIndex === index
      ? { ...output, ...patch, bind: { ...output.bind, ...patch.bind }, extract: { ...output.extract, ...patch.extract } }
      : output,
  )
  updateFunction(fn.id, { outputs })
}

function updateOutputBindingSelection(
  fn: GenerationFunction,
  index: number,
  value: string,
  updateFunction: FunctionManagerProps['onUpdateFunction'],
) {
  const output = fn.outputs[index]
  if (!output) return
  const node = matchWorkflowNode(fn.workflow.rawJson, value)
  const outputs = fn.outputs.map((item, outputIndex) =>
    outputIndex === index
      ? {
          ...item,
          bind: {
            nodeId: node ? node.id : value.trim(),
            nodeTitle: node ? node.title : '',
          },
        }
      : item,
  )
  updateFunction(fn.id, { outputs })
}

type NewFunctionType = 'comfyui' | 'request' | 'openai' | 'gemini'

const parseHeaderJson = (value: string) => {
  if (!value.trim()) return {}
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Headers must be a JSON object')
  return Object.fromEntries(Object.entries(parsed).map(([key, headerValue]) => [key, String(headerValue)]))
}

type EmbeddedComfySave = {
  rawJson: ComfyWorkflow
  uiJson?: ComfyUiWorkflow
  editor: ComfyWorkflowEditorMetadata
}

type ComfyFrameGraph = {
  getNodeById?: (id: unknown) => unknown
  _nodes?: unknown[]
  _nodes_by_id?: Record<string, unknown>
  change?: () => void
  serialize?: () => unknown
}

type ComfyFrameWindow = Window & {
  fetch: typeof fetch
  Request?: typeof Request
  Response: typeof Response
  app?: {
    graphToPrompt?: (graph?: ComfyFrameGraph) => Promise<{ output?: unknown; workflow?: unknown }> | { output?: unknown; workflow?: unknown }
    queuePrompt?: (...args: unknown[]) => Promise<unknown> | unknown
    handleFile?: (file: File, openSource?: unknown, options?: unknown) => Promise<unknown> | unknown
    loadGraphData?: (workflow: ComfyUiWorkflow) => Promise<unknown> | unknown
    loadApiJson?: (workflow: ComfyWorkflow) => Promise<unknown> | unknown
    rootGraph?: ComfyFrameGraph
    rootGraphInternal?: ComfyFrameGraph
    graph?: ComfyFrameGraph
  }
}

const isComfyWorkflowFunction = (fn: GenerationFunction) => fn.workflow.format === 'comfyui_api_json'

const endpointSupportsWorkflowFunction = (endpoint: ComfyEndpointConfig, functionId: string) => {
  const supportedFunctions = endpoint.capabilities?.supportedFunctions
  return supportedFunctions === undefined || supportedFunctions.includes(functionId)
}

const endpointFunctionScopeLabel = (endpoint: ComfyEndpointConfig, workflowFunctionIds: string[]) => {
  const supportedFunctions = endpoint.capabilities?.supportedFunctions
  if (supportedFunctions === undefined) return 'all functions'
  const visibleIds = new Set(workflowFunctionIds)
  const visibleFunctionCount = supportedFunctions.filter((id) => visibleIds.has(id)).length
  if (visibleFunctionCount === 0) return 'no functions'
  return `${visibleFunctionCount}/${workflowFunctionIds.length} functions`
}

const endpointCapabilitiesPatch = (
  endpoint: ComfyEndpointConfig,
  supportedFunctions: string[] | undefined,
): Partial<ComfyEndpointConfig> => {
  const capabilities: NonNullable<ComfyEndpointConfig['capabilities']> = { ...(endpoint.capabilities ?? {}) }
  if (supportedFunctions === undefined) delete capabilities.supportedFunctions
  else capabilities.supportedFunctions = Array.from(new Set(supportedFunctions))
  return { capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined }
}

const setEndpointFunctionAvailability = (
  endpoint: ComfyEndpointConfig,
  functionId: string,
  enabled: boolean,
  workflowFunctionIds: string[],
  onUpdateEndpoint: NonNullable<FunctionManagerProps['onUpdateEndpoint']>,
) => {
  const supportedFunctions = endpoint.capabilities?.supportedFunctions
  const explicitFunctions = supportedFunctions === undefined ? workflowFunctionIds : supportedFunctions
  const nextFunctions = enabled
    ? [...explicitFunctions, functionId]
    : explicitFunctions.filter((id) => id !== functionId)
  onUpdateEndpoint(endpoint.id, endpointCapabilitiesPatch(endpoint, nextFunctions))
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function waitForComfyFrameApp(frame: HTMLIFrameElement) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const frameWindow = frame.contentWindow as ComfyFrameWindow | null
    const app = frameWindow?.app
    if (app?.graphToPrompt) return app
    await wait(150)
  }
  throw new Error('ComfyUI editor is not ready yet')
}

function ComfyWorkflowEditorDialog({
  endpoint,
  initialUiJson,
  initialApiJson,
  onSave,
  onClose,
}: {
  endpoint?: ComfyEndpointConfig
  initialUiJson?: ComfyUiWorkflow
  initialApiJson?: ComfyWorkflow
  onSave: (value: EmbeddedComfySave) => void
  onClose: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState(endpoint ? 'Loading ComfyUI editor' : 'No ComfyUI endpoint configured')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const proxyUrl = endpoint
    ? comfyProxyUrl(endpoint.baseUrl, {
        bearerToken: endpoint.auth?.type === 'token' ? endpoint.auth.token : undefined,
      })
    : undefined

  const initializeFrame = async () => {
    if (!frameRef.current || !endpoint) return
    try {
      const app = await waitForComfyFrameApp(frameRef.current)
      if (initialUiJson && app.handleFile) {
        await openWorkflowJsonFileInComfyEditor(app, initialUiJson, 'Infinity Workflow.json')
        setStatus('Opened editable workflow through ComfyUI File Open')
      } else if (initialUiJson && app.loadGraphData) {
        await app.loadGraphData(initialUiJson)
        setStatus('Loaded editable ComfyUI workflow')
      } else if (initialApiJson && app.handleFile) {
        await openApiWorkflowJsonFileInComfyEditor(app, initialApiJson)
        setStatus('Opened API workflow through ComfyUI File Open')
      } else if (initialApiJson && app.loadApiJson) {
        await loadApiWorkflowIntoComfyEditor(app, initialApiJson)
        setStatus('Loaded API workflow into ComfyUI editor')
      } else {
        setStatus(initialUiJson ? 'ComfyUI editor ready' : 'ComfyUI editor ready. No editable UI workflow is stored yet.')
      }
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize ComfyUI editor')
    }
  }

  const saveFromComfy = async () => {
    if (!frameRef.current || !endpoint) return
    setSaving(true)
    try {
      const app = await waitForComfyFrameApp(frameRef.current)
      const frameWindow = frameRef.current.contentWindow as ComfyFrameWindow | null
      const uiJson = await exportUiWorkflowFromComfyEditor(app)
      const rawJson = await exportApiWorkflowFromComfyEditor(app, frameWindow ?? undefined)
      onSave({
        rawJson,
        uiJson,
        editor: {
          kind: 'comfyui_embedded',
          endpointId: endpoint.id,
          baseUrl: endpoint.baseUrl,
          savedAt: new Date().toISOString(),
        },
      })
      setError(undefined)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export workflow from ComfyUI')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell label="ComfyUI Workflow Editor" modalClassName="comfy-editor-modal" onClose={onClose}>
      <div className="comfy-editor-shell">
        <div className="comfy-editor-toolbar">
          <div>
            <strong>{endpoint?.name ?? 'ComfyUI'}</strong>
            <span>{endpoint?.baseUrl ?? 'Configure a ComfyUI server first'}</span>
          </div>
          <div className="comfy-editor-actions">
            <span className={error ? 'field-error' : 'comfy-editor-status'}>{error ?? status}</span>
            <button type="button" onClick={saveFromComfy} disabled={!endpoint || saving}>
              {saving ? 'Saving...' : 'Save from ComfyUI'}
            </button>
          </div>
        </div>
        {proxyUrl ? (
          <iframe
            ref={frameRef}
            title={`ComfyUI editor ${endpoint?.name ?? ''}`.trim()}
            className="comfy-editor-frame"
            src={proxyUrl}
            onLoad={() => {
              void initializeFrame()
            }}
          />
        ) : (
          <div className="comfy-editor-empty">No ComfyUI endpoint is available.</div>
        )}
      </div>
    </ModalShell>
  )
}

function NewFunctionDialog({
  onSaveComfy,
  onSaveRequest,
  onSaveOpenAI,
  onSaveGemini,
  onBindComfyEndpoint,
  comfyEndpoints,
  onClose,
}: {
  onSaveComfy: (
    name: string,
    workflow: ComfyWorkflow,
    options?: { uiJson?: ComfyUiWorkflow; editor?: ComfyWorkflowEditorMetadata },
  ) => string | undefined
  onSaveRequest: (name: string, config: Partial<RequestFunctionConfig>) => string | undefined
  onSaveOpenAI: (name: string, config: Partial<OpenAILlmConfig>) => string | undefined
  onSaveGemini: (name: string, config: Partial<GeminiLlmConfig>) => string | undefined
  onBindComfyEndpoint?: (functionId: string, endpointId: string) => void
  comfyEndpoints: ComfyEndpointConfig[]
  onClose: () => void
}) {
  const [functionType, setFunctionType] = useState<NewFunctionType>('comfyui')
  const [functionName, setFunctionName] = useState('')
  const [workflowRawJson, setWorkflowRawJson] = useState<ComfyWorkflow>()
  const [workflowUiJson, setWorkflowUiJson] = useState<ComfyUiWorkflow>()
  const [workflowEditor, setWorkflowEditor] = useState<ComfyWorkflowEditorMetadata>()
  const [comfyEditorOpen, setComfyEditorOpen] = useState(false)
  const [requestUrl, setRequestUrl] = useState('https://example.com/api')
  const [requestMethod, setRequestMethod] = useState('GET')
  const [requestHeaders, setRequestHeaders] = useState('{\n}')
  const [requestBody, setRequestBody] = useState('')
  const [responseParse, setResponseParse] = useState<RequestFunctionConfig['responseParse']>('json')
  const [responseEncoding, setResponseEncoding] = useState(requestDefaultEncoding)
  const defaultOpenAIConfig = useMemo(() => defaultOpenAILlmConfig(), [])
  const defaultGeminiConfig = useMemo(() => defaultGeminiLlmConfig(), [])
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState(defaultOpenAIConfig.baseUrl)
  const [openAiApiKey, setOpenAiApiKey] = useState(defaultOpenAIConfig.apiKey)
  const [openAiModel, setOpenAiModel] = useState(defaultOpenAIConfig.model)
  const [openAiMessagesJson, setOpenAiMessagesJson] = useState(JSON.stringify(defaultOpenAIConfig.messages, null, 2))
  const [geminiBaseUrl, setGeminiBaseUrl] = useState(defaultGeminiConfig.baseUrl)
  const [geminiApiKey, setGeminiApiKey] = useState(defaultGeminiConfig.apiKey)
  const [geminiModel, setGeminiModel] = useState(defaultGeminiConfig.model)
  const [geminiMessagesJson, setGeminiMessagesJson] = useState(JSON.stringify(defaultGeminiConfig.messages, null, 2))
  const [error, setError] = useState<string>()
  const selectableComfyEndpoints = useMemo(() => comfyEndpoints.filter((endpoint) => endpoint.enabled), [comfyEndpoints])
  const [selectedComfyEndpointId, setSelectedComfyEndpointId] = useState('')
  const selectedComfyEndpoint =
    selectableComfyEndpoints.find((endpoint) => endpoint.id === selectedComfyEndpointId) ?? selectableComfyEndpoints[0]

  useEffect(() => {
    if (functionType !== 'comfyui') return
    const nextEndpointId = selectedComfyEndpoint?.id ?? ''
    if (selectedComfyEndpointId !== nextEndpointId) setSelectedComfyEndpointId(nextEndpointId)
  }, [functionType, selectedComfyEndpoint?.id, selectedComfyEndpointId])

  const changeSelectedComfyEndpoint = (endpointId: string) => {
    setSelectedComfyEndpointId(endpointId)
    setWorkflowRawJson(undefined)
    setWorkflowUiJson(undefined)
    setWorkflowEditor(undefined)
    setError(undefined)
  }

  const formatWorkflowJson = () => {
    if (functionType === 'request') {
      try {
        setRequestHeaders(JSON.stringify(parseHeaderJson(requestHeaders), null, 2))
        setError(undefined)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid headers JSON')
      }
      return
    }

    if (functionType === 'openai' || functionType === 'gemini') {
      try {
        const messages = JSON.parse(functionType === 'openai' ? openAiMessagesJson : geminiMessagesJson)
        const formatted = JSON.stringify(messages, null, 2)
        if (functionType === 'openai') setOpenAiMessagesJson(formatted)
        if (functionType === 'gemini') setGeminiMessagesJson(formatted)
        setError(undefined)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid messages JSON')
      }
      return
    }

    setError(workflowRawJson ? undefined : 'Save a workflow from ComfyUI first')
  }

  const saveFunction = () => {
    try {
      const name =
        functionName.trim() ||
        (functionType === 'request'
          ? 'Request Function'
          : functionType === 'openai'
            ? 'OpenAI LLM Function'
            : functionType === 'gemini'
              ? 'Gemini LLM Function'
              : 'ComfyUI Function')
      let functionId: string | undefined
      if (functionType === 'request') {
        functionId = onSaveRequest(name, {
          url: requestUrl.trim() || 'https://example.com/api',
          method: requestMethod,
          headers: parseHeaderJson(requestHeaders),
          body: requestBody,
          responseParse,
          responseEncoding: responseEncoding.trim() || requestDefaultEncoding,
        })
      } else if (functionType === 'openai') {
        functionId = onSaveOpenAI(name, {
          baseUrl: openAiBaseUrl.trim() || defaultOpenAIConfig.baseUrl,
          apiKey: openAiApiKey,
          model: openAiModel.trim() || defaultOpenAIConfig.model,
          messages: JSON.parse(openAiMessagesJson) as OpenAILlmConfig['messages'],
        })
      } else if (functionType === 'gemini') {
        functionId = onSaveGemini(name, {
          baseUrl: geminiBaseUrl.trim() || defaultGeminiConfig.baseUrl,
          apiKey: geminiApiKey,
          model: geminiModel.trim() || defaultGeminiConfig.model,
          messages: JSON.parse(geminiMessagesJson) as GeminiLlmConfig['messages'],
        })
      } else {
        if (!workflowRawJson) {
          setError('Save a workflow from ComfyUI first')
          return
        }
        functionId = onSaveComfy(name, workflowRawJson, {
          ...(workflowUiJson !== undefined ? { uiJson: workflowUiJson } : {}),
          ...(workflowEditor !== undefined ? { editor: workflowEditor } : {}),
        })
        if (functionId && selectedComfyEndpoint) onBindComfyEndpoint?.(functionId, selectedComfyEndpoint.id)
      }
      if (functionId) onClose()
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid function config')
    }
  }

  const saveEmbeddedWorkflow = (value: EmbeddedComfySave) => {
    setWorkflowRawJson(value.rawJson)
    setWorkflowUiJson(value.uiJson)
    setWorkflowEditor(value.editor)
    setError(undefined)
  }
  const savedComfyNodeCount = workflowRawJson ? Object.keys(workflowRawJson).length : 0
  const canSaveFunction = functionType !== 'comfyui' || workflowRawJson !== undefined

  return (
    <Fragment>
    <ModalShell label="New Function" modalClassName="new-workflow-modal" onClose={onClose}>
      <div className="new-workflow-dialog">
        <label className="field">
          <span>Function type</span>
          <select
            aria-label="Function type"
            autoFocus
            value={functionType}
            onChange={(event) => setFunctionType(event.target.value as NewFunctionType)}
          >
            <option value="comfyui">comfyui</option>
            <option value="request">request</option>
            <option value="openai">openai</option>
            <option value="gemini">gemini</option>
          </select>
        </label>
        <label className="field">
          <span>Function name</span>
          <input
            aria-label="Function name"
            value={functionName}
            onChange={(event) => setFunctionName(event.target.value)}
          />
        </label>
        {functionType === 'comfyui' ? (
          <div className="workflow-authoring-stack">
            <label className="field">
              <span>ComfyUI server</span>
              <select
                aria-label="New function ComfyUI server"
                disabled={selectableComfyEndpoints.length === 0}
                value={selectedComfyEndpoint?.id ?? ''}
                onChange={(event) => changeSelectedComfyEndpoint(event.target.value)}
              >
                {selectableComfyEndpoints.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="workflow-authoring-actions">
              <button type="button" onClick={() => setComfyEditorOpen(true)} disabled={!selectedComfyEndpoint}>
                <Network size={14} />
                Edit in ComfyUI
              </button>
              <span>
                {workflowRawJson
                  ? 'Workflow saved from ComfyUI'
                  : 'Build or open the workflow in ComfyUI, then save it back here'}
              </span>
            </div>
            <div
              className={`comfy-workflow-capture ${workflowRawJson ? 'is-saved' : 'is-empty'}`}
              aria-label={workflowRawJson ? 'Captured ComfyUI workflow' : 'No ComfyUI workflow saved'}
            >
              <strong>{workflowRawJson ? `${savedComfyNodeCount} API nodes saved` : 'No workflow saved yet'}</strong>
              <span>
                {workflowRawJson
                  ? workflowUiJson
                    ? 'Editable UI workflow and runnable API workflow are stored.'
                    : 'Runnable API workflow is stored.'
                  : selectedComfyEndpoint
                    ? 'Use the ComfyUI editor button above to create or import the workflow.'
                    : 'Configure and enable a ComfyUI endpoint before creating a workflow function.'}
              </span>
            </div>
            {error ? <span className="field-error">{error}</span> : null}
          </div>
        ) : functionType === 'request' ? (
          <>
            <div className="manager-grid">
              <label className="field">
                <span>Request URL</span>
                <input
                  aria-label="Request URL"
                  value={requestUrl}
                  onChange={(event) => setRequestUrl(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Request method</span>
                <select
                  aria-label="Request method"
                  value={requestMethod}
                  onChange={(event) => setRequestMethod(event.target.value)}
                >
                  {requestMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Request headers</span>
              <textarea
                aria-invalid={error ? true : undefined}
                aria-label="Request headers"
                value={requestHeaders}
                onChange={(event) => {
                  setRequestHeaders(event.target.value)
                  setError(undefined)
                }}
                rows={5}
              />
            </label>
            <label className="field">
              <span>Request body</span>
              <textarea
                aria-label="Request body"
                value={requestBody}
                onChange={(event) => setRequestBody(event.target.value)}
                rows={6}
              />
            </label>
            <label className="field">
              <span>Response parse mode</span>
              <select
                aria-label="Response parse mode"
                value={responseParse}
                onChange={(event) => setResponseParse(event.target.value as RequestFunctionConfig['responseParse'])}
              >
                {requestParseModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            {responseParse !== 'binary' ? (
              <label className="field">
                <span>Response encoding</span>
                <input
                  aria-label="Response encoding"
                  value={responseEncoding}
                  onChange={(event) => setResponseEncoding(event.target.value)}
                  placeholder={requestDefaultEncoding}
                />
              </label>
            ) : null}
          </>
        ) : functionType === 'openai' ? (
          <>
            <div className="manager-grid">
              <label className="field">
                <span>Base URL</span>
                <input
                  aria-label="OpenAI base URL"
                  value={openAiBaseUrl}
                  onChange={(event) => setOpenAiBaseUrl(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Model</span>
                <input
                  aria-label="OpenAI model"
                  value={openAiModel}
                  onChange={(event) => setOpenAiModel(event.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>API Key</span>
              <input
                aria-label="OpenAI API key"
                autoComplete="off"
                type="password"
                value={openAiApiKey}
                onChange={(event) => setOpenAiApiKey(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Messages JSON</span>
              <textarea
                aria-invalid={error ? true : undefined}
                aria-label="OpenAI messages JSON"
                rows={8}
                value={openAiMessagesJson}
                onChange={(event) => {
                  setOpenAiMessagesJson(event.target.value)
                  setError(undefined)
                }}
              />
            </label>
          </>
        ) : (
          <>
            <div className="manager-grid">
              <label className="field">
                <span>Base URL</span>
                <input
                  aria-label="Gemini base URL"
                  value={geminiBaseUrl}
                  onChange={(event) => setGeminiBaseUrl(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Model</span>
                <input
                  aria-label="Gemini model"
                  value={geminiModel}
                  onChange={(event) => setGeminiModel(event.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>API Key</span>
              <input
                aria-label="Gemini API key"
                autoComplete="off"
                type="password"
                value={geminiApiKey}
                onChange={(event) => setGeminiApiKey(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Messages JSON</span>
              <textarea
                aria-invalid={error ? true : undefined}
                aria-label="Gemini messages JSON"
                rows={8}
                value={geminiMessagesJson}
                onChange={(event) => {
                  setGeminiMessagesJson(event.target.value)
                  setError(undefined)
                }}
              />
            </label>
          </>
        )}
        {functionType !== 'comfyui' ? (
          <div className="json-toolbar">
            <button type="button" onClick={formatWorkflowJson}>
              Format JSON
            </button>
            {error ? <span className="field-error">{error}</span> : null}
          </div>
        ) : null}
        <div className="new-workflow-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-action" onClick={saveFunction} disabled={!canSaveFunction}>
            Save function
          </button>
        </div>
      </div>
    </ModalShell>
    {comfyEditorOpen ? (
      <ComfyWorkflowEditorDialog
        endpoint={selectedComfyEndpoint}
        initialUiJson={workflowUiJson}
        initialApiJson={workflowRawJson}
        onSave={saveEmbeddedWorkflow}
        onClose={() => setComfyEditorOpen(false)}
      />
    ) : null}
    </Fragment>
  )
}

export function FunctionManager({
  functions,
  comfyEndpoints,
  selectedFunctionId,
  allowCreate = true,
  allowDelete = true,
  onSelectFunction,
  onAddWorkflow,
  onAddRequestFunction,
  onAddOpenAIFunction,
  onAddGeminiFunction,
  onUpdateFunction,
  onDeleteFunction,
  onUpdateEndpoint,
  onClose,
}: FunctionManagerProps) {
  const selectedFunction = functions.find((fn) => fn.id === selectedFunctionId) ?? functions[0]
  const [createFunctionOpen, setCreateFunctionOpen] = useState(false)
  const [comfyEditorOpen, setComfyEditorOpen] = useState(false)
  const [selectedWorkflowDraft, setSelectedWorkflowDraft] = useState<WorkflowJsonDraft>({ value: '' })
  const [requestHeaderError, setRequestHeaderError] = useState<string>()
  const selectedWorkflowSource = selectedFunction ? JSON.stringify(selectedFunction.workflow.rawJson, null, 2) : ''
  const selectedWorkflowJson =
    selectedWorkflowDraft.functionId === selectedFunction?.id ? selectedWorkflowDraft.value : selectedWorkflowSource
  const selectedWorkflowJsonError =
    selectedWorkflowDraft.functionId === selectedFunction?.id ? selectedWorkflowDraft.error : undefined
  const selectedIsRequest = selectedFunction ? isRequestFunction(selectedFunction) : false
  const selectedIsOpenAI = selectedFunction ? isOpenAILlmFunction(selectedFunction) : false
  const selectedIsGemini = selectedFunction ? isGeminiLlmFunction(selectedFunction) : false
  const selectedIsProvider = selectedIsOpenAI || selectedIsGemini
  const selectedRequestConfig = mergedRequestConfig(selectedFunction?.request)
  const selectedOpenAIConfig = selectedIsOpenAI
    ? mergedOpenAILlmConfig(selectedFunction?.openai ?? defaultOpenAILlmConfig())
    : undefined
  const selectedGeminiConfig = selectedIsGemini
    ? mergedGeminiLlmConfig(selectedFunction?.gemini ?? defaultGeminiLlmConfig())
    : undefined
  const [openAiMessagesError, setOpenAiMessagesError] = useState<string>()
  const [geminiMessagesError, setGeminiMessagesError] = useState<string>()
  const workflowFunctions = functions.filter(isComfyWorkflowFunction)
  const workflowFunctionIds = workflowFunctions.map((fn) => fn.id)
  const selectedIsComfyWorkflow = selectedFunction ? isComfyWorkflowFunction(selectedFunction) : false
  const selectableEditorComfyEndpoints =
    selectedFunction && selectedIsComfyWorkflow
      ? comfyEndpoints.filter((endpoint) => endpoint.enabled && endpointSupportsWorkflowFunction(endpoint, selectedFunction.id))
      : []
  const [selectedEditorComfySelection, setSelectedEditorComfySelection] = useState<{ functionId: string; endpointId: string }>()
  const selectedEditorComfyEndpoint =
    (selectedEditorComfySelection?.functionId === selectedFunction?.id
      ? selectableEditorComfyEndpoints.find((endpoint) => endpoint.id === selectedEditorComfySelection.endpointId)
      : undefined) ??
    selectableEditorComfyEndpoints.find((endpoint) => endpoint.id === selectedFunction?.workflow.editor?.endpointId) ??
    selectableEditorComfyEndpoints[0]

  useEffect(() => {
    if (!selectedFunction?.id || !selectedIsComfyWorkflow) {
      if (selectedEditorComfySelection) setSelectedEditorComfySelection(undefined)
      return
    }
    const nextEndpointId = selectedEditorComfyEndpoint?.id ?? ''
    if (
      nextEndpointId &&
      (selectedEditorComfySelection?.functionId !== selectedFunction.id ||
        selectedEditorComfySelection.endpointId !== nextEndpointId)
    ) {
      setSelectedEditorComfySelection({ functionId: selectedFunction.id, endpointId: nextEndpointId })
    }
  }, [selectedFunction?.id, selectedIsComfyWorkflow, selectedEditorComfyEndpoint?.id, selectedEditorComfySelection])

  const bindNewWorkflowFunctionToEndpoint = (functionId: string, endpointId: string) => {
    if (!onUpdateEndpoint) return
    const nextWorkflowFunctionIds = [...workflowFunctionIds, functionId]
    for (const endpoint of comfyEndpoints) {
      const supportedFunctions = endpoint.capabilities?.supportedFunctions
      const nextSupportedFunctions =
        endpoint.id === endpointId
          ? [...(supportedFunctions ?? workflowFunctionIds), functionId]
          : supportedFunctions === undefined
            ? workflowFunctionIds
            : supportedFunctions.filter((id) => id !== functionId)
      onUpdateEndpoint(endpoint.id, endpointCapabilitiesPatch(endpoint, nextSupportedFunctions.filter((id) => nextWorkflowFunctionIds.includes(id))))
    }
  }

  const deleteSelectedFunction = () => {
    if (!selectedFunction) return
    const nextFunction = functions.find((fn) => fn.id !== selectedFunction.id)
    onDeleteFunction(selectedFunction.id)
    onSelectFunction(nextFunction?.id)
  }

  const addInput = () => {
    if (!selectedFunction) return
    const index = selectedFunction.inputs.length + 1
    onUpdateFunction(selectedFunction.id, {
      inputs: [
        ...selectedFunction.inputs,
        {
          key: `input_${index}`,
          label: `Input ${index}`,
          type: 'text',
          required: false,
          bind: selectedIsRequest
            ? { path: `param_${index}`, requestTarget: 'url_param' }
            : { nodeId: '', path: 'inputs.text' },
          upload: { strategy: 'none' },
        },
      ],
    })
  }

  const addOutput = () => {
    if (!selectedFunction) return
    const index = selectedFunction.outputs.length + 1
    const requestParse = selectedIsRequest ? selectedRequestConfig.responseParse : undefined
    const requestOutputType = requestParse ? requestOutputTypesForParse(requestParse)[0] ?? 'text' : 'text'
    const requestOutputSource = requestParse ? requestOutputSourcesForParse(requestParse)[0] ?? 'response_text_regex' : undefined
    onUpdateFunction(selectedFunction.id, {
      outputs: [
        ...selectedFunction.outputs,
        {
          key: `output_${index}`,
          label: `Output ${index}`,
          type: selectedIsRequest ? requestOutputType : 'image',
          bind: selectedIsRequest ? {} : { nodeId: '' },
          extract: selectedIsRequest
            ? requestOutputSource === 'response_binary'
              ? { source: 'response_binary' }
              : requestOutputSource === 'response_json_path'
                ? { source: 'response_json_path', path: '$' }
                : { source: 'response_text_regex', pattern: '(.+)' }
            : { source: 'history', multiple: true },
        },
      ],
    })
  }

  const formatSelectedWorkflowJson = () => {
    if (!selectedFunction) return

    try {
      const rawJson = JSON.parse(selectedWorkflowJson) as ComfyWorkflow
      const formatted = JSON.stringify(rawJson, null, 2)
      onUpdateFunction(selectedFunction.id, {
        workflow: {
          ...selectedFunction.workflow,
          rawJson,
        },
      })
      setSelectedWorkflowDraft({ functionId: selectedFunction.id, value: formatted })
    } catch (err) {
      setSelectedWorkflowDraft({
        functionId: selectedFunction.id,
        value: selectedWorkflowJson,
        error: `Invalid workflow JSON: ${err instanceof Error ? err.message : 'Invalid JSON'}`,
      })
    }
  }

  const saveSelectedEmbeddedWorkflow = (value: EmbeddedComfySave) => {
    if (!selectedFunction) return
    const formatted = JSON.stringify(value.rawJson, null, 2)
    onUpdateFunction(selectedFunction.id, {
      workflow: {
        ...selectedFunction.workflow,
        rawJson: value.rawJson,
        uiJson: value.uiJson,
        editor: value.editor,
      },
    })
    setSelectedWorkflowDraft({ functionId: selectedFunction.id, value: formatted })
  }

  const updateRequestConfig = (patch: Partial<RequestFunctionConfig>) => {
    if (!selectedFunction) return
    const request = mergedRequestConfig(selectedFunction.request, patch)
    onUpdateFunction(selectedFunction.id, {
      request,
      ...(patch.responseParse
        ? { outputs: normalizeRequestOutputsForParse(selectedFunction.outputs, patch.responseParse) }
        : {}),
    })
  }

  const updateRequestHeaders = (value: string) => {
    try {
      updateRequestConfig({ headers: parseHeaderJson(value) })
      setRequestHeaderError(undefined)
    } catch (err) {
      setRequestHeaderError(err instanceof Error ? err.message : 'Invalid headers JSON')
    }
  }

  const updateOpenAIConfig = (patch: Partial<OpenAILlmConfig>) => {
    if (!selectedFunction) return
    onUpdateFunction(selectedFunction.id, { openai: mergedOpenAILlmConfig(selectedFunction.openai, patch) })
  }

  const updateGeminiConfig = (patch: Partial<GeminiLlmConfig>) => {
    if (!selectedFunction) return
    onUpdateFunction(selectedFunction.id, { gemini: mergedGeminiLlmConfig(selectedFunction.gemini, patch) })
  }

  const updateOpenAIMessages = (value: string) => {
    try {
      updateOpenAIConfig({ messages: JSON.parse(value) as OpenAILlmConfig['messages'] })
      setOpenAiMessagesError(undefined)
    } catch (err) {
      setOpenAiMessagesError(err instanceof Error ? err.message : 'Invalid messages JSON')
    }
  }

  const updateGeminiMessages = (value: string) => {
    try {
      updateGeminiConfig({ messages: JSON.parse(value) as GeminiLlmConfig['messages'] })
      setGeminiMessagesError(undefined)
    } catch (err) {
      setGeminiMessagesError(err instanceof Error ? err.message : 'Invalid messages JSON')
    }
  }

  const updateRequestOutputExpression = (output: FunctionOutputDef, index: number, value: string) => {
    if (output.extract.source === 'response_binary') return
    updateOutput(
      selectedFunction!,
      index,
      output.extract.source === 'response_json_path'
        ? { extract: { path: value, pattern: undefined } }
        : { extract: { pattern: value, path: undefined } },
      onUpdateFunction,
    )
  }

  return (
    <ModalShell label="Function Management" onClose={onClose}>
      <div className="manager-layout">
        <div className="manager-sidebar" aria-label="Managed function list">
          {allowCreate ? (
            <div className="manager-create-actions">
              <button type="button" onClick={() => setCreateFunctionOpen(true)}>
                <Plus size={14} />
                Function
              </button>
            </div>
          ) : null}
          <div className="manager-list">
            {functions.length > 0 ? (
              functions.map((fn) => (
                <button
                  key={fn.id}
                  type="button"
                  className={fn.id === selectedFunction?.id ? 'selected' : undefined}
                  onClick={() => onSelectFunction(fn.id)}
                >
                  <span>{fn.name}</span>
                  <strong>
                    {fn.inputs.length}/{fn.outputs.length}
                  </strong>
                </button>
              ))
            ) : (
              <div className="empty-list">No managed functions</div>
            )}
          </div>
        </div>

        <div className="manager-editor">
          {selectedFunction ? (
            <>
              <div className="manager-editor-title">
                <div>
                  <strong>{selectedFunction.name}</strong>
                  <span>{selectedFunction.id}</span>
                </div>
                {allowDelete ? (
                  <button
                    type="button"
                    className="danger-button"
                    aria-label={`Delete function ${selectedFunction.name}`}
                    onClick={deleteSelectedFunction}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                ) : null}
              </div>

              <div className="manager-grid">
                <label className="field">
                  <span>Function name</span>
                  <CommittedTextInput
                    ariaLabel="Function name"
                    value={selectedFunction.name}
                    onCommit={(name) => onUpdateFunction(selectedFunction.id, { name })}
                  />
                </label>
                <label className="field">
                  <span>Category</span>
                  <CommittedTextInput
                    ariaLabel="Function category"
                    value={selectedFunction.category ?? ''}
                    onCommit={(category) => onUpdateFunction(selectedFunction.id, { category })}
                  />
                </label>
              </div>
              <label className="field">
                <span>Description</span>
                <CommittedTextarea
                  ariaLabel="Function description"
                  value={selectedFunction.description ?? ''}
                  onCommit={(description) => onUpdateFunction(selectedFunction.id, { description })}
                  rows={2}
                />
              </label>

              {selectedIsComfyWorkflow && onUpdateEndpoint ? (
                <div className="binding-section function-endpoint-section">
                  <div className="binding-header">
                    <h4>ComfyUI Servers</h4>
                    <span>{comfyEndpoints.filter((endpoint) => endpointSupportsWorkflowFunction(endpoint, selectedFunction.id)).length} available</span>
                  </div>
                  <div className="function-endpoint-list">
                    {comfyEndpoints.length > 0 ? (
                      comfyEndpoints.map((endpoint) => (
                        <label className="function-endpoint-item" key={`${selectedFunction.id}_${endpoint.id}`}>
                          <input
                            aria-label={`Function ${selectedFunction.name} available on ${endpoint.name}`}
                            type="checkbox"
                            checked={endpointSupportsWorkflowFunction(endpoint, selectedFunction.id)}
                            onChange={(event) =>
                              setEndpointFunctionAvailability(
                                endpoint,
                                selectedFunction.id,
                                event.target.checked,
                                workflowFunctionIds,
                                onUpdateEndpoint,
                              )
                            }
                          />
                          <span>
                            <strong>{endpoint.name}</strong>
                            <small>{endpoint.enabled ? 'enabled' : 'disabled'} · {endpointFunctionScopeLabel(endpoint, workflowFunctionIds)}</small>
                          </span>
                        </label>
                      ))
                    ) : (
                      <div className="empty-list">No ComfyUI servers</div>
                    )}
                  </div>
                </div>
              ) : null}

              {selectedIsRequest ? (
                <div className="workflow-editor-section">
                  <div className="binding-header">
                    <h4>Request</h4>
                    {requestHeaderError ? <span className="field-error">{requestHeaderError}</span> : null}
                  </div>
                  <div className="manager-grid">
                    <label className="field">
                      <span>Request URL</span>
                      <CommittedTextInput
                        ariaLabel="Request URL"
                        value={selectedRequestConfig.url}
                        onCommit={(url) => updateRequestConfig({ url })}
                      />
                    </label>
                    <label className="field">
                      <span>Request method</span>
                      <select
                        aria-label="Request method"
                        value={selectedRequestConfig.method}
                        onChange={(event) => updateRequestConfig({ method: event.target.value })}
                      >
                        {requestMethods.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="manager-grid request-config-grid">
                    <label className="field">
                      <span>Request headers</span>
                      <CommittedTextarea
                        ariaLabel="Request headers"
                        value={JSON.stringify(selectedRequestConfig.headers, null, 2)}
                        onCommit={updateRequestHeaders}
                        rows={6}
                      />
                    </label>
                    <label className="field">
                      <span>Request body</span>
                      <CommittedTextarea
                        ariaLabel="Request body"
                        value={selectedRequestConfig.body}
                        onCommit={(body) => updateRequestConfig({ body })}
                        rows={6}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Response parse mode</span>
                    <select
                      aria-label="Response parse mode"
                      value={selectedRequestConfig.responseParse}
                      onChange={(event) =>
                        updateRequestConfig({ responseParse: event.target.value as RequestFunctionConfig['responseParse'] })
                      }
                    >
                      {requestParseModes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedRequestConfig.responseParse !== 'binary' ? (
                    <label className="field">
                      <span>Response encoding</span>
                      <CommittedTextInput
                        ariaLabel="Response encoding"
                        value={selectedRequestConfig.responseEncoding || requestDefaultEncoding}
                        onCommit={(responseEncoding) =>
                          updateRequestConfig({ responseEncoding: responseEncoding.trim() || requestDefaultEncoding })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              ) : selectedIsOpenAI && selectedOpenAIConfig ? (
                <div className="workflow-editor-section">
                  <div className="binding-header">
                    <h4>OpenAI</h4>
                    {openAiMessagesError ? <span className="field-error">{openAiMessagesError}</span> : null}
                  </div>
                  <div className="manager-grid">
                    <label className="field">
                      <span>Base URL</span>
                      <CommittedTextInput
                        ariaLabel="OpenAI base URL"
                        value={selectedOpenAIConfig.baseUrl}
                        onCommit={(baseUrl) => updateOpenAIConfig({ baseUrl })}
                      />
                    </label>
                    <label className="field">
                      <span>Model</span>
                      <CommittedTextInput
                        ariaLabel="OpenAI model"
                        value={selectedOpenAIConfig.model}
                        onCommit={(model) => updateOpenAIConfig({ model })}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>API Key</span>
                    <CommittedTextInput
                      ariaLabel="OpenAI API key"
                      type="password"
                      value={selectedOpenAIConfig.apiKey}
                      onCommit={(apiKey) => updateOpenAIConfig({ apiKey })}
                    />
                  </label>
                  <label className="field">
                    <span>Messages JSON</span>
                    <CommittedTextarea
                      ariaLabel="OpenAI messages JSON"
                      value={JSON.stringify(selectedOpenAIConfig.messages, null, 2)}
                      onCommit={updateOpenAIMessages}
                      rows={8}
                    />
                  </label>
                </div>
              ) : selectedIsGemini && selectedGeminiConfig ? (
                <div className="workflow-editor-section">
                  <div className="binding-header">
                    <h4>Gemini</h4>
                    {geminiMessagesError ? <span className="field-error">{geminiMessagesError}</span> : null}
                  </div>
                  <div className="manager-grid">
                    <label className="field">
                      <span>Base URL</span>
                      <CommittedTextInput
                        ariaLabel="Gemini base URL"
                        value={selectedGeminiConfig.baseUrl}
                        onCommit={(baseUrl) => updateGeminiConfig({ baseUrl })}
                      />
                    </label>
                    <label className="field">
                      <span>Model</span>
                      <CommittedTextInput
                        ariaLabel="Gemini model"
                        value={selectedGeminiConfig.model}
                        onCommit={(model) => updateGeminiConfig({ model })}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>API Key</span>
                    <CommittedTextInput
                      ariaLabel="Gemini API key"
                      type="password"
                      value={selectedGeminiConfig.apiKey}
                      onCommit={(apiKey) => updateGeminiConfig({ apiKey })}
                    />
                  </label>
                  <label className="field">
                    <span>Messages JSON</span>
                    <CommittedTextarea
                      ariaLabel="Gemini messages JSON"
                      value={JSON.stringify(selectedGeminiConfig.messages, null, 2)}
                      onCommit={updateGeminiMessages}
                      rows={8}
                    />
                  </label>
                </div>
              ) : (
                <div className="workflow-editor-section">
                  <label className="field workflow-editor-endpoint-field">
                    <span>ComfyUI server</span>
                    <select
                      aria-label={`Workflow editor ComfyUI server ${selectedFunction.name}`}
                      disabled={selectableEditorComfyEndpoints.length === 0}
                      value={selectedEditorComfyEndpoint?.id ?? ''}
                      onChange={(event) =>
                        selectedFunction
                          ? setSelectedEditorComfySelection({ functionId: selectedFunction.id, endpointId: event.target.value })
                          : undefined
                      }
                    >
                      {selectableEditorComfyEndpoints.map((endpoint) => (
                        <option key={endpoint.id} value={endpoint.id}>
                          {endpoint.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="binding-header">
                    <h4>Workflow JSON</h4>
                    <div className="json-toolbar compact-json-toolbar">
                      {selectedWorkflowJsonError ? <span className="field-error">{selectedWorkflowJsonError}</span> : null}
                      <button type="button" onClick={() => setComfyEditorOpen(true)} disabled={!selectedEditorComfyEndpoint}>
                        <Network size={14} />
                        Edit in ComfyUI
                      </button>
                      <button type="button" onClick={formatSelectedWorkflowJson}>
                        Format selected JSON
                      </button>
                    </div>
                  </div>
                  <div className="workflow-editor-grid">
                    <pre
                      className="json-preview selected-workflow-preview"
                      aria-invalid={selectedWorkflowJsonError ? true : undefined}
                      aria-label="Selected workflow JSON"
                    >
                      <code>{highlightedJson(selectedWorkflowJson)}</code>
                    </pre>
                  </div>
                </div>
              )}

              {!selectedIsProvider ? (
                <>
              <div className="binding-section">
                <div className="binding-header">
                  <h4>Inputs</h4>
                  <button type="button" onClick={addInput}>
                    <Plus size={14} />
                    Input
                  </button>
                </div>
                <div className="binding-list">
                  <div className={`binding-column-header${selectedIsRequest ? ' request-input-binding-row' : ''}`}>
                    {selectedIsRequest ? (
                      <>
                        <span>Request target</span>
                        <span>Request key</span>
                        <span>Label</span>
                        <span>Type</span>
                        <span>Required</span>
                        <span />
                      </>
                    ) : (
                      <>
                        <span>Workflow Input</span>
                        <span>Label</span>
                        <span>Type</span>
                        <span>Required</span>
                        <span />
                      </>
                    )}
                  </div>
                  {selectedFunction.inputs.map((input, index) => (
                    <div className="binding-row-wrapper" key={`${input.key}_${index}`}>
                      <div className={`binding-row${selectedIsRequest ? ' request-input-binding-row' : ''}`}>
                        {selectedIsRequest ? (
                          <>
                            <select
                              aria-label={`Input request target ${input.key}`}
                              value={input.bind.requestTarget ?? 'url_param'}
                              onChange={(event) =>
                                updateInput(
                                  selectedFunction,
                                  index,
                                  { bind: { requestTarget: event.target.value as FunctionInputDef['bind']['requestTarget'] } },
                                  onUpdateFunction,
                                )
                              }
                            >
                              {requestInputTargets.map((target) => (
                                <option key={target} value={target}>
                                  {target}
                                </option>
                              ))}
                            </select>
                            <CommittedTextInput
                              ariaLabel={`Input request key ${input.key}`}
                              value={input.bind.path}
                              onCommit={(path) => updateInput(selectedFunction, index, { bind: { path } }, onUpdateFunction)}
                            />
                          </>
                        ) : (
                          <SearchableSelect
                            invalid={bindingStatus(selectedFunction.workflow.rawJson, input.bind).idInvalid}
                            label={`Input workflow field ${input.key}`}
                            options={workflowInputBindingOptions(selectedFunction.workflow.rawJson)}
                            value={workflowBindingDisplay(selectedFunction.workflow.rawJson, input.bind)}
                            onCommit={(value) => updateInputBindingSelection(selectedFunction, index, value, onUpdateFunction)}
                          />
                        )}
                        <CommittedTextInput
                          ariaLabel={`Input label ${input.key}`}
                          value={input.label}
                          onCommit={(label) => updateInput(selectedFunction, index, { label }, onUpdateFunction)}
                        />
                        <select
                          aria-label={`Input type ${input.key}`}
                          value={input.type}
                          onChange={(event) =>
                            updateInput(
                              selectedFunction,
                              index,
                              { type: event.target.value as ResourceType },
                              onUpdateFunction,
                            )
                          }
                        >
                          {resourceTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        <label className="inline-check">
                          <input
                            aria-label={`Input required ${input.key}`}
                            type="checkbox"
                            checked={input.required}
                            onChange={(event) =>
                              updateInput(selectedFunction, index, { required: event.target.checked }, onUpdateFunction)
                            }
                          />
                          Required
                        </label>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Delete input ${input.key}`}
                          onClick={() =>
                            onUpdateFunction(selectedFunction.id, {
                              inputs: selectedFunction.inputs.filter((_, inputIndex) => inputIndex !== index),
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {!selectedIsRequest &&
                      (bindingStatus(selectedFunction.workflow.rawJson, input.bind).idInvalid ||
                        bindingStatus(selectedFunction.workflow.rawJson, input.bind).titleInvalid) ? (
                          <span className="field-error">Workflow node not found</span>
                        ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="binding-section">
                <div className="binding-header">
                  <h4>Outputs</h4>
                  <button type="button" onClick={addOutput}>
                    <Plus size={14} />
                    Output
                  </button>
                </div>
                <div className="binding-list">
                  <div className={`binding-column-header output-binding-row${selectedIsRequest ? ' request-output-binding-row' : ''}`}>
                    {selectedIsRequest ? (
                      <>
                        <span>Extractor</span>
                        <span>Expression</span>
                        <span>Label</span>
                        <span>Type</span>
                        <span />
                      </>
                    ) : (
                      <>
                        <span>Workflow Output Node</span>
                        <span>Label</span>
                        <span>Type</span>
                        <span>Source</span>
                        <span />
                      </>
                    )}
                  </div>
                  {selectedFunction.outputs.map((output, index) => {
                    const requestOutput = selectedIsRequest
                      ? normalizeRequestOutputForParse(output, selectedRequestConfig.responseParse)
                      : output
                    const requestOutputSources = selectedIsRequest
                      ? requestOutputSourcesForParse(selectedRequestConfig.responseParse)
                      : []
                    const requestOutputTypes = selectedIsRequest
                      ? requestOutputTypesForParse(selectedRequestConfig.responseParse)
                      : resourceTypes
                    const requestExpression =
                      requestOutput.extract.source === 'response_json_path'
                        ? requestOutput.extract.path || requestOutput.bind.path || '$'
                        : requestOutput.extract.source === 'response_text_regex'
                          ? requestOutput.extract.pattern || requestOutput.bind.path || '(.+)'
                          : 'binary response'
                    return (
                    <div className="binding-row-wrapper" key={`${output.key}_${index}`}>
                      <div className={`binding-row output-binding-row${selectedIsRequest ? ' request-output-binding-row' : ''}`}>
                        {selectedIsRequest ? (
                          <>
                            <select
                              aria-label={`Output extractor ${output.key}`}
                              value={requestOutput.extract.source}
                              onChange={(event) =>
                                updateOutput(
                                  selectedFunction,
                                  index,
                                  {
                                    extract: {
                                      source: event.target.value as FunctionOutputDef['extract']['source'],
                                      path:
                                        event.target.value === 'response_json_path'
                                          ? requestOutput.extract.path || requestOutput.bind.path || '$'
                                          : undefined,
                                      pattern:
                                        event.target.value === 'response_text_regex'
                                          ? requestOutput.extract.pattern || requestOutput.bind.path || '(.+)'
                                          : undefined,
                                    },
                                  },
                                  onUpdateFunction,
                                )
                              }
                            >
                              {requestOutputSources.map((source) => (
                                <option key={source} value={source}>
                                  {source}
                                </option>
                              ))}
                            </select>
                            <CommittedTextInput
                              ariaLabel={`Output expression ${output.key}`}
                              value={requestExpression}
                              disabled={requestOutput.extract.source === 'response_binary'}
                              onCommit={(value) => updateRequestOutputExpression(requestOutput, index, value)}
                            />
                          </>
                        ) : (
                          <SearchableSelect
                            invalid={bindingStatus(selectedFunction.workflow.rawJson, output.bind).idInvalid}
                            label={`Output workflow node ${output.key}`}
                            options={workflowNodeSearchOptions(selectedFunction.workflow.rawJson)}
                            placeholder="output node"
                            value={nodeDisplayValue(selectedFunction.workflow.rawJson, output.bind)}
                            onCommit={(value) => updateOutputBindingSelection(selectedFunction, index, value, onUpdateFunction)}
                          />
                        )}
                        <CommittedTextInput
                          ariaLabel={`Output label ${output.key}`}
                          value={output.label}
                          onCommit={(label) => updateOutput(selectedFunction, index, { label }, onUpdateFunction)}
                        />
                        <select
                          aria-label={`Output type ${output.key}`}
                          value={selectedIsRequest ? requestOutput.type : output.type}
                          onChange={(event) =>
                            updateOutput(
                              selectedFunction,
                              index,
                              { type: event.target.value as ResourceType },
                              onUpdateFunction,
                            )
                          }
                        >
                          {(selectedIsRequest ? requestOutputTypes : resourceTypes).map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        {!selectedIsRequest ? (
                          <select
                            aria-label={`Output source ${output.key}`}
                            value={output.extract.source}
                            onChange={(event) =>
                              updateOutput(
                                selectedFunction,
                                index,
                                { extract: { source: event.target.value as FunctionOutputDef['extract']['source'] } },
                                onUpdateFunction,
                              )
                            }
                          >
                            {outputSources.map((source) => (
                              <option key={source} value={source}>
                                {source}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Delete output ${output.key}`}
                          onClick={() =>
                            onUpdateFunction(selectedFunction.id, {
                              outputs: selectedFunction.outputs.filter((_, outputIndex) => outputIndex !== index),
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {!selectedIsRequest &&
                      (bindingStatus(selectedFunction.workflow.rawJson, output.bind).idInvalid ||
                        bindingStatus(selectedFunction.workflow.rawJson, output.bind).titleInvalid) ? (
                          <span className="field-error">Workflow node not found</span>
                        ) : null}
                    </div>
                  )})}
                </div>
              </div>
                </>
              ) : null}
            </>
          ) : (
            <div className="inspector-empty">Add a workflow to manage ComfyUI functions.</div>
          )}
        </div>
      </div>
      {createFunctionOpen ? (
        <NewFunctionDialog
          comfyEndpoints={comfyEndpoints}
          onClose={() => setCreateFunctionOpen(false)}
          onSaveComfy={(name, workflow, options) => {
            const functionId = onAddWorkflow(name, workflow, options)
            if (functionId) onSelectFunction(functionId)
            return functionId
          }}
          onSaveRequest={(name, config) => {
            const functionId = onAddRequestFunction(name, config)
            if (functionId) onSelectFunction(functionId)
            return functionId
          }}
          onSaveOpenAI={(name, config) => {
            const functionId = onAddOpenAIFunction(name, config)
            if (functionId) onSelectFunction(functionId)
            return functionId
          }}
          onSaveGemini={(name, config) => {
            const functionId = onAddGeminiFunction(name, config)
            if (functionId) onSelectFunction(functionId)
            return functionId
          }}
          onBindComfyEndpoint={bindNewWorkflowFunctionToEndpoint}
        />
      ) : null}
      {comfyEditorOpen && selectedFunction && !selectedIsRequest && !selectedIsProvider ? (
        <ComfyWorkflowEditorDialog
          endpoint={selectedEditorComfyEndpoint}
          initialUiJson={selectedFunction.workflow.uiJson}
          initialApiJson={selectedFunction.workflow.rawJson}
          onSave={saveSelectedEmbeddedWorkflow}
          onClose={() => setComfyEditorOpen(false)}
        />
      ) : null}
    </ModalShell>
  )
}

type EndpointManagerProps = {
  endpoints: ComfyEndpointConfig[]
  functions: GenerationFunction[]
  queueCounts: Record<string, number>
  onAddEndpoint: () => void
  onUpdateEndpoint: (endpointId: string, patch: Partial<ComfyEndpointConfig>) => void
  onDeleteEndpoint: (endpointId: string) => void
  onTestEndpoint: (endpoint: ComfyEndpointConfig) => void
  onClose: () => void
}

const endpointHeaders = (endpoint: ComfyEndpointConfig) => Object.entries(endpoint.customHeaders ?? {})

function updateEndpointHeader(
  endpoint: ComfyEndpointConfig,
  index: number,
  nextKey: string,
  nextValue: string,
  onUpdateEndpoint: EndpointManagerProps['onUpdateEndpoint'],
) {
  const entries = endpointHeaders(endpoint)
  entries[index] = [nextKey, nextValue]
  onUpdateEndpoint(endpoint.id, {
    customHeaders: Object.fromEntries(entries),
  })
}

function addEndpointHeader(endpoint: ComfyEndpointConfig, onUpdateEndpoint: EndpointManagerProps['onUpdateEndpoint']) {
  const entries = endpointHeaders(endpoint)
  onUpdateEndpoint(endpoint.id, {
    customHeaders: Object.fromEntries([...entries, ['', '']]),
  })
}

function deleteEndpointHeader(
  endpoint: ComfyEndpointConfig,
  index: number,
  onUpdateEndpoint: EndpointManagerProps['onUpdateEndpoint'],
) {
  onUpdateEndpoint(endpoint.id, {
    customHeaders: Object.fromEntries(endpointHeaders(endpoint).filter((_, headerIndex) => headerIndex !== index)),
  })
}

function EndpointManager({
  endpoints,
  functions,
  queueCounts,
  onAddEndpoint,
  onUpdateEndpoint,
  onDeleteEndpoint,
  onTestEndpoint,
  onClose,
}: EndpointManagerProps) {
  const workflowFunctions = functions.filter(isComfyWorkflowFunction)
  const workflowFunctionIds = workflowFunctions.map((fn) => fn.id)
  const setEndpointAllFunctions = (endpoint: ComfyEndpointConfig, enabled: boolean) => {
    onUpdateEndpoint(endpoint.id, endpointCapabilitiesPatch(endpoint, enabled ? undefined : workflowFunctionIds))
  }
  const setEndpointFunction = (endpoint: ComfyEndpointConfig, functionId: string, enabled: boolean) => {
    setEndpointFunctionAvailability(endpoint, functionId, enabled, workflowFunctionIds, onUpdateEndpoint)
  }

  return (
    <ModalShell label="ComfyUI Server Management" onClose={onClose}>
      <div className="endpoint-manager-toolbar">
        <button type="button" onClick={onAddEndpoint}>
          <Plus size={14} />
          Server
        </button>
      </div>
      <div className="endpoint-manager-list">
        {endpoints.map((endpoint) => {
          const status = endpoint.health?.status ?? 'unknown'
          const queueCount = queueCounts[endpoint.id] ?? 0
          return (
            <div className="endpoint-manager-row" key={endpoint.id}>
              <div className="manager-editor-title">
                <div>
                  <strong>{endpoint.name}</strong>
                  <span>
                    {status} · queue {queueCount}
                  </span>
                </div>
                <button
                  type="button"
                  className="danger-button"
                  aria-label={`Delete endpoint ${endpoint.name}`}
                  onClick={() => onDeleteEndpoint(endpoint.id)}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
              <div className="manager-grid endpoint-grid">
                <label className="field">
                  <span>Name</span>
                  <CommittedTextInput
                    ariaLabel={`Endpoint name ${endpoint.name}`}
                    value={endpoint.name}
                    onCommit={(name) => onUpdateEndpoint(endpoint.id, { name })}
                  />
                </label>
                <label className="field">
                  <span>URL</span>
                  <CommittedTextInput
                    ariaLabel={`Endpoint URL ${endpoint.name}`}
                    value={endpoint.baseUrl}
                    onCommit={(baseUrl) => onUpdateEndpoint(endpoint.id, { baseUrl })}
                  />
                </label>
                <label className="field">
                  <span>Max jobs</span>
                  <input
                    aria-label={`Max jobs ${endpoint.name}`}
                    type="number"
                    min="1"
                    value={endpoint.maxConcurrentJobs}
                    onChange={(event) =>
                      onUpdateEndpoint(endpoint.id, { maxConcurrentJobs: Math.max(1, Number(event.target.value) || 1) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Priority</span>
                  <input
                    aria-label={`Priority ${endpoint.name}`}
                    type="number"
                    value={endpoint.priority}
                    onChange={(event) => onUpdateEndpoint(endpoint.id, { priority: Number(event.target.value) || 0 })}
                  />
                </label>
                <label className="field">
                  <span>Timeout ms</span>
                  <input
                    aria-label={`Timeout ${endpoint.name}`}
                    type="number"
                    min="1000"
                    value={endpoint.timeoutMs}
                    onChange={(event) =>
                      onUpdateEndpoint(endpoint.id, { timeoutMs: Math.max(1000, Number(event.target.value) || 1000) })
                    }
                  />
                </label>
                <label className="inline-check endpoint-enabled">
                  <input
                    aria-label={`Endpoint enabled ${endpoint.name}`}
                    type="checkbox"
                    checked={endpoint.enabled}
                    onChange={(event) => onUpdateEndpoint(endpoint.id, { enabled: event.target.checked })}
                  />
                  Enabled
                </label>
              </div>
              <div className="endpoint-actions">
                <span className={`status-dot ${status}`} />
                <button type="button" onClick={() => onTestEndpoint(endpoint)}>
                  <Route size={14} />
                  Test
                </button>
                {endpoint.health?.message ? <span className="endpoint-message">{endpoint.health.message}</span> : null}
              </div>
              <div className="endpoint-function-editor">
                <div className="binding-header">
                  <h4>Available Functions</h4>
                  <span>{endpointFunctionScopeLabel(endpoint, workflowFunctionIds)}</span>
                </div>
                <label className="inline-check endpoint-all-functions">
                  <input
                    aria-label={`Endpoint supports all functions ${endpoint.name}`}
                    type="checkbox"
                    checked={endpoint.capabilities?.supportedFunctions === undefined}
                    onChange={(event) => setEndpointAllFunctions(endpoint, event.target.checked)}
                  />
                  All workflow functions
                </label>
                <div className="endpoint-function-list">
                  {workflowFunctions.length > 0 ? (
                    workflowFunctions.map((fn) => {
                      const allFunctions = endpoint.capabilities?.supportedFunctions === undefined
                      return (
                        <label className="endpoint-function-item" key={`${endpoint.id}_${fn.id}`}>
                          <input
                            aria-label={`Endpoint supports ${fn.name} ${endpoint.name}`}
                            type="checkbox"
                            disabled={allFunctions}
                            checked={endpointSupportsWorkflowFunction(endpoint, fn.id)}
                            onChange={(event) => setEndpointFunction(endpoint, fn.id, event.target.checked)}
                          />
                          <span>{fn.name}</span>
                        </label>
                      )
                    })
                  ) : (
                    <div className="empty-list">No ComfyUI workflow functions</div>
                  )}
                </div>
              </div>
              <div className="header-editor">
                <div className="binding-header">
                  <h4>Headers</h4>
                  <button type="button" onClick={() => addEndpointHeader(endpoint, onUpdateEndpoint)}>
                    <Plus size={14} />
                    Header
                  </button>
                </div>
                <div className="header-list">
                  {endpointHeaders(endpoint).map(([key, value], index) => (
                    <div className="header-row" key={`${endpoint.id}_${index}_${key}`}>
                      <CommittedTextInput
                        ariaLabel={`Header name ${endpoint.name} ${index + 1}`}
                        value={key}
                        onCommit={(nextKey) => updateEndpointHeader(endpoint, index, nextKey, value, onUpdateEndpoint)}
                      />
                      <CommittedTextInput
                        ariaLabel={`Header value ${endpoint.name} ${index + 1}`}
                        value={value}
                        onCommit={(nextValue) => updateEndpointHeader(endpoint, index, key, nextValue, onUpdateEndpoint)}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Delete header ${endpoint.name} ${index + 1}`}
                        onClick={() => deleteEndpointHeader(endpoint, index, onUpdateEndpoint)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </ModalShell>
  )
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const project = useProjectStore((state) => state.project)
  const projectLibrary = useProjectStore((state) => state.projectLibrary)
  const createProject = useProjectStore((state) => state.createProject)
  const switchProject = useProjectStore((state) => state.switchProject)
  const updateProjectMetadata = useProjectStore((state) => state.updateProjectMetadata)
  const deleteProject = useProjectStore((state) => state.deleteProject)
  const addFunctionFromWorkflow = useProjectStore((state) => state.addFunctionFromWorkflow)
  const addRequestFunction = useProjectStore((state) => state.addRequestFunction)
  const addOpenAILlmFunction = useProjectStore((state) => state.addOpenAILlmFunction)
  const addGeminiLlmFunction = useProjectStore((state) => state.addGeminiLlmFunction)
  const updateFunction = useProjectStore((state) => state.updateFunction)
  const deleteFunction = useProjectStore((state) => state.deleteFunction)
  const addEndpoint = useProjectStore((state) => state.addEndpoint)
  const updateEndpoint = useProjectStore((state) => state.updateEndpoint)
  const deleteEndpoint = useProjectStore((state) => state.deleteEndpoint)
  const checkEndpointStatus = useProjectStore((state) => state.checkEndpointStatus)
  const exportProject = useProjectStore((state) => state.exportProject)
  const exportConfig = useProjectStore((state) => state.exportConfig)
  const importProject = useProjectStore((state) => state.importProject)
  const importConfig = useProjectStore((state) => state.importConfig)
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>()
  const [functionManagerOpen, setFunctionManagerOpen] = useState(false)
  const [endpointManagerOpen, setEndpointManagerOpen] = useState(false)
  const [error, setError] = useState<string>()

  const taskCounts = useMemo(() => {
    const tasks = Object.values(project.tasks)
    return {
      total: tasks.length,
      succeeded: tasks.filter((task) => task.status === 'succeeded').length,
      failed: tasks.filter((task) => task.status === 'failed').length,
    }
  }, [project.tasks])

  const functions = useMemo(() => Object.values(project.functions), [project.functions])
  const managedFunctions = useMemo(() => functions.filter((fn) => !isBuiltInFunction(fn)), [functions])
  const queueCounts = useMemo(() => endpointQueueCounts(project.tasks), [project.tasks])
  const projectOptions = useMemo(() => {
    const projects = {
      ...projectLibrary,
      [project.project.id]: project,
    }
    return Object.values(projects).sort((left, right) => left.project.name.localeCompare(right.project.name))
  }, [project, projectLibrary])

  const handleWorkflowAdd = (
    name: string,
    workflow: ComfyWorkflow,
    options?: { uiJson?: ComfyUiWorkflow; editor?: ComfyWorkflowEditorMetadata },
  ) => {
    try {
      const functionId = addFunctionFromWorkflow(name.trim() || 'ComfyUI Workflow', workflow, options)
      setError(undefined)
      return functionId
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid workflow JSON')
      return undefined
    }
  }

  const handleRequestFunctionAdd = (name: string, config: Partial<RequestFunctionConfig>) => {
    try {
      const functionId = addRequestFunction(name.trim() || 'Request Function', config)
      setError(undefined)
      return functionId
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid request function')
      return undefined
    }
  }

  const handleOpenAIFunctionAdd = (name: string, config: Partial<OpenAILlmConfig>) => {
    try {
      const functionId = addOpenAILlmFunction(name.trim() || 'OpenAI LLM Function', config)
      setError(undefined)
      return functionId
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OpenAI function')
      return undefined
    }
  }

  const handleGeminiFunctionAdd = (name: string, config: Partial<GeminiLlmConfig>) => {
    try {
      const functionId = addGeminiLlmFunction(name.trim() || 'Gemini LLM Function', config)
      setError(undefined)
      return functionId
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid Gemini function')
      return undefined
    }
  }

  const handleExportProject = async () => {
    const pkg = exportProject()
    const assetFiles = await collectProjectAssetFiles(pkg.project)
    await downloadPackage(
      'project.aicanvas',
      {
        'manifest.json': pkg.manifest,
        'project.json': pkg.project,
        'config/assets.json': assetFiles.manifest,
      },
      assetFiles.files,
    )
  }

  const handleExportConfig = async () => {
    const pkg = exportConfig()
    await downloadPackage('config.aicanvas-config', {
      'manifest.json': pkg.manifest,
      'config.json': pkg.config,
    })
  }

  const handleImport = async (file?: File) => {
    if (!file) return
    try {
      const payload = await readPackageFile(file)
      if ('project' in payload && payload.project) importProject(payload)
      if ('config' in payload && payload.config) importConfig(payload)
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const openFunctionManager = () => {
    const selectedManagedFunction = managedFunctions.find((fn) => fn.id === selectedFunctionId)
    setSelectedFunctionId(selectedManagedFunction?.id ?? managedFunctions[0]?.id)
    setFunctionManagerOpen(true)
  }

  const handleProjectDelete = () => {
    if (!window.confirm(`Delete project "${project.project.name || 'Untitled Project'}"?`)) return
    deleteProject(project.project.id)
  }

  return (
    <ModalShell label="Settings" onClose={onClose}>
      <div className="settings-page">
        <section className="settings-section project-settings-section" aria-label="Project Management">
          <div>
            <h3>Projects</h3>
            <p>Switch projects, create a blank project, edit metadata, or remove the current project.</p>
          </div>
          <div className="project-actions">
            <label className="field">
              <span>Active project</span>
              <select
                aria-label="Active project"
                value={project.project.id}
                onChange={(event) => switchProject(event.target.value)}
              >
                {projectOptions.map((item) => (
                  <option key={item.project.id} value={item.project.id}>
                    {item.project.name || 'Untitled Project'}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="section-manage-button" onClick={() => createProject()}>
              <Plus size={15} />
              New project
            </button>
            <button type="button" className="section-manage-button danger-button" onClick={handleProjectDelete}>
              <Trash2 size={15} />
              Delete project
            </button>
          </div>
          <div className="project-metadata-form">
            <label className="field">
              <span>Project name</span>
              <input
                aria-label="Project name"
                value={project.project.name}
                onChange={(event) => updateProjectMetadata({ name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Project description</span>
              <textarea
                aria-label="Project description"
                value={project.project.description ?? ''}
                onChange={(event) => updateProjectMetadata({ description: event.target.value })}
              />
            </label>
          </div>
          <span>{projectOptions.length} projects</span>
        </section>

        <section className="settings-section">
          <div>
            <h3>Functions</h3>
            <p>Manage ComfyUI workflow functions imported into this project.</p>
          </div>
          <button type="button" className="section-manage-button" onClick={openFunctionManager}>
            <Settings size={15} />
            Function Management
          </button>
          <span>{managedFunctions.length} custom functions</span>
        </section>

        <section className="settings-section">
          <div>
            <h3>ComfyUI Servers</h3>
            <p>Edit endpoints, queue capacity, connection status, and custom headers.</p>
          </div>
          <button type="button" className="section-manage-button" onClick={() => setEndpointManagerOpen(true)}>
            <Settings size={15} />
            ComfyUI Server Management
          </button>
          <span>{project.comfy.endpoints.length} servers</span>
        </section>

        <section className="settings-section">
          <div>
            <h3>Import / Export</h3>
            <p>Export the current project, export reusable configuration, or import a package.</p>
          </div>
          <div className="package-actions">
            <button type="button" onClick={handleExportProject}>
              <Download size={15} />
              Project
            </button>
            <button type="button" onClick={handleExportConfig}>
              <Download size={15} />
              Config
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={15} />
              Import
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept=".aicanvas,.aicanvas-config,.json"
            onChange={(event) => handleImport(event.target.files?.[0])}
          />
        </section>

        <footer className="panel-footer">
          <span>Tasks {taskCounts.total}</span>
          <span>OK {taskCounts.succeeded}</span>
          <span>Fail {taskCounts.failed}</span>
        </footer>
        {error ? <div className="toast-error">{error}</div> : null}
      </div>

      {functionManagerOpen ? (
        <FunctionManager
          functions={managedFunctions}
          comfyEndpoints={project.comfy.endpoints}
          selectedFunctionId={selectedFunctionId}
          onSelectFunction={setSelectedFunctionId}
          onAddWorkflow={handleWorkflowAdd}
          onAddRequestFunction={handleRequestFunctionAdd}
          onAddOpenAIFunction={handleOpenAIFunctionAdd}
          onAddGeminiFunction={handleGeminiFunctionAdd}
          onUpdateFunction={updateFunction}
          onDeleteFunction={deleteFunction}
          onUpdateEndpoint={updateEndpoint}
          onClose={() => setFunctionManagerOpen(false)}
        />
      ) : null}

      {endpointManagerOpen ? (
        <EndpointManager
          endpoints={project.comfy.endpoints}
          functions={managedFunctions}
          queueCounts={queueCounts}
          onAddEndpoint={addEndpoint}
          onUpdateEndpoint={updateEndpoint}
          onDeleteEndpoint={deleteEndpoint}
          onTestEndpoint={(endpoint) => void checkEndpointStatus(endpoint.id)}
          onClose={() => setEndpointManagerOpen(false)}
        />
      ) : null}
    </ModalShell>
  )
}

export function LeftPanel() {
  const project = useProjectStore((state) => state.project)
  const selectNode = useProjectStore((state) => state.selectNode)
  const undoLastProjectChange = useProjectStore((state) => state.undoLastProjectChange)
  const redoProjectChange = useProjectStore((state) => state.redoProjectChange)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [previewResource, setPreviewResource] = useState<Resource | undefined>()
  const previewTimerRef = useRef<number | undefined>(undefined)
  const resources = Object.values(project.resources)
  const historyEntries = [
    ...(project.history?.undoStack ?? []).toReversed().map((entry) => ({ entry, stack: 'undo' as const })),
    ...(project.history?.redoStack ?? []).toReversed().map((entry) => ({ entry, stack: 'redo' as const })),
  ]
  const focusResourceNode = (resource: Resource) => {
    setPreviewResource(undefined)
    const nodeId = resourceOwnerNodeId(project, resource)
    if (!nodeId) return
    selectNode(nodeId)
    window.dispatchEvent(new CustomEvent('infinity-focus-node', { detail: { nodeId } }))
  }
  useEffect(
    () => () => {
      if (previewTimerRef.current === undefined) return
      window.clearTimeout(previewTimerRef.current)
    },
    [],
  )

  return (
    <aside
      className={`assets-dock ${assetsOpen || historyOpen ? 'is-open' : ''}`}
      aria-label="Assets panel"
      onMouseLeave={() => {
        setAssetsOpen(false)
        setHistoryOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setAssetsOpen(false)
          setHistoryOpen(false)
        }
      }}
    >
      <div className="assets-dock-stack">
        <button
          type="button"
          className="assets-dock-button"
          aria-label="Assets"
          aria-expanded={assetsOpen}
          aria-controls="assets-popover"
          onClick={() => {
            setAssetsOpen((value) => !value)
            setHistoryOpen(false)
          }}
        >
          <FileInput size={20} />
        </button>
        <button
          type="button"
          className="assets-dock-button"
          aria-label="History"
          aria-expanded={historyOpen}
          aria-controls="history-popover"
          onClick={() => {
            setHistoryOpen((value) => !value)
            setAssetsOpen(false)
          }}
        >
          <History size={20} />
        </button>
      </div>
      {assetsOpen ? (
        <section id="assets-popover" className="side-panel left-panel asset-popover" aria-label="Assets popover">
          <div className="panel-title asset-popover-title">
            <FileInput size={16} />
            <h2>Assets</h2>
            <span>{resources.length}</span>
          </div>
          <div className="item-list asset-list" aria-label="Asset list">
            {resources.length > 0 ? (
              resources.map((resource) => (
                <button
                  key={resource.id}
                  type="button"
                  className="asset-list-item"
                  onClick={() => {
                    if (previewTimerRef.current !== undefined) {
                      window.clearTimeout(previewTimerRef.current)
                    }
                    previewTimerRef.current = window.setTimeout(() => {
                      setPreviewResource(resource)
                      previewTimerRef.current = undefined
                    }, 160)
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    if (previewTimerRef.current !== undefined) {
                      window.clearTimeout(previewTimerRef.current)
                      previewTimerRef.current = undefined
                    }
                    focusResourceNode(resource)
                  }}
                >
                  <ResourceListPreview resource={resource} />
                  <span className="asset-list-copy">
                    <span>{resourceLabel(resource)}</span>
                    <small>{resourceSummary(resource)}</small>
                  </span>
                  <strong>{resource.type}</strong>
                </button>
              ))
            ) : (
              <div className="empty-list">No assets</div>
            )}
          </div>
        </section>
      ) : null}
      {historyOpen ? (
        <section id="history-popover" className="side-panel left-panel asset-popover history-popover" aria-label="History popover">
          <div className="panel-title asset-popover-title">
            <History size={16} />
            <h2>History</h2>
            <span>{historyEntries.length}</span>
          </div>
          <div className="history-dock-actions">
            <button type="button" aria-label="Undo last operation" onClick={undoLastProjectChange}>
              <RotateCcw size={15} />
              <span>Undo</span>
            </button>
            <button type="button" aria-label="Redo last operation" onClick={redoProjectChange}>
              <RotateCw size={15} />
              <span>Redo</span>
            </button>
          </div>
          <div className="item-list asset-list operation-history-list" aria-label="Operation history list">
            {historyEntries.length > 0 ? (
              historyEntries.map(({ entry, stack }) => {
                const assetIds = entry.preview.assetIds ?? entry.affectedIds.assetIds ?? []
                const previewResources = assetIds.map((resourceId) => project.resources[resourceId]).filter((item): item is Resource => Boolean(item))
                const focusNodeId = (entry.preview.nodeIds ?? entry.affectedIds.nodeIds ?? []).find((nodeId) =>
                  project.canvas.nodes.some((node) => node.id === nodeId),
                )

                return (
                  <article
                    key={`${stack}-${entry.id}`}
                    className={`history-command-row history-command-row-${stack}`}
                    onDoubleClick={() => {
                      if (!focusNodeId) return
                      selectNode(focusNodeId)
                      window.dispatchEvent(new CustomEvent('infinity-focus-node', { detail: { nodeId: focusNodeId } }))
                    }}
                  >
                    <div className="history-command-main">
                      <strong>{entry.preview.title || entry.label}</strong>
                      <small>
                        {entry.preview.subtitle ?? entry.transactionType}
                        <span>{stack === 'redo' ? 'redo' : 'undo'}</span>
                      </small>
                    </div>
                    {previewResources.length > 0 ? (
                      <div className="history-command-assets" aria-label={`${entry.label} assets`}>
                        {previewResources.slice(0, 4).map((resource) => (
                          <button
                            key={resource.id}
                            type="button"
                            className="history-command-asset"
                            aria-label={`Preview ${resourceLabel(resource)}`}
                            onClick={() => setPreviewResource(resource)}
                          >
                            <ResourceListPreview resource={resource} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )
              })
            ) : (
              <div className="empty-list">No history</div>
            )}
          </div>
        </section>
      ) : null}
      <FullResourcePreviewModal
        resource={previewResource}
        resources={previewResource ? [previewResource] : []}
        onClose={() => setPreviewResource(undefined)}
      />
    </aside>
  )
}

export function RightPanel() {
  const project = useProjectStore((state) => state.project)
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId)
  const selectNode = useProjectStore((state) => state.selectNode)
  const fetchComfyHistory = useProjectStore((state) => state.fetchComfyHistory)
  const [expandedTaskId, setExpandedTaskId] = useState<string | undefined>()
  const [historyDialog, setHistoryDialog] = useState<{
    title: string
    status: 'loading' | 'loaded' | 'failed'
    content: string
  }>()
  const selectedNode = project.canvas.nodes.find((node) => node.id === selectedNodeId)
  const selectedRunTask =
    selectedNode?.type === 'result_group' && typeof selectedNode.data.taskId === 'string'
      ? project.tasks[selectedNode.data.taskId]
      : undefined
  const selectedRunHistory = getNodeRunHistory(project, selectedNodeId)
  const projectTasks = Object.values(project.tasks).reverse()
  const queueCounts = useMemo(() => endpointQueueCounts(project.tasks), [project.tasks])
  const focusCanvasNode = (nodeId: string) => {
    selectNode(nodeId)
    window.dispatchEvent(new CustomEvent('infinity-focus-node', { detail: { nodeId } }))
  }
  const openHistory = (runLabel: string, endpointId: string | undefined, promptId: string | undefined) => {
    if (!endpointId || !promptId) return
    setHistoryDialog({ title: `${runLabel} ComfyUI history`, status: 'loading', content: 'Loading history...' })
    void fetchComfyHistory(endpointId, promptId)
      .then((history) => {
        setHistoryDialog({
          title: `${runLabel} ComfyUI history`,
          status: 'loaded',
          content: JSON.stringify(history, null, 2),
        })
      })
      .catch((err) => {
        setHistoryDialog({
          title: `${runLabel} ComfyUI history`,
          status: 'failed',
          content: err instanceof Error ? err.message : 'Failed to load ComfyUI history',
        })
      })
  }

  return (
    <aside className="side-panel right-panel">
      {historyDialog ? (
        <ModalShell label="ComfyUI history" onClose={() => setHistoryDialog(undefined)}>
          <div className="history-modal-body">
            <h3>{historyDialog.title}</h3>
            <pre className={`json-code run-workflow-json history-modal-json history-modal-${historyDialog.status}`}>
              {historyDialog.status === 'loaded' ? highlightedJson(historyDialog.content) : historyDialog.content}
            </pre>
          </div>
        </ModalShell>
      ) : null}
      <section>
        <div className="panel-title">
          <Route size={16} />
          <h2>Inspector</h2>
        </div>
        {selectedNode ? (
          <div className="inspector-block">
            <strong>{selectedNode.type}</strong>
            <code>{selectedNode.id}</code>
            {selectedRunTask ? <RunInspector project={project} task={selectedRunTask} onFocusNode={focusCanvasNode} /> : null}
            <pre>{JSON.stringify(selectedNode.data, null, 2)}</pre>
          </div>
        ) : (
          <div className="inspector-empty">No selection</div>
        )}
      </section>
      <section>
        <div className="panel-title">
          <Network size={16} />
          <h2>ComfyUI Servers</h2>
        </div>
        <EndpointStatusList endpoints={project.comfy.endpoints} queueCounts={queueCounts} />
      </section>
      {selectedNode ? (
        <section>
          <div className="panel-title">
            <Route size={16} />
            <h2>Run Queue</h2>
          </div>
          {selectedRunHistory.length > 0 ? (
            <div className="history-list" aria-label="Selected node run history">
              {selectedRunHistory.map((item) => (
                <div key={item.taskId} className={`history-row history-row-${item.status}`}>
                  <div>
                    <strong>{item.runLabel}</strong>
                    <span>{item.status}</span>
                  </div>
                  <code>{item.taskId}</code>
                  <span>{item.endpointName ?? 'endpoint unknown'}</span>
                  <div className="history-row-actions">
                    {item.resultNodeId ? (
                      <button
                        type="button"
                        onClick={() => focusCanvasNode(item.resultNodeId!)}
                        aria-label={`Locate ${item.runLabel} result node`}
                      >
                        Locate node
                      </button>
                    ) : null}
                    {item.historyPath && item.endpointId && item.comfyPromptId ? (
                      <button
                        type="button"
                        onClick={() => openHistory(item.runLabel, item.endpointId, item.comfyPromptId)}
                        aria-label={`Open ComfyUI history for ${item.runLabel}`}
                      >
                        Open history
                      </button>
                    ) : item.historyPath ? (
                      <code>{item.historyPath}</code>
                    ) : (
                      <em>No ComfyUI prompt id</em>
                    )}
                  </div>
                  {item.errorMessage ? <p className="job-error">{item.errorMessage}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="inspector-empty">No runs for selected node</div>
          )}
        </section>
      ) : null}
      {!selectedNode ? (
        <section>
          <div className="panel-title">
            <Zap size={16} />
            <h2>Project Tasks</h2>
          </div>
          <div className="job-list">
            {projectTasks.map((task) => (
              <ProjectTaskCard
                key={task.id}
                project={project}
                task={task}
                expanded={expandedTaskId === task.id}
                onToggle={() => setExpandedTaskId((current) => (current === task.id ? undefined : task.id))}
                onFocusNode={focusCanvasNode}
              />
            ))}
            {projectTasks.length === 0 ? <div className="inspector-empty">No tasks</div> : null}
          </div>
        </section>
      ) : null}
    </aside>
  )
}
