import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/react'
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  Eye,
  FileText,
  Hash,
  Layers,
  Play,
  RefreshCcw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { defaultOpenAILlmConfig, isOpenAILlmFunction, mergedOpenAILlmConfig } from '../domain/openaiLlm'
import { defaultGeminiLlmConfig, isGeminiLlmFunction, mergedGeminiLlmConfig } from '../domain/geminiLlm'
import { defaultOpenAIImageConfig, isOpenAIImageFunction, mergedOpenAIImageConfig } from '../domain/openaiImage'
import { defaultGeminiImageConfig, isGeminiImageFunction, mergedGeminiImageConfig } from '../domain/geminiImage'
import { readFileAsMediaResource, type MediaResourceKind, type MediaResourcePayload } from '../domain/resourceFiles'
import { projectStore } from '../store/projectStore'
import type {
  FunctionInputDef,
  FunctionOutputDef,
  GeminiImageConfig,
  GeminiLlmConfig,
  GeminiLlmContentPart,
  GeminiLlmMessage,
  GenerationFunction,
  ExecutionTask,
  OpenAIImageConfig,
  OpenAILlmConfig,
  OpenAILlmContentPart,
  OpenAILlmMessage,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
} from '../domain/types'
import { ResourcePreview } from './ResourcePreview'

type WorkbenchNodeData = {
  resourceId?: string
  resourceType?: string
  functionId?: string
  title?: string
  taskId?: string
  runIndex?: number
  runTotal?: number
  status?: string
  endpointId?: string
  size?: {
    width?: number
    height?: number
  }
  inputValues?: Record<string, PrimitiveInputValue | ResourceRef>
  runtime?: {
    runCount?: number
  }
  openaiConfig?: OpenAILlmConfig
  geminiConfig?: GeminiLlmConfig
  openaiImageConfig?: OpenAIImageConfig
  geminiImageConfig?: GeminiImageConfig
  missingInputKeys?: string[]
  resources?: Array<{ resourceId: string; type: string }>
  sourceFunctionNodeId?: string
  error?: {
    code?: string
    message: string
  }
  resourcesById: Record<string, Resource>
  functionsById: Record<string, GenerationFunction>
  tasksById?: Record<string, ExecutionTask>
  nodeReferences?: Array<{
    nodeId: string
    title: string
    type: string
    direction: 'incoming' | 'outgoing'
  }>
  onFocusReferenceNode?: (nodeId: string) => void
  onRunFunction: (nodeId: string) => void
  onRerunResultNode: (nodeId: string) => void
  onCancelResultRun: (nodeId: string) => void
  onUpdateFunctionRunCount: (nodeId: string, runCount: number) => void
  onResizeNode?: (nodeId: string, size: { width: number; height: number }) => void
  onUpdateOpenAiConfig: (nodeId: string, patch: Partial<OpenAILlmConfig>) => void
  onUpdateGeminiConfig: (nodeId: string, patch: Partial<GeminiLlmConfig>) => void
  onUpdateOpenAiImageConfig: (nodeId: string, patch: Partial<OpenAIImageConfig>) => void
  onUpdateGeminiImageConfig: (nodeId: string, patch: Partial<GeminiImageConfig>) => void
  onDeleteNode: (nodeId: string) => void
  onRenameNode: (nodeId: string, title: string) => void
  onUpdateFunctionInputValue: (nodeId: string, inputKey: string, value: PrimitiveInputValue) => void
  onUpdateTextResourceValue: (resourceId: string, value: string) => void
  onUpdateNumberResourceValue: (resourceId: string, value: number) => void
  onReplaceResourceMedia: (resourceId: string, type: MediaResourceKind, media: MediaResourcePayload) => void
}

const inputHandleId = (inputKey: string) => `input:${inputKey}`
const outputHandleId = (outputKey: string) => `output:${outputKey}`
const resourceHandleId = (resourceId: string) => `resource:${resourceId}`
const resultHandleId = (resourceId: string) => `result:${resourceId}`
const activeResultStatuses = new Set(['queued', 'running', 'fetching_outputs'])

const isResourceRef = (value: PrimitiveInputValue | ResourceRef | undefined): value is ResourceRef =>
  typeof value === 'object' && value !== null && 'resourceId' in value

const connectedPrimitiveLabel = (resource: Resource | undefined, fallback: string) => {
  if (!resource) return fallback
  if (typeof resource.value === 'object' && resource.value !== null && 'filename' in resource.value) {
    return String(resource.value.filename ?? resource.name ?? resource.id)
  }
  return String(resource.value)
}

function optionalPrimitiveValue(input: FunctionInputDef, value: PrimitiveInputValue | ResourceRef | undefined) {
  if (isResourceRef(value)) return undefined
  if (value !== undefined && value !== null) return value
  return input.defaultValue ?? (input.type === 'number' ? 0 : '')
}

function primitiveValueAtPath(target: unknown, path?: string) {
  if (!target || typeof target !== 'object' || !path) return undefined
  let cursor: unknown = target
  for (const part of path.split('.').filter(Boolean)) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return typeof cursor === 'string' || typeof cursor === 'number' || cursor === null ? cursor : undefined
}

const normalizedWorkflowKey = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '')

function primitiveValueFromWorkflowInputs(node: unknown, input: FunctionInputDef) {
  if (!node || typeof node !== 'object' || !('inputs' in node)) return undefined
  const inputs = (node as { inputs?: unknown }).inputs
  if (!inputs || typeof inputs !== 'object') return undefined

  const directCandidates = [input.key, input.label, input.bind.path.split('.').at(-1) ?? ''].filter(Boolean)
  for (const candidate of directCandidates) {
    const value = primitiveValueAtPath(inputs, candidate)
    if (value !== undefined) return value
  }

  const normalizedCandidates = new Set(directCandidates.map(normalizedWorkflowKey))
  const matchedKey = Object.keys(inputs).find((key) => normalizedCandidates.has(normalizedWorkflowKey(key)))
  return matchedKey ? primitiveValueAtPath(inputs, matchedKey) : undefined
}

function workflowPrimitiveValue(functionDef: GenerationFunction | undefined, input: FunctionInputDef) {
  const workflow = functionDef?.workflow.rawJson
  if (!workflow) return undefined
  const node =
    (input.bind.nodeId ? workflow[input.bind.nodeId] : undefined) ??
    (input.bind.nodeTitle
      ? Object.values(workflow).find((workflowNode) => workflowNode._meta?.title?.trim() === input.bind.nodeTitle)
      : undefined)
  const keyedValue = primitiveValueFromWorkflowInputs(node, input)
  return keyedValue !== undefined ? keyedValue : primitiveValueAtPath(node, input.bind.path)
}

function OptionalPrimitiveInput({
  input,
  nodeId,
  value,
  onUpdate,
  minHeight,
}: {
  input: FunctionInputDef
  nodeId: string
  value: PrimitiveInputValue
  onUpdate: (nodeId: string, inputKey: string, value: PrimitiveInputValue) => void
  minHeight?: number
}) {
  const label = `${input.label || input.key} inline value`
  const externalTextValue = String(value ?? '')
  const textComposingRef = useRef(false)
  const [textDraft, setTextDraft] = useState({
    draft: externalTextValue,
    editing: false,
  })
  const visibleTextValue = textDraft.editing ? textDraft.draft : externalTextValue
  const commitTextDraft = (nextValue: string) => {
    setTextDraft({ draft: nextValue, editing: false })
    if (nextValue !== externalTextValue) onUpdate(nodeId, input.key, nextValue)
  }

  if (input.type === 'number') {
    return (
      <input
        aria-label={label}
        className="slot-inline-input nodrag nopan"
        inputMode="decimal"
        type="number"
        value={Number.isFinite(Number(value)) ? Number(value) : 0}
        onChange={(event) => {
          const nextValue = Number(event.target.value)
          if (Number.isFinite(nextValue)) onUpdate(nodeId, input.key, nextValue)
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      />
    )
  }

  return (
    <textarea
      aria-label={label}
      className="slot-inline-input slot-inline-textarea nodrag nopan"
      rows={5}
      style={minHeight ? { minHeight } : undefined}
      value={visibleTextValue}
      onFocus={() =>
        setTextDraft((current) => ({
          draft: current.editing ? current.draft : externalTextValue,
          editing: true,
        }))
      }
      onChange={(event) => {
        const nextValue = event.target.value
        setTextDraft({
          draft: nextValue,
          editing: true,
        })
      }}
      onCompositionStart={() => {
        textComposingRef.current = true
        setTextDraft((current) => ({
          draft: current.draft,
          editing: true,
        }))
      }}
      onCompositionEnd={(event) => {
        const nextValue = event.currentTarget.value
        textComposingRef.current = false
        setTextDraft({
          draft: nextValue,
          editing: true,
        })
      }}
      onBlur={(event) => {
        if (textComposingRef.current) return
        commitTextDraft(event.currentTarget.value)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}

function FunctionInputSlot({
  input,
  missing,
  nodeId,
  value,
  resourcesById,
  onUpdateInputValue,
  workflowValue,
  textInputMinHeight,
}: {
  input: FunctionInputDef
  missing?: boolean
  nodeId: string
  value?: PrimitiveInputValue | ResourceRef
  resourcesById: Record<string, Resource>
  onUpdateInputValue: (nodeId: string, inputKey: string, value: PrimitiveInputValue) => void
  workflowValue?: PrimitiveInputValue
  textInputMinHeight?: number
}) {
  const canEditInline = !input.required && (input.type === 'text' || input.type === 'number')
  const connectedRef = isResourceRef(value) ? value : undefined
  const connectedResource = connectedRef ? resourcesById[connectedRef.resourceId] : undefined
  const primitiveValue =
    canEditInline && !isResourceRef(value)
      ? value !== undefined && value !== null
        ? value
        : workflowValue !== undefined
          ? workflowValue
          : optionalPrimitiveValue(input, value)
      : undefined

  return (
    <div
      aria-invalid={missing ? 'true' : undefined}
      className={`slot-row input-slot ${input.required ? 'required-slot' : 'optional-slot'} ${canEditInline ? 'primitive-slot' : ''} ${canEditInline && input.type === 'text' ? 'text-primitive-slot' : ''} ${canEditInline && input.type === 'number' ? 'number-primitive-slot' : ''} ${connectedRef ? 'connected-slot' : ''} ${missing ? 'missing-slot' : ''}`}
      data-testid={`function-input-slot-${input.key}`}
    >
      <Handle
        className="slot-handle"
        data-slot-handle={inputHandleId(input.key)}
        id={inputHandleId(input.key)}
        position={Position.Left}
        type="target"
      />
      <div className="slot-copy">
        <span>{input.label || input.key}</span>
        <small>{input.type}</small>
      </div>
      {canEditInline ? (
        connectedRef ? (
          <span
            className="slot-connected-value"
            title={connectedPrimitiveLabel(connectedResource, connectedRef.resourceId)}
          >
            {connectedPrimitiveLabel(connectedResource, connectedRef.resourceId)}
          </span>
        ) : (
          <OptionalPrimitiveInput
            input={input}
            nodeId={nodeId}
            value={primitiveValue ?? ''}
            minHeight={input.type === 'text' ? textInputMinHeight : undefined}
            onUpdate={onUpdateInputValue}
          />
        )
      ) : null}
      <span className="slot-requirement">{missing ? 'Missing' : input.required ? 'Required' : 'Optional'}</span>
    </div>
  )
}

function FunctionOutputSlot({ output }: { output: FunctionOutputDef }) {
  return (
    <div className="slot-row output-slot" data-testid={`function-output-slot-${output.key}`}>
      <div className="slot-copy">
        <span>{output.label || output.key}</span>
        <small>{output.type}</small>
      </div>
      <Handle
        className="slot-handle"
        data-slot-handle={outputHandleId(output.key)}
        id={outputHandleId(output.key)}
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function SlotSpacer() {
  return <div className="slot-spacer" aria-hidden="true" />
}

function outputKeyForResource(resource: Resource) {
  return resource.source.outputKey ?? resource.type
}

function ResultOutputSlot({ resource }: { resource: Resource }) {
  const label = outputKeyForResource(resource)
  const name = resource.name ?? resource.id

  return (
    <div className="slot-row output-slot result-output-slot" data-testid={`result-output-slot-${resource.id}`}>
      <div className="slot-copy">
        <span>{label}</span>
        <small>{name}</small>
      </div>
      <Handle
        className="slot-handle"
        data-slot-handle={resultHandleId(resource.id)}
        id={resultHandleId(resource.id)}
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

function PendingResultOutputSlot({ output }: { output: FunctionOutputDef }) {
  return (
    <div className="slot-row output-slot pending-slot" data-testid={`result-pending-output-slot-${output.key}`}>
      <div className="slot-copy">
        <span>{output.label || output.key}</span>
        <small>{output.type}</small>
      </div>
      <Handle
        className="slot-handle"
        data-slot-handle={`pending:${output.key}`}
        id={`pending:${output.key}`}
        position={Position.Right}
        type="source"
      />
    </div>
  )
}

const isMediaResource = (resource: Resource): resource is Resource & { type: MediaResourceKind } =>
  resource.type === 'image' || resource.type === 'video' || resource.type === 'audio'

const mediaValue = (resource: Resource) =>
  typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value ? resource.value : undefined

const mediaAccept = (type: MediaResourceKind) => `${type}/*`

const fetchResourceBlob = async (resource: Resource) => {
  if (projectStore.getState().project.resources[resource.id]) {
    return projectStore.getState().fetchResourceBlob(resource.id)
  }
  const media = mediaValue(resource)
  if (!media?.url) throw new Error(`Resource is missing a URL: ${resource.id}`)
  const response = await fetch(media.url)
  if (!response.ok) throw new Error(`Failed to fetch resource: ${response.status}`)
  return response.blob()
}

const copyResource = async (resource: Resource) => {
  const media = mediaValue(resource)
  if (!media?.url) {
    await navigator.clipboard?.writeText(String(resource.value))
    return
  }

  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return

  const blob = await fetchResourceBlob(resource)
  const mimeType = blob.type || media.mimeType
  const clipboardBlob = blob.type ? blob : blob.slice(0, blob.size, mimeType)
  await navigator.clipboard.write([new ClipboardItem({ [mimeType]: clipboardBlob })])
}

const resourceDownloadName = (resource: Resource) => {
  const media = mediaValue(resource)
  if (media?.filename) return media.filename
  if (resource.type === 'text' || resource.type === 'number') {
    const name = resource.name ?? resource.id
    return name.toLowerCase().endsWith('.txt') ? name : `${name}.txt`
  }
  return resource.name ?? resource.id
}

async function downloadResource(resource: Resource) {
  const media = mediaValue(resource)
  const anchor = document.createElement('a')
  let objectUrl: string | undefined

  if (media?.url) {
    const blob = await fetchResourceBlob(resource)
    objectUrl = URL.createObjectURL(blob)
    anchor.href = objectUrl
  } else {
    const blob = new Blob([String(resource.value)], { type: 'text/plain;charset=utf-8' })
    objectUrl = URL.createObjectURL(blob)
    anchor.href = objectUrl
  }

  anchor.download = resourceDownloadName(resource)
  anchor.click()
  if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function usePreviewMediaSource(resource: Resource) {
  const media = mediaValue(resource)
  const key =
    media?.url && (media.comfy || resource.metadata?.endpointId)
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
    fetchResourceBlob(resource)
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

function FullResourcePreview({ resource }: { resource: Resource }) {
  const mediaSource = usePreviewMediaSource(resource)
  const label = resourceDownloadName(resource)

  if (resource.type === 'image' && mediaSource) {
    return <img className="full-preview-image" src={String(mediaSource)} alt={label} />
  }

  if (resource.type === 'video' && mediaSource) {
    return <video className="full-preview-video" src={String(mediaSource)} controls aria-label={`${label} full preview`} />
  }

  if (resource.type === 'audio' && mediaSource) {
    return <audio className="full-preview-audio" src={String(mediaSource)} controls aria-label={`${label} full preview`} />
  }

  const textValue = typeof resource.value === 'string' ? resource.value : JSON.stringify(resource.value, null, 2)
  return <pre className="full-preview-text">{textValue}</pre>
}

function sameTypePreviewResources(
  resourcesById: Record<string, Resource>,
  resource: Resource,
  fallbackFunctionNodeId?: string,
  fallbackWorkflowFunctionId?: string,
) {
  const functionNodeId = resource.source.functionNodeId ?? fallbackFunctionNodeId
  const workflowFunctionId = resource.metadata?.workflowFunctionId ?? fallbackWorkflowFunctionId
  const candidates = Object.values(resourcesById).filter(
    (candidate) =>
      candidate.source.kind === 'function_output' &&
      candidate.type === resource.type &&
      ((Boolean(functionNodeId) && candidate.source.functionNodeId === functionNodeId) ||
        (Boolean(workflowFunctionId) && candidate.metadata?.workflowFunctionId === workflowFunctionId)),
  )

  if (candidates.some((candidate) => candidate.id === resource.id)) return candidates
  return [resource, ...candidates]
}

function FullResourcePreviewModal({
  resource,
  resources = [],
  onClose,
}: {
  resource?: Resource
  resources?: Resource[]
  onClose: () => void
}) {
  const [previewState, setPreviewState] = useState<{
    initialResourceId?: string
    currentResourceId?: string
  }>({})

  const initialResourceId = resource?.id
  const currentResourceId =
    previewState.initialResourceId === initialResourceId ? previewState.currentResourceId : initialResourceId
  const currentIndex = Math.max(
    0,
    resources.findIndex((item) => item.id === currentResourceId),
  )
  const currentResource = resources[currentIndex] ?? resource
  const canNavigate = resources.length > 1
  const setCurrentResourceId = (id: string | undefined) => {
    setPreviewState({ initialResourceId, currentResourceId: id })
  }
  const goToPrevious = () => {
    if (!canNavigate) return
    setCurrentResourceId(resources[(currentIndex - 1 + resources.length) % resources.length]?.id)
  }
  const goToNext = () => {
    if (!canNavigate) return
    setCurrentResourceId(resources[(currentIndex + 1) % resources.length]?.id)
  }

  useEffect(() => {
    if (!resource || !canNavigate) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goToPrevious()
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  if (!resource || !currentResource) return null

  const label = resourceDownloadName(currentResource)
  const dialog = (
    <div
      className="full-preview-backdrop nodrag nopan"
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-label={`Preview ${label}`}
        aria-modal="true"
        className="full-preview-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="full-preview-header">
          <div>
            <h2>{label}</h2>
            <span>{currentResource.type}</span>
          </div>
          <div className="full-preview-header-actions">
            {canNavigate ? (
              <div className="full-preview-nav" aria-label="Preview navigation">
                <button type="button" aria-label="Previous result" onClick={goToPrevious}>
                  <ChevronLeft size={16} />
                </button>
                <span className="full-preview-counter">
                  {currentIndex + 1} / {resources.length}
                </span>
                <button type="button" aria-label="Next result" onClick={goToNext}>
                  <ChevronRight size={16} />
                </button>
              </div>
            ) : null}
            <button type="button" aria-label="Close full preview" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="full-preview-body">
          <FullResourcePreview resource={currentResource} />
        </div>
      </section>
    </div>
  )

  return createPortal(dialog, document.body)
}

function ResourceActions({
  canUpload,
  fileInputRef,
  resource,
  onUpload,
}: {
  canUpload: boolean
  fileInputRef?: RefObject<HTMLInputElement | null>
  resource: Resource
  onUpload?: (file: File | undefined) => void
}) {
  const hasDownloadableValue = resource.type === 'text' || resource.type === 'number' || Boolean(mediaValue(resource)?.url)

  return (
    <div className="resource-node-actions nodrag nopan">
      {canUpload ? (
        <button type="button" aria-label="Upload asset" onClick={() => fileInputRef?.current?.click()}>
          <Upload size={14} />
        </button>
      ) : null}
      <button type="button" aria-label="Copy asset" onClick={() => void copyResource(resource).catch(() => undefined)}>
        <Copy size={14} />
      </button>
      <button
        type="button"
        aria-label="Download asset"
        disabled={!hasDownloadableValue}
        onClick={() => void downloadResource(resource).catch(() => undefined)}
      >
        <Download size={14} />
      </button>
      {canUpload && resource.type !== 'text' ? (
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept={mediaAccept(resource.type as MediaResourceKind)}
          onChange={(event) => {
            onUpload?.(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      ) : null}
    </div>
  )
}

function EmptyMediaPreview({ type }: { type: MediaResourceKind }) {
  return <div className="resource-empty-media">Drop or upload {type}</div>
}

function NumberResourceEditor({
  resource,
  onUpdate,
}: {
  resource: Resource
  onUpdate: (resourceId: string, value: number) => void
}) {
  const currentValue = Number(resource.value)
  const normalizedValue = Number.isFinite(currentValue) ? currentValue : 0
  const committedValue = String(normalizedValue)
  const [draftState, setDraftState] = useState({
    committedValue,
    resourceId: resource.id,
    value: committedValue,
  })
  const draft =
    draftState.resourceId === resource.id && draftState.committedValue === committedValue
      ? draftState.value
      : committedValue
  const setDraftValue = (value: string) => {
    setDraftState({ committedValue, resourceId: resource.id, value })
  }

  const commitIfValid = (rawValue: string) => {
    if (!rawValue.trim()) return
    const numericValue = Number(rawValue)
    if (Number.isFinite(numericValue)) onUpdate(resource.id, numericValue)
  }

  return (
    <input
      aria-label="Number value"
      className="resource-number-editor nodrag nopan"
      inputMode="decimal"
      type="number"
      value={draft}
      onBlur={() => {
        if (!draft.trim() || !Number.isFinite(Number(draft))) {
          setDraftValue(committedValue)
        }
      }}
      onChange={(event) => {
        const rawValue = event.target.value
        setDraftValue(rawValue)
        commitIfValid(rawValue)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}

const normalizedRunCount = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return 1
  return Math.max(1, Math.min(99, Math.floor(numberValue)))
}

const openAiRoles: OpenAILlmMessage['role'][] = ['developer', 'system', 'user', 'assistant']
const geminiRoles: GeminiLlmMessage['role'][] = ['system', 'user', 'model']
const llmContentTypes: OpenAILlmContentPart['type'][] = ['text', 'image_url']
const llmImageDetails: NonNullable<OpenAILlmContentPart['detail']>[] = ['auto', 'low', 'high']

type EditableLlmContentPart = OpenAILlmContentPart | GeminiLlmContentPart
type EditableLlmMessage = {
  role: string
  content: EditableLlmContentPart[]
}

function LlmMessagesModal({
  description,
  messages,
  onClose,
  onUpdateMessages,
  providerLabel,
  roles,
}: {
  description: string
  messages: EditableLlmMessage[]
  onClose: () => void
  onUpdateMessages: (messages: EditableLlmMessage[]) => void
  providerLabel: string
  roles: string[]
}) {
  const updateMessage = (index: number, patch: Partial<EditableLlmMessage>) => {
    onUpdateMessages(messages.map((message, messageIndex) => (messageIndex === index ? { ...message, ...patch } : message)))
  }

  const addMessage = () => {
    onUpdateMessages([...messages, { role: 'user', content: [{ type: 'text', content: '' }] }])
  }

  const deleteMessage = (index: number) => {
    const nextMessages = messages.filter((_, messageIndex) => messageIndex !== index)
    onUpdateMessages(nextMessages.length ? nextMessages : [{ role: 'user', content: [{ type: 'text', content: '' }] }])
  }

  const updateContentPart = (messageIndex: number, partIndex: number, patch: Partial<EditableLlmContentPart>) => {
    onUpdateMessages(
      messages.map((message, currentMessageIndex) =>
        currentMessageIndex === messageIndex
          ? {
              ...message,
              content: message.content.map((part, currentPartIndex) =>
                currentPartIndex === partIndex ? { ...part, ...patch } : part,
              ),
            }
          : message,
      ),
    )
  }

  const addContentPart = (messageIndex: number) => {
    updateMessage(messageIndex, {
      content: [...messages[messageIndex].content, { type: 'text', content: '' }],
    })
  }

  const deleteContentPart = (messageIndex: number, partIndex: number) => {
    const message = messages[messageIndex]
    const nextContent = message.content.filter((_, currentPartIndex) => currentPartIndex !== partIndex)
    updateMessage(messageIndex, {
      content: nextContent.length ? nextContent : [{ type: 'text', content: '' }],
    })
  }

  const dialog = (
    <div
      className="node-modal-backdrop nodrag nopan"
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-label={`${providerLabel} Messages`}
        aria-modal="true"
        className="openai-message-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="openai-message-modal-header">
          <div>
            <h2>{providerLabel} Messages</h2>
            <p>{description}</p>
          </div>
          <button type="button" aria-label={`Close ${providerLabel} Messages`} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="openai-message-modal-toolbar">
          <button type="button" onClick={addMessage}>
            Add message
          </button>
        </div>
        <div className="openai-message-list">
          {messages.map((message, messageIndex) => (
            <article className="openai-message-card" key={`${messageIndex}_${message.role}`}>
              <div className="openai-message-card-header">
                <span>{message.role}</span>
                <select
                  aria-label={`${providerLabel} message role ${messageIndex + 1}`}
                  value={message.role}
                  onChange={(event) => updateMessage(messageIndex, { role: event.target.value })}
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Add content to ${providerLabel} message ${messageIndex + 1}`}
                  onClick={() => addContentPart(messageIndex)}
                >
                  Add content
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${providerLabel} message ${messageIndex + 1}`}
                  onClick={() => deleteMessage(messageIndex)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="openai-content-list">
                {message.content.map((part, partIndex) => (
                  <div className="openai-content-row" key={`${messageIndex}_${partIndex}_${part.type}`}>
                    <select
                      aria-label={`${providerLabel} content type ${messageIndex + 1}.${partIndex + 1}`}
                      value={part.type}
                      onChange={(event) =>
                        updateContentPart(messageIndex, partIndex, {
                          type: event.target.value as OpenAILlmContentPart['type'],
                          detail: event.target.value === 'image_url' ? (part.detail ?? 'auto') : undefined,
                        })
                      }
                    >
                      {llmContentTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <textarea
                      aria-label={`${providerLabel} content ${messageIndex + 1}.${partIndex + 1}`}
                      placeholder={part.type === 'image_url' ? 'image_1, image_2, URL, or data:image/...' : 'Message content'}
                      value={part.content}
                      onChange={(event) => updateContentPart(messageIndex, partIndex, { content: event.target.value })}
                    />
                    {part.type === 'image_url' ? (
                      <select
                        aria-label={`${providerLabel} image detail ${messageIndex + 1}.${partIndex + 1}`}
                        value={part.detail ?? 'auto'}
                        onChange={(event) =>
                          updateContentPart(messageIndex, partIndex, {
                            detail: event.target.value as NonNullable<OpenAILlmContentPart['detail']>,
                          })
                        }
                      >
                        {llmImageDetails.map((detail) => (
                          <option key={detail} value={detail}>
                            {detail}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="openai-detail-placeholder" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      aria-label={`Remove content part ${messageIndex + 1}.${partIndex + 1}`}
                      onClick={() => deleteContentPart(messageIndex, partIndex)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )

  return createPortal(dialog, document.body)
}

function OpenAiLlmEditor({
  nodeId,
  config,
  onUpdateConfig,
}: {
  nodeId: string
  config: OpenAILlmConfig
  onUpdateConfig: (nodeId: string, patch: Partial<OpenAILlmConfig>) => void
}) {
  const [messagesOpen, setMessagesOpen] = useState(false)
  const contentPartCount = config.messages.reduce((total, message) => total + message.content.length, 0)

  return (
    <div className="openai-node-editor nodrag nopan" aria-label="OpenAI LLM settings">
      <div className="openai-config-grid">
        <label>
          <span>Base URL</span>
          <input
            aria-label="OpenAI base URL"
            value={config.baseUrl}
            onChange={(event) => onUpdateConfig(nodeId, { baseUrl: event.target.value })}
          />
        </label>
        <label>
          <span>Model</span>
          <input
            aria-label="OpenAI model"
            value={config.model}
            onChange={(event) => onUpdateConfig(nodeId, { model: event.target.value })}
          />
        </label>
      </div>
      <label className="openai-api-key">
        <span>API Key</span>
        <input
          aria-label="OpenAI API key"
          autoComplete="off"
          type="password"
          value={config.apiKey}
          onChange={(event) => onUpdateConfig(nodeId, { apiKey: event.target.value })}
        />
      </label>
      <div className="openai-messages-header">
        <div>
          <span>Messages</span>
          <small>
            {config.messages.length} messages / {contentPartCount} parts
          </small>
        </div>
        <button type="button" aria-label="Edit messages" onClick={() => setMessagesOpen(true)}>
          Edit messages
        </button>
      </div>
      {messagesOpen ? (
        <LlmMessagesModal
          description="Chat Completions message list. Put text and image parts in the same user message when they belong together."
          messages={config.messages}
          onClose={() => setMessagesOpen(false)}
          onUpdateMessages={(messages) => onUpdateConfig(nodeId, { messages: messages as OpenAILlmMessage[] })}
          providerLabel="OpenAI"
          roles={openAiRoles}
        />
      ) : null}
    </div>
  )
}

function GeminiLlmEditor({
  nodeId,
  config,
  onUpdateConfig,
}: {
  nodeId: string
  config: GeminiLlmConfig
  onUpdateConfig: (nodeId: string, patch: Partial<GeminiLlmConfig>) => void
}) {
  const [messagesOpen, setMessagesOpen] = useState(false)
  const contentPartCount = config.messages.reduce((total, message) => total + message.content.length, 0)

  return (
    <div className="openai-node-editor nodrag nopan" aria-label="Gemini LLM settings">
      <div className="openai-config-grid">
        <label>
          <span>Base URL</span>
          <input
            aria-label="Gemini base URL"
            value={config.baseUrl}
            onChange={(event) => onUpdateConfig(nodeId, { baseUrl: event.target.value })}
          />
        </label>
        <label>
          <span>Model</span>
          <input
            aria-label="Gemini model"
            value={config.model}
            onChange={(event) => onUpdateConfig(nodeId, { model: event.target.value })}
          />
        </label>
      </div>
      <label className="openai-api-key">
        <span>API Key</span>
        <input
          aria-label="Gemini API key"
          autoComplete="off"
          type="password"
          value={config.apiKey}
          onChange={(event) => onUpdateConfig(nodeId, { apiKey: event.target.value })}
        />
      </label>
      <div className="openai-messages-header">
        <div>
          <span>Messages</span>
          <small>
            {config.messages.length} messages / {contentPartCount} parts
          </small>
        </div>
        <button type="button" aria-label="Edit messages" onClick={() => setMessagesOpen(true)}>
          Edit messages
        </button>
      </div>
      {messagesOpen ? (
        <LlmMessagesModal
          description="Gemini generateContent messages. System messages are sent as system_instruction; user messages can contain text and image parts."
          messages={config.messages}
          onClose={() => setMessagesOpen(false)}
          onUpdateMessages={(messages) => onUpdateConfig(nodeId, { messages: messages as GeminiLlmMessage[] })}
          providerLabel="Gemini"
          roles={geminiRoles}
        />
      ) : null}
    </div>
  )
}

const openAiImageSizes: OpenAIImageConfig['size'][] = ['auto', '1024x1024', '1024x1536', '1536x1024']
const openAiImageQualities: OpenAIImageConfig['quality'][] = ['auto', 'low', 'medium', 'high']
const openAiImageBackgrounds: OpenAIImageConfig['background'][] = ['auto', 'transparent', 'opaque']
const openAiImageFormats: OpenAIImageConfig['outputFormat'][] = ['png', 'jpeg', 'webp']
const geminiImageModalities: GeminiImageConfig['responseModalities'][] = ['IMAGE', 'TEXT_IMAGE']
const geminiImageAspectRatios: GeminiImageConfig['aspectRatio'][] = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4']
const geminiImageSizes: GeminiImageConfig['imageSize'][] = ['auto', '1K', '2K', '4K']

function OpenAiImageEditor({
  nodeId,
  config,
  onUpdateConfig,
}: {
  nodeId: string
  config: OpenAIImageConfig
  onUpdateConfig: (nodeId: string, patch: Partial<OpenAIImageConfig>) => void
}) {
  return (
    <div className="image-node-editor openai-node-editor nodrag nopan" aria-label="OpenAI image settings">
      <div className="openai-config-grid">
        <label>
          <span>Base URL</span>
          <input
            aria-label="OpenAI image base URL"
            value={config.baseUrl}
            onChange={(event) => onUpdateConfig(nodeId, { baseUrl: event.target.value })}
          />
        </label>
        <label>
          <span>Model</span>
          <input
            aria-label="OpenAI image model"
            value={config.model}
            onChange={(event) => onUpdateConfig(nodeId, { model: event.target.value })}
          />
        </label>
      </div>
      <label className="openai-api-key">
        <span>API Key</span>
        <input
          aria-label="OpenAI image API key"
          autoComplete="off"
          type="password"
          value={config.apiKey}
          onChange={(event) => onUpdateConfig(nodeId, { apiKey: event.target.value })}
        />
      </label>
      <div className="image-config-grid">
        <label>
          <span>Size</span>
          <select
            aria-label="OpenAI image size"
            value={config.size}
            onChange={(event) => onUpdateConfig(nodeId, { size: event.target.value as OpenAIImageConfig['size'] })}
          >
            {openAiImageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Quality</span>
          <select
            aria-label="OpenAI image quality"
            value={config.quality}
            onChange={(event) => onUpdateConfig(nodeId, { quality: event.target.value as OpenAIImageConfig['quality'] })}
          >
            {openAiImageQualities.map((quality) => (
              <option key={quality} value={quality}>
                {quality}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Background</span>
          <select
            aria-label="OpenAI image background"
            value={config.background}
            onChange={(event) =>
              onUpdateConfig(nodeId, { background: event.target.value as OpenAIImageConfig['background'] })
            }
          >
            {openAiImageBackgrounds.map((background) => (
              <option key={background} value={background}>
                {background}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Format</span>
          <select
            aria-label="OpenAI image output format"
            value={config.outputFormat}
            onChange={(event) =>
              onUpdateConfig(nodeId, { outputFormat: event.target.value as OpenAIImageConfig['outputFormat'] })
            }
          >
            {openAiImageFormats.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Compression</span>
          <input
            aria-label="OpenAI image output compression"
            max={100}
            min={0}
            type="number"
            value={config.outputCompression}
            onChange={(event) => onUpdateConfig(nodeId, { outputCompression: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>User</span>
          <input
            aria-label="OpenAI image user"
            value={config.user ?? ''}
            onChange={(event) => onUpdateConfig(nodeId, { user: event.target.value })}
          />
        </label>
      </div>
    </div>
  )
}

function GeminiImageEditor({
  nodeId,
  config,
  onUpdateConfig,
}: {
  nodeId: string
  config: GeminiImageConfig
  onUpdateConfig: (nodeId: string, patch: Partial<GeminiImageConfig>) => void
}) {
  return (
    <div className="image-node-editor openai-node-editor nodrag nopan" aria-label="Gemini image settings">
      <div className="openai-config-grid">
        <label>
          <span>Base URL</span>
          <input
            aria-label="Gemini image base URL"
            value={config.baseUrl}
            onChange={(event) => onUpdateConfig(nodeId, { baseUrl: event.target.value })}
          />
        </label>
        <label>
          <span>Model</span>
          <input
            aria-label="Gemini image model"
            value={config.model}
            onChange={(event) => onUpdateConfig(nodeId, { model: event.target.value })}
          />
        </label>
      </div>
      <label className="openai-api-key">
        <span>API Key</span>
        <input
          aria-label="Gemini image API key"
          autoComplete="off"
          type="password"
          value={config.apiKey}
          onChange={(event) => onUpdateConfig(nodeId, { apiKey: event.target.value })}
        />
      </label>
      <div className="image-config-grid">
        <label>
          <span>Modalities</span>
          <select
            aria-label="Gemini image response modalities"
            value={config.responseModalities}
            onChange={(event) =>
              onUpdateConfig(nodeId, {
                responseModalities: event.target.value as GeminiImageConfig['responseModalities'],
              })
            }
          >
            {geminiImageModalities.map((modality) => (
              <option key={modality} value={modality}>
                {modality}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Aspect ratio</span>
          <select
            aria-label="Gemini image aspect ratio"
            value={config.aspectRatio}
            onChange={(event) =>
              onUpdateConfig(nodeId, { aspectRatio: event.target.value as GeminiImageConfig['aspectRatio'] })
            }
          >
            {geminiImageAspectRatios.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Image size</span>
          <select
            aria-label="Gemini image size"
            value={config.imageSize}
            onChange={(event) =>
              onUpdateConfig(nodeId, { imageSize: event.target.value as GeminiImageConfig['imageSize'] })
            }
          >
            {geminiImageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

function EditableNodeTitle({
  actions,
  icon,
  isSelected,
  nodeId,
  title,
  onDeleteNode,
  onRenameNode,
}: {
  actions?: ReactNode
  icon: ReactNode
  isSelected: boolean
  nodeId: string
  title: string
  onDeleteNode: (nodeId: string) => void
  onRenameNode: (nodeId: string, title: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isEditing) inputRef.current?.select()
  }, [isEditing])

  const commit = () => {
    onRenameNode(nodeId, draft)
    setIsEditing(false)
  }

  return (
    <div className="node-title">
      {icon}
      {isEditing ? (
        <input
          ref={inputRef}
          aria-label="Node title"
          className="node-title-input"
          value={draft}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') {
              setDraft(title)
              setIsEditing(false)
            }
          }}
        />
      ) : (
        <span
          title="Double-click to rename"
          onDoubleClick={(event) => {
            event.stopPropagation()
            setDraft(title)
            setIsEditing(true)
          }}
        >
          {title}
        </span>
      )}
      {actions}
      {isSelected ? (
        <button
          aria-label="Delete node"
          className="node-delete"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDeleteNode(nodeId)
          }}
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  )
}

function NodeReferenceBadge({
  references,
  onFocusReferenceNode,
}: {
  references?: WorkbenchNodeData['nodeReferences']
  onFocusReferenceNode?: (nodeId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const count = references?.length ?? 0

  if (count === 0) return <span className="node-reference-empty">0 refs</span>

  return (
    <div className="node-reference">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Show ${count} node references`}
        className="node-reference-button nodrag nopan"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        {count} refs
      </button>
      {open ? (
        <div className="node-reference-popover nodrag nopan" role="dialog" aria-label="Node references">
          {references?.map((reference) => (
            <button
              key={`${reference.direction}-${reference.nodeId}`}
              type="button"
              aria-label={`Locate referenced node ${reference.title}`}
              onClick={(event) => {
                event.stopPropagation()
                onFocusReferenceNode?.(reference.nodeId)
                setOpen(false)
              }}
            >
              <span>{reference.direction === 'incoming' ? 'From' : 'To'}</span>
              <strong>{reference.title}</strong>
              <small>{reference.type}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function nodeReferenceBadge(nodeData: WorkbenchNodeData) {
  return (
    <NodeReferenceBadge
      references={nodeData.nodeReferences}
      onFocusReferenceNode={nodeData.onFocusReferenceNode}
    />
  )
}

function SelectedResizeControl({
  id,
  minHeight,
  minWidth,
  nodeData,
  selected,
}: {
  id: string
  minHeight: number
  minWidth: number
  nodeData: WorkbenchNodeData
  selected?: boolean
}) {
  if (!selected) return null

  return (
    <NodeResizeControl
      className="node-resize-handle"
      minHeight={minHeight}
      minWidth={minWidth}
      onResizeEnd={(_, params: { width: number; height: number }) =>
        nodeData.onResizeNode?.(id, { width: params.width, height: params.height })
      }
      position="bottom-right"
    />
  )
}

export const ResourceNodeView = memo(({ id, data, selected }: NodeProps) => {
  const nodeData = data as WorkbenchNodeData
  const resource = nodeData.resourceId ? nodeData.resourcesById[nodeData.resourceId] : undefined
  const title = String(nodeData.title ?? resource?.name ?? 'Resource')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const replaceFromFile = async (file: File | undefined) => {
    if (!resource || !isMediaResource(resource) || !file) return
    const result = await readFileAsMediaResource(file)
    if (!result || result.type !== resource.type) return
    nodeData.onReplaceResourceMedia(resource.id, result.type, result.media)
  }

  return (
    <div
      className="canvas-node resource-node"
      onDragOver={(event) => {
        if (!resource || !isMediaResource(resource)) return
        event.preventDefault()
      }}
      onDrop={(event) => {
        if (!resource || !isMediaResource(resource)) return
        const file = event.dataTransfer.files[0]
        if (!file) return
        event.preventDefault()
        event.stopPropagation()
        void replaceFromFile(file)
      }}
    >
      <SelectedResizeControl id={id} minHeight={120} minWidth={190} nodeData={nodeData} selected={Boolean(selected)} />
      {resource ? (
        <Handle
          data-slot-handle={resourceHandleId(resource.id)}
          id={resourceHandleId(resource.id)}
          position={Position.Right}
          type="source"
        />
      ) : null}
      <EditableNodeTitle
        actions={nodeReferenceBadge(nodeData)}
        icon={resource?.type === 'number' ? <Hash size={16} /> : <FileText size={16} />}
        isSelected={Boolean(selected)}
        nodeId={id}
        title={title}
        onDeleteNode={nodeData.onDeleteNode}
        onRenameNode={nodeData.onRenameNode}
      />
      <div className="node-meta">{resource?.type ?? nodeData.resourceType}</div>
      {resource?.type === 'text' ? (
        <>
          <ResourceActions canUpload={false} resource={resource} />
          <textarea
            aria-label={`${title} text`}
            className="resource-text-editor nodrag nopan"
            value={String(resource.value)}
            onChange={(event) => nodeData.onUpdateTextResourceValue(resource.id, event.target.value)}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        </>
      ) : resource?.type === 'number' ? (
        <>
          <ResourceActions canUpload={false} resource={resource} />
          <NumberResourceEditor resource={resource} onUpdate={nodeData.onUpdateNumberResourceValue} />
        </>
      ) : resource && isMediaResource(resource) ? (
        <>
          <ResourceActions
            canUpload
            fileInputRef={fileInputRef}
            resource={resource}
            onUpload={(file) => void replaceFromFile(file)}
          />
          {mediaValue(resource)?.url ? <ResourcePreview resource={resource} /> : <EmptyMediaPreview type={resource.type} />}
        </>
      ) : resource ? (
        <ResourcePreview resource={resource} />
      ) : (
        <p className="resource-preview-text">Missing resource</p>
      )}
    </div>
  )
})

export const FunctionNodeView = memo(({ id, data, selected }: NodeProps) => {
  const nodeData = data as WorkbenchNodeData
  const functionDef = nodeData.functionId ? nodeData.functionsById[nodeData.functionId] : undefined
  const title = String(nodeData.title ?? functionDef?.name ?? 'Function')
  const inputs = functionDef?.inputs ?? []
  const outputs = functionDef?.outputs ?? []
  const inputValues = (nodeData.inputValues ?? {}) as Record<string, PrimitiveInputValue | ResourceRef>
  const missingInputKeys = new Set(
    Array.isArray(nodeData.missingInputKeys) ? nodeData.missingInputKeys.map((key) => String(key)) : [],
  )
  const runCount = normalizedRunCount(nodeData.runtime?.runCount ?? functionDef?.runtimeDefaults?.runCount ?? 1)
  const isOpenAiNode = functionDef ? isOpenAILlmFunction(functionDef) : false
  const isGeminiNode = functionDef ? isGeminiLlmFunction(functionDef) : false
  const isOpenAiImageNode = functionDef ? isOpenAIImageFunction(functionDef) : false
  const isGeminiImageNode = functionDef ? isGeminiImageFunction(functionDef) : false
  const openAiConfig = isOpenAiNode
    ? mergedOpenAILlmConfig(functionDef?.openai ?? defaultOpenAILlmConfig(), nodeData.openaiConfig)
    : undefined
  const geminiConfig = isGeminiNode
    ? mergedGeminiLlmConfig(functionDef?.gemini ?? defaultGeminiLlmConfig(), nodeData.geminiConfig)
    : undefined
  const openAiImageConfig = isOpenAiImageNode
    ? mergedOpenAIImageConfig(functionDef?.openaiImage ?? defaultOpenAIImageConfig(), nodeData.openaiImageConfig)
    : undefined
  const geminiImageConfig = isGeminiImageNode
    ? mergedGeminiImageConfig(functionDef?.geminiImage ?? defaultGeminiImageConfig(), nodeData.geminiImageConfig)
    : undefined
  const shouldBalanceSlotColumns = inputs.length <= 6 && outputs.length <= 6
  const slotRowCount = shouldBalanceSlotColumns ? Math.max(inputs.length, outputs.length) : 0
  const inputSpacerCount = shouldBalanceSlotColumns ? slotRowCount - inputs.length : 0
  const outputSpacerCount = shouldBalanceSlotColumns ? slotRowCount - outputs.length : 0
  const optionalTextInputCount = inputs.filter((input) => !input.required && input.type === 'text').length
  const nodeHeight = Number(nodeData.size?.height)
  const optionalTextInputMinHeight =
    optionalTextInputCount > 0 && Number.isFinite(nodeHeight) ? Math.min(180, Math.max(54, 54 + (nodeHeight - 220) / optionalTextInputCount)) : undefined

  return (
    <div
      className={[
        'canvas-node',
        'function-node',
        isOpenAiNode ? 'openai-node' : '',
        isGeminiNode ? 'gemini-node' : '',
        isOpenAiImageNode || isGeminiImageNode ? 'image-generation-node' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <SelectedResizeControl
        id={id}
        minHeight={180}
        minWidth={functionDef?.workflow.format === 'comfyui_api_json' ? 420 : 430}
        nodeData={nodeData}
        selected={Boolean(selected)}
      />
      <EditableNodeTitle
        actions={nodeReferenceBadge(nodeData)}
        icon={<Cpu size={16} />}
        isSelected={Boolean(selected)}
        nodeId={id}
        title={title}
        onDeleteNode={nodeData.onDeleteNode}
        onRenameNode={nodeData.onRenameNode}
      />
      <div className="node-meta">{functionDef?.category ?? 'ComfyUI'}</div>
      {inputs.length || outputs.length ? (
        <div className="node-slots">
          <div className="slot-column input-column" aria-label="Function inputs">
            {inputs.map((input) => (
              <FunctionInputSlot
                input={input}
                key={input.key}
                missing={missingInputKeys.has(input.key)}
                nodeId={id}
                resourcesById={nodeData.resourcesById}
                value={inputValues[input.key]}
                workflowValue={workflowPrimitiveValue(functionDef, input)}
                textInputMinHeight={optionalTextInputMinHeight}
                onUpdateInputValue={nodeData.onUpdateFunctionInputValue}
              />
            ))}
            {Array.from({ length: inputSpacerCount }, (_, index) => (
              <SlotSpacer key={`input_spacer_${index}`} />
            ))}
          </div>
          <div className="slot-column output-column" aria-label="Function outputs">
            {outputs.map((output) => (
              <FunctionOutputSlot key={output.key} output={output} />
            ))}
            {Array.from({ length: outputSpacerCount }, (_, index) => (
              <SlotSpacer key={`output_spacer_${index}`} />
            ))}
          </div>
        </div>
      ) : null}
      {openAiConfig ? (
        <OpenAiLlmEditor nodeId={id} config={openAiConfig} onUpdateConfig={nodeData.onUpdateOpenAiConfig} />
      ) : null}
      {geminiConfig ? (
        <GeminiLlmEditor nodeId={id} config={geminiConfig} onUpdateConfig={nodeData.onUpdateGeminiConfig} />
      ) : null}
      {openAiImageConfig ? (
        <OpenAiImageEditor
          nodeId={id}
          config={openAiImageConfig}
          onUpdateConfig={nodeData.onUpdateOpenAiImageConfig}
        />
      ) : null}
      {geminiImageConfig ? (
        <GeminiImageEditor
          nodeId={id}
          config={geminiImageConfig}
          onUpdateConfig={nodeData.onUpdateGeminiImageConfig}
        />
      ) : null}
      <div className="node-actions">
        <label className="run-count-control nodrag nopan">
          <span>Runs</span>
          <input
            aria-label="Run count"
            max={99}
            min={1}
            type="number"
            value={runCount}
            onChange={(event) => nodeData.onUpdateFunctionRunCount(id, normalizedRunCount(event.target.value))}
          />
        </label>
        <button type="button" aria-label="Run function" onClick={() => nodeData.onRunFunction(id)}>
          <Play size={14} />
          Run
        </button>
      </div>
    </div>
  )
})

export const ResultGroupNodeView = memo(({ id, data, selected }: NodeProps) => {
  const nodeData = data as WorkbenchNodeData
  const [previewResource, setPreviewResource] = useState<Resource | undefined>()
  const resources = (nodeData.resources ?? [])
    .map((ref) => nodeData.resourcesById[ref.resourceId])
    .filter(Boolean)
  const functionDef = nodeData.functionId ? nodeData.functionsById[nodeData.functionId] : undefined
  const pendingOutputs = resources.length ? [] : (functionDef?.outputs ?? [])
  const title = String(nodeData.title ?? `Run ${nodeData.runIndex ?? 1}`)
  const status = nodeData.status ?? 'created'
  const isActive = activeResultStatuses.has(status)
  const canRerun = !isActive && (status === 'failed' || status === 'succeeded' || status === 'canceled')
  const task = nodeData.taskId ? nodeData.tasksById?.[nodeData.taskId] : undefined
  const errorMessage = nodeData.error?.message ?? task?.error?.message
  const handleRerun = () => {
    if (status === 'succeeded' && !globalThis.confirm('This run already succeeded. Rerun and overwrite its outputs?')) {
      return
    }
    nodeData.onRerunResultNode(id)
  }
  const runControl = isActive ? (
    <button
      type="button"
      aria-label="Terminate run"
      className="result-run-control result-run-control-stop nodrag nopan"
      title="Terminate run"
      onClick={() => nodeData.onCancelResultRun(id)}
    >
      <Square size={14} />
    </button>
  ) : canRerun ? (
    <button
      type="button"
      aria-label="Rerun result"
      className="result-run-control nodrag nopan"
      title="Rerun result"
      onClick={handleRerun}
    >
      <RefreshCcw size={14} />
    </button>
  ) : null

  return (
    <div className={`canvas-node result-node result-node-${status} ${isActive ? 'result-node-active' : ''}`}>
      <SelectedResizeControl id={id} minHeight={150} minWidth={260} nodeData={nodeData} selected={Boolean(selected)} />
      <Handle
        className="result-input-handle"
        data-slot-handle="result-input"
        id="result-input"
        position={Position.Left}
        type="target"
      />
      <EditableNodeTitle
        actions={
          <>
            {nodeReferenceBadge(nodeData)}
            {runControl}
          </>
        }
        icon={<Sparkles size={16} />}
        isSelected={Boolean(selected)}
        nodeId={id}
        title={title}
        onDeleteNode={nodeData.onDeleteNode}
        onRenameNode={nodeData.onRenameNode}
      />
      <div className="node-meta result-meta">
        <span className={`result-status-chip ${status}`} aria-label={`Run status ${status}`}>
          {status}
        </span>
        <span>{nodeData.endpointId ?? 'endpoint'}</span>
      </div>
      {status === 'failed' && errorMessage ? (
        <div className="result-error" role="alert">
          <strong>Error</strong>
          <p>{errorMessage}</p>
          <button
            type="button"
            aria-label="Copy error"
            onClick={() => void navigator.clipboard?.writeText(errorMessage).catch(() => undefined)}
          >
            Copy
          </button>
        </div>
      ) : null}
      {resources.length || pendingOutputs.length ? (
        <div className="result-output-slots" aria-label="Result outputs">
          {resources.map((resource) => (
            <ResultOutputSlot key={resource.id} resource={resource} />
          ))}
          {pendingOutputs.map((output) => (
            <PendingResultOutputSlot key={output.key} output={output} />
          ))}
        </div>
      ) : null}
      <div className="result-list" data-testid="result-resource-grid">
        {resources.map((resource) => {
          const label = resource.name ?? resource.id
          return (
          <div
            aria-label={`Result preview ${label}`}
            className={`result-preview-card result-preview-card-${resource.type}`}
            key={resource.id}
          >
            <div aria-label={`Result actions ${label}`} className="result-card-actions nodrag nopan" role="group">
              <button type="button" aria-label="View full result" onClick={() => setPreviewResource(resource)}>
                <Eye size={14} />
              </button>
              <button type="button" aria-label="Copy result" onClick={() => void copyResource(resource).catch(() => undefined)}>
                <Copy size={14} />
              </button>
              <button type="button" aria-label="Download result" onClick={() => void downloadResource(resource).catch(() => undefined)}>
                <Download size={14} />
              </button>
            </div>
            <ResourcePreview resource={resource} />
            <span>{label}</span>
          </div>
          )
        })}
      </div>
      <FullResourcePreviewModal
        resource={previewResource}
        resources={
          previewResource
            ? sameTypePreviewResources(nodeData.resourcesById, previewResource, nodeData.sourceFunctionNodeId, nodeData.functionId)
            : []
        }
        onClose={() => setPreviewResource(undefined)}
      />
    </div>
  )
})

export const GroupNodeView = memo(({ id, data, selected }: NodeProps) => {
  const nodeData = data as WorkbenchNodeData

  return (
    <div className="canvas-node group-node">
      <SelectedResizeControl id={id} minHeight={90} minWidth={180} nodeData={nodeData} selected={Boolean(selected)} />
      <div className="node-title">
        <Layers size={16} />
        <span>Group</span>
        {nodeReferenceBadge(nodeData)}
      </div>
    </div>
  )
})

export const EmptyNodeView = memo(({ id, data, selected }: NodeProps) => {
  const nodeData = data as WorkbenchNodeData

  return (
    <div className="canvas-node empty-node">
      <SelectedResizeControl id={id} minHeight={90} minWidth={160} nodeData={nodeData} selected={Boolean(selected)} />
      <div className="node-title">
        <Box size={16} />
        <span>Node</span>
        {nodeReferenceBadge(nodeData)}
      </div>
    </div>
  )
})
