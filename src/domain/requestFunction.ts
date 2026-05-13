import type {
  FunctionOutputDef,
  GenerationFunction,
  PrimitiveInputValue,
  RequestFunctionConfig,
  Resource,
  ResourceRef,
  ResourceType,
} from './types'

type RequestInputValues = Record<string, PrimitiveInputValue | ResourceRef>

export type CompiledRequestFunctionRequest = {
  url: string
  init: RequestInit
  responseParse: RequestFunctionConfig['responseParse']
}

export type ExtractedRequestOutput = {
  key: string
  label: string
  type: ResourceType
  values: string[]
}

export const requestMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const isRequestFunction = (fn: GenerationFunction) => fn.workflow.format === 'http_request'

export function createRequestFunction(id: string, name: string, now: string): GenerationFunction {
  return {
    id,
    name,
    description: 'Generic HTTP request function',
    category: 'Request',
    workflow: {
      format: 'http_request',
      rawJson: {},
    },
    request: {
      url: 'https://example.com/api',
      method: 'GET',
      headers: {},
      body: '',
      responseParse: 'json',
    },
    inputs: [],
    outputs: [
      {
        key: 'result',
        label: 'Result',
        type: 'text',
        bind: {},
        extract: { source: 'response_json_path', path: '$' },
      },
    ],
    runtimeDefaults: {
      runCount: 1,
      seedPolicy: { mode: 'randomize_all_before_submit' },
    },
    createdAt: now,
    updatedAt: now,
  }
}

export const mergedRequestConfig = (
  base: RequestFunctionConfig | undefined,
  patch?: Partial<RequestFunctionConfig>,
): RequestFunctionConfig => ({
  url: patch?.url ?? base?.url ?? 'https://example.com/api',
  method: (patch?.method ?? base?.method ?? 'GET').toUpperCase(),
  headers: { ...(base?.headers ?? {}), ...(patch?.headers ?? {}) },
  body: patch?.body ?? base?.body ?? '',
  responseParse: patch?.responseParse ?? base?.responseParse ?? 'json',
})

const isResourceRef = (value: PrimitiveInputValue | ResourceRef | undefined): value is ResourceRef =>
  typeof value === 'object' && value !== null && 'resourceId' in value

const valueFromResource = (resource: Resource | undefined): PrimitiveInputValue => {
  if (!resource) return null
  if (typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value) return resource.value.url
  return resource.value
}

const requestInputValue = (
  value: PrimitiveInputValue | ResourceRef | undefined,
  resources: Record<string, Resource>,
): PrimitiveInputValue | undefined => {
  if (isResourceRef(value)) return valueFromResource(resources[value.resourceId])
  return value
}

const normalizePath = (path: string) =>
  path
    .trim()
    .replace(/^\$\./, '')
    .replace(/^\$/, '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)

const setJsonPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = normalizePath(path)
  if (parts.length === 0) return value

  let cursor: Record<string, unknown> = target
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]!] = value
  return target
}

const maybeJsonBody = (body: string): unknown => {
  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

const compileBody = (
  body: string,
  inputPatches: { path: string; value: PrimitiveInputValue }[],
): string => {
  if (inputPatches.length === 0) return body
  let parsed = maybeJsonBody(body)

  for (const patch of inputPatches) {
    if (!patch.path.trim() || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      parsed = patch.value ?? ''
    } else {
      parsed = setJsonPath(parsed as Record<string, unknown>, patch.path, patch.value)
    }
  }

  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
}

export function compileRequestFunctionRequest(
  fn: GenerationFunction,
  inputValues: RequestInputValues,
  resources: Record<string, Resource>,
): CompiledRequestFunctionRequest {
  const config = mergedRequestConfig(fn.request)
  const url = new URL(config.url || 'https://example.com/api')
  const headers: Record<string, string> = { ...config.headers }
  const bodyPatches: { path: string; value: PrimitiveInputValue }[] = []

  for (const input of fn.inputs) {
    const value = requestInputValue(inputValues[input.key] ?? input.defaultValue, resources)
    if (value === undefined || value === null || value === '') {
      if (input.required) throw new Error(`Required input missing: ${input.key}`)
      continue
    }

    const target = input.bind.requestTarget ?? 'url_param'
    const path = input.bind.path.trim()
    if (target === 'url_param') {
      url.searchParams.set(path, String(value))
    } else if (target === 'header') {
      headers[path] = String(value)
    } else {
      bodyPatches.push({ path, value })
    }
  }

  const method = (config.method || 'GET').toUpperCase()
  const body = compileBody(config.body, bodyPatches)
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD' && body) init.body = body

  return {
    url: url.toString(),
    init,
    responseParse: config.responseParse,
  }
}

const jsonPathTokens = (path: string) => {
  const value = path.trim().replace(/^\$\.?/, '')
  if (!value) return []
  const tokens: Array<string | number> = []
  for (const part of value.split('.')) {
    const keyMatch = /^([^[]*)/.exec(part)
    const key = keyMatch?.[1]
    if (key) tokens.push(key)
    for (const match of part.matchAll(/\[(\d+)\]/g)) tokens.push(Number(match[1]))
  }
  return tokens
}

const valueAtJsonPath = (source: unknown, path: string): unknown => {
  let cursor = source
  for (const token of jsonPathTokens(path)) {
    if (typeof token === 'number') {
      if (!Array.isArray(cursor)) return undefined
      cursor = cursor[token]
    } else {
      if (!cursor || typeof cursor !== 'object') return undefined
      cursor = (cursor as Record<string, unknown>)[token]
    }
  }
  return cursor
}

const stringifyExtractedValue = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const regexValues = (text: string, output: FunctionOutputDef) => {
  const pattern = output.extract.pattern || output.bind.path || '(.+)'
  const flags = output.extract.multiple ? 'g' : ''
  const regexp = new RegExp(pattern, flags)
  const values: string[] = []

  if (output.extract.multiple) {
    for (const match of text.matchAll(regexp)) values.push(match[1] ?? match[0])
  } else {
    const match = regexp.exec(text)
    if (match) values.push(match[1] ?? match[0])
  }

  return values
}

export function extractRequestFunctionOutputs(
  responseText: string,
  responseJson: unknown,
  outputs: FunctionOutputDef[],
): ExtractedRequestOutput[] {
  return outputs.map((output) => {
    let values: string[] = []
    if (output.extract.source === 'response_text_regex') {
      values = regexValues(responseText, output)
    } else if (output.extract.source === 'response_json_path') {
      const extracted = valueAtJsonPath(responseJson, output.extract.path || output.bind.path || '$')
      const extractedValues = Array.isArray(extracted) && output.extract.multiple ? extracted : [extracted]
      values = extractedValues.map(stringifyExtractedValue).filter((value): value is string => value !== undefined)
    }

    return {
      key: output.key,
      label: output.label,
      type: output.type,
      values,
    }
  })
}
