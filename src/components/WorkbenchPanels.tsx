import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Braces,
  Check,
  Copy,
  Download,
  FileInput,
  History,
  Image as ImageIcon,
  KeyRound,
  Network,
  Pencil,
  Plus,
  Route,
  RotateCcw,
  RotateCw,
  Server,
  Settings,
  Trash2,
  Upload,
  Volume2,
  Workflow,
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
import { getProjectRunHistory, getSelectedNodesRunHistory } from '../domain/runHistory'
import { formatDurationMs, formatHistoryTimestamp, runDurationMs } from '../domain/runTiming'
import { downloadConfigPackage, downloadProjectPackage, readPackageFile } from '../domain/projectTransfer'
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
import {
  ComfyFrameLoginRequiredError,
  exportWorkflowFromComfyFrame,
  loadApiWorkflowIntoComfyFrame,
  loadUiWorkflowIntoComfyFrame,
  waitForComfyFrameBridge,
} from '../domain/comfyFrameBridge'
import { comfyProxyUrl, prepareIsolatedComfyProxySession } from '../domain/comfyProxy'
import { projectStore, useProjectStore } from '../store/projectStore'
import { ResourcePreview } from './ResourcePreview'
import { FullResourcePreviewModal } from './ResourcePreviewModal'
import { ModalFrame } from './ModalFrame'
import { ConfirmationDialog } from './ConfirmationDialog'

const resourceTypes: ResourceType[] = ['text', 'number', 'boolean', 'image', 'video', 'audio']
const outputSources: FunctionOutputDef['extract']['source'][] = [
  'history',
  'node_output',
  'final_images',
  'final_videos',
  'final_audios',
  'file_output',
]
const requestInputTargets: NonNullable<FunctionInputDef['bind']['requestTarget']>[] = ['url_param', 'header', 'body']

const activeTaskStatuses = new Set<ExecutionTask['status']>([
  'created',
  'waiting_endpoint',
  'validating',
  'compiling_workflow',
  'uploading_assets',
  'randomizing_seeds',
  'pending',
  'queued',
  'running',
  'fetching_outputs',
])
const HISTORY_LIST_IDLE_MS = 5000

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

const inputSnapshotDisplayValue = (input: ExecutionInputSnapshot) => {
  if (input.value === null || input.value === undefined) return ''
  if (typeof input.value === 'object') {
    if ('filename' in input.value && input.value.filename) return input.value.filename
    return JSON.stringify(input.value, null, 2)
  }
  return String(input.value)
}

const padDatePart = (value: number) => String(value).padStart(2, '0')

const formatInspectorTimestamp = (value: string | undefined) => {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return formatHistoryTimestamp(value)
  return [
    `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
    `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`,
  ].join(' ')
}

const runFinalWorkflowSnapshot = (task: ExecutionTask) => {
  if (task.compiledWorkflowSnapshot && Object.keys(task.compiledWorkflowSnapshot).length > 0) {
    return task.compiledWorkflowSnapshot
  }
  return task.requestSnapshot
}

const isMediaInputSnapshot = (input: ExecutionInputSnapshot) =>
  input.type === 'image' || input.type === 'video' || input.type === 'audio'

const inputPreviewResource = (project: ProjectState, input: ExecutionInputSnapshot): Resource | undefined => {
  if (!isMediaInputSnapshot(input)) return undefined
  const linkedResource = input.resourceId ? project.resources[input.resourceId] : undefined
  if (linkedResource && linkedResource.type === input.type) return linkedResource
  if (typeof input.value === 'object' && input.value !== null && 'url' in input.value) {
    return {
      id: `input-${input.key}`,
      type: input.type,
      name: input.resourceName ?? input.label,
      value: input.value,
      source: { kind: 'imported' },
    }
  }
  return undefined
}

const unsafeInspectorFileCharacterPattern = new RegExp('[<>:"/\\\\|?*#%&]+', 'g')

const replaceInspectorControlCharacters = (value: string) =>
  Array.from(value, (character) => (character.charCodeAt(0) <= 0x1f ? '-' : character)).join('')

const safeInspectorFilePart = (value: string) => {
  const cleaned = replaceInspectorControlCharacters(value)
    .replace(unsafeInspectorFileCharacterPattern, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
  return cleaned || 'workflow'
}

const downloadTextSnapshot = (filename: string, content: string, mimeType = 'application/json') => {
  const objectUrl = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
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

type HistoryDockRow = {
  id: string
  entryId: string
  sequence: number
  label: string
  title: string
  subtitle: string
  createdAtLabel: string
  durationLabel?: string
  stack: 'undo' | 'redo'
  assetIds: string[]
  nodeIds: string[]
}

const taskForHistoryAssetIds = (project: ProjectState, assetIds: string[]) => {
  for (const assetId of assetIds) {
    const taskId = project.resources[assetId]?.source.taskId
    if (taskId && project.tasks[taskId]) return project.tasks[taskId]
  }
  return undefined
}

const buildHistoryDockRows = (project: ProjectState): HistoryDockRow[] => {
  const undoRows = (project.history?.undoStack ?? []).map((entry, index) => {
    const assetIds = entry.preview.assetIds ?? entry.affectedIds.assetIds ?? []
    const task = taskForHistoryAssetIds(project, assetIds)
    return {
    id: `undo-${entry.id}`,
    entryId: entry.id,
    sequence: index + 1,
    label: entry.label,
    title: entry.preview.title || entry.label,
    subtitle: entry.preview.subtitle ?? entry.transactionType,
    createdAtLabel: formatHistoryTimestamp(entry.createdAt),
    durationLabel: formatDurationMs(runDurationMs(task)),
    stack: 'undo' as const,
    assetIds,
    nodeIds: entry.preview.nodeIds ?? entry.affectedIds.nodeIds ?? [],
    }
  })
  const redoRows = (project.history?.redoStack ?? []).map((entry, index) => {
    const assetIds = entry.preview.assetIds ?? entry.affectedIds.assetIds ?? []
    const task = taskForHistoryAssetIds(project, assetIds)
    return {
    id: `redo-${entry.id}`,
    entryId: entry.id,
    sequence: undoRows.length + index + 1,
    label: entry.label,
    title: entry.preview.title || entry.label,
    subtitle: entry.preview.subtitle ?? entry.transactionType,
    createdAtLabel: formatHistoryTimestamp(entry.createdAt),
    durationLabel: formatDurationMs(runDurationMs(task)),
    stack: 'redo' as const,
    assetIds,
    nodeIds: entry.preview.nodeIds ?? entry.affectedIds.nodeIds ?? [],
    }
  })
  return [...undoRows.toReversed(), ...redoRows.toReversed()]
}

export function RunInspector({
  project,
  task,
  onFocusNode,
}: {
  project: ProjectState
  task: ExecutionTask
  onFocusNode: (nodeId: string) => void
}) {
  const [copiedWorkflow, setCopiedWorkflow] = useState(false)
  const [previewInputResource, setPreviewInputResource] = useState<Resource>()
  const inputs = Object.values(task.inputValuesSnapshot ?? {})
  const finalWorkflow = runFinalWorkflowSnapshot(task)
  const finalWorkflowJson = finalWorkflow ? JSON.stringify(finalWorkflow, null, 2) : ''
  const durationLabel = formatDurationMs(runDurationMs(task)) ?? '-'
  const detailRows = [
    { key: 'status', label: 'Status', value: task.status, displayValue: task.status },
    { key: 'duration', label: 'Duration', value: durationLabel, displayValue: durationLabel },
    { key: 'created', label: 'Created', value: task.createdAt, displayValue: formatInspectorTimestamp(task.createdAt) },
    { key: 'started', label: 'Started', value: task.startedAt ?? '-', displayValue: formatInspectorTimestamp(task.startedAt) },
    { key: 'completed', label: 'Completed', value: task.completedAt ?? '-', displayValue: formatInspectorTimestamp(task.completedAt) },
  ]
  const workflowDownloadName = `${safeInspectorFilePart(task.functionId)}-${safeInspectorFilePart(task.id)}-workflow.json`
  const copyWorkflow = async () => {
    if (!finalWorkflowJson) return
    await navigator.clipboard?.writeText(finalWorkflowJson)
    setCopiedWorkflow(true)
    window.setTimeout(() => setCopiedWorkflow(false), 1200)
  }

  return (
    <div className="run-inspector" aria-label="Run execution details">
      <div className="run-section-heading">
        <h3>Run Details</h3>
      </div>
      <div className="run-detail-grid">
        {detailRows.map((row) => (
          <div key={row.key} className="run-detail-field">
            <span>{row.label}</span>
            <input
              aria-label={`Run detail ${row.label}`}
              className="run-detail-accessible-value"
              readOnly
              value={row.value}
            />
            <strong
              className={row.key === 'status' ? `run-detail-status run-detail-status-${task.status}` : undefined}
              aria-hidden="true"
            >
              {row.displayValue}
            </strong>
          </div>
        ))}
      </div>

      <div className="run-section-heading">
        <h3>Inputs</h3>
        <span>{inputs.length} captured</span>
      </div>
      {inputs.length > 0 ? (
        <div className="run-input-list">
          {inputs.map((input) => {
            const targetNodeId = inputTargetNodeId(project, task, input)
            const previewResource = inputPreviewResource(project, input)
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
                {previewResource ? (
                  <button
                    type="button"
                    className="run-input-preview"
                    onClick={() => setPreviewInputResource(previewResource)}
                    aria-label={`Open ${input.label} input preview`}
                  >
                    <ResourcePreview resource={previewResource} />
                  </button>
                ) : null}
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

      <div className="run-section-heading">
        <h3>Final Workflow</h3>
        {finalWorkflow ? (
          <div className="run-section-actions">
            <button type="button" aria-label="Copy final workflow JSON" onClick={() => void copyWorkflow().catch(() => undefined)}>
              {copiedWorkflow ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
              {copiedWorkflow ? 'Copied' : 'Copy'}
            </button>
            <button type="button" aria-label="Download final workflow JSON" onClick={() => downloadTextSnapshot(workflowDownloadName, finalWorkflowJson)}>
              <Download aria-hidden="true" size={14} />
              Download
            </button>
          </div>
        ) : null}
      </div>
      {finalWorkflow ? (
        <pre className="run-workflow-json">
          <code>{highlightedJson(finalWorkflowJson)}</code>
        </pre>
      ) : (
        <div className="inspector-empty">No workflow snapshot</div>
      )}
      <FullResourcePreviewModal
        resource={previewInputResource}
        resources={previewInputResource ? [previewInputResource] : []}
        onClose={() => setPreviewInputResource(undefined)}
      />
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

const taskRunLabel = (task: ExecutionTask) => `Run ${task.runIndex}/${task.runTotal}`

const taskDurationLabel = (task: ExecutionTask) => formatDurationMs(runDurationMs(task))

const taskOutputResources = (project: ProjectState, task: ExecutionTask) =>
  Object.values(task.outputRefs ?? {})
    .flat()
    .map((ref) => project.resources[ref.resourceId])
    .filter((resource): resource is Resource => Boolean(resource))

function ProjectTaskCard({
  project,
  task,
  expanded,
  onToggle,
  onFocusNode,
  onPreviewResource,
}: {
  project: ProjectState
  task: ExecutionTask
  expanded: boolean
  onToggle: () => void
  onFocusNode: (nodeId: string) => void
  onPreviewResource: (resource: Resource) => void
}) {
  const detailsId = `job-details-${task.id}`
  const durationLabel = taskDurationLabel(task)
  const outputResources = taskOutputResources(project, task)

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
          <span className="job-card-title">
            <strong>{taskFunctionName(project, task)}</strong>
            <small>
              {taskRunLabel(task)} · {formatHistoryTimestamp(task.createdAt)}
            </small>
          </span>
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
          <span>
            <small>Duration</small>
            <em>{durationLabel ?? '-'}</em>
          </span>
        </span>
        <code>{task.id}</code>
      </button>
      {outputResources.length > 0 ? (
        <div className="run-output-strip" aria-label={`${taskRunLabel(task)} output previews`}>
          {outputResources.slice(0, 5).map((resource) => (
            <button
              key={resource.id}
              type="button"
              className="run-output-preview"
              aria-label={`Preview ${resourceLabel(resource)}`}
              onClick={() => onPreviewResource(resource)}
            >
              <ResourceListPreview resource={resource} />
            </button>
          ))}
          {outputResources.length > 5 ? <span className="run-output-more">+{outputResources.length - 5}</span> : null}
        </div>
      ) : null}
      {expanded ? (
        <div id={detailsId} className="job-card-details">
          <RunInspector project={project} task={task} onFocusNode={onFocusNode} />
        </div>
      ) : null}
    </article>
  )
}

function RunRecordCard({
  project,
  item,
  onFocusNode,
  onOpenHistory,
  onPreviewResource,
}: {
  project: ProjectState
  item: ReturnType<typeof getProjectRunHistory>[number]
  onFocusNode: (nodeId: string) => void
  onOpenHistory: (runLabel: string, endpointId: string | undefined, promptId: string | undefined) => void
  onPreviewResource: (resource: Resource) => void
}) {
  const task = project.tasks[item.taskId]
  const durationLabel = taskDurationLabel(task)
  const createdAtLabel = formatHistoryTimestamp(task?.createdAt)
  const outputResources = task ? taskOutputResources(project, task) : []

  return (
    <article className={`run-record-card run-record-card-${item.status}`}>
      <div className="run-record-header">
        <span className="run-record-title">
          <strong>{task ? taskFunctionName(project, task) : item.runLabel}</strong>
          <small>
            {item.runLabel} · {createdAtLabel}
          </small>
        </span>
        <span className={`job-status job-status-${item.status}`}>{item.status}</span>
      </div>
      <div className="run-record-meta">
        <span>
          <small>Server</small>
          <em>{item.endpointName ?? 'endpoint unknown'}</em>
        </span>
        <span>
          <small>Type</small>
          <em>{task ? taskTypeName(project, task) : 'unknown'}</em>
        </span>
        <span>
          <small>Duration</small>
          <em>{durationLabel ?? '-'}</em>
        </span>
      </div>
      <code>{item.taskId}</code>
      {outputResources.length > 0 ? (
        <div className="run-output-strip" aria-label={`${item.runLabel} output previews`}>
          {outputResources.slice(0, 5).map((resource) => (
            <button
              key={resource.id}
              type="button"
              className="run-output-preview"
              aria-label={`Preview ${resourceLabel(resource)}`}
              onClick={() => onPreviewResource(resource)}
            >
              <ResourceListPreview resource={resource} />
            </button>
          ))}
          {outputResources.length > 5 ? <span className="run-output-more">+{outputResources.length - 5}</span> : null}
        </div>
      ) : null}
      <div className="run-record-actions">
        {item.resultNodeId ? (
          <button
            type="button"
            onClick={() => onFocusNode(item.resultNodeId!)}
            aria-label={`Locate ${item.runLabel} result node`}
          >
            Locate
          </button>
        ) : null}
        {item.historyPath && item.endpointId && item.comfyPromptId ? (
          <button
            type="button"
            onClick={() => onOpenHistory(item.runLabel, item.endpointId, item.comfyPromptId)}
            aria-label={`Open ComfyUI history for ${item.runLabel}`}
          >
            History
          </button>
        ) : item.historyPath ? (
          <code>{item.historyPath}</code>
        ) : (
          <em>No prompt id</em>
        )}
      </div>
      {item.errorMessage ? <p className="job-error">{item.errorMessage}</p> : null}
    </article>
  )
}

function ModalShell({
  label,
  children,
  onClose,
  modalClassName,
  hidden = false,
}: {
  label: string
  children: ReactNode
  onClose: () => void
  modalClassName?: string
  hidden?: boolean
}) {
  return (
    <ModalFrame
      label={label}
      onClose={onClose}
      hidden={hidden}
      dialogClassName={`manager-modal${modalClassName ? ` ${modalClassName}` : ''}`}
    >
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
    </ModalFrame>
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

export type EmbeddedComfySave = {
  rawJson: ComfyWorkflow
  uiJson?: ComfyUiWorkflow
  editor: ComfyWorkflowEditorMetadata
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

export function ComfyWorkflowEditorDialog({
  open = true,
  endpoint,
  initialUiJson,
  initialApiJson,
  onSave,
  onClose,
}: {
  open?: boolean
  endpoint?: ComfyEndpointConfig
  initialUiJson?: ComfyUiWorkflow
  initialApiJson?: ComfyWorkflow
  onSave: (value: EmbeddedComfySave) => void
  onClose: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const wasOpenRef = useRef(false)
  const initializingRef = useRef<Promise<void> | undefined>(undefined)
  const [status, setStatus] = useState(endpoint ? 'Loading ComfyUI editor' : 'No ComfyUI endpoint configured')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string>()
  const [frameOrigin, setFrameOrigin] = useState<string>()
  const endpointId = endpoint?.id
  const endpointBaseUrl = endpoint?.baseUrl
  const proxyUrl = endpointBaseUrl ? comfyProxyUrl(endpointBaseUrl) : undefined
  const proxyBearerToken =
    endpoint?.auth?.type === 'token' || endpoint?.auth?.type === 'password' ? endpoint.auth.token : undefined
  const proxyPassword = endpoint?.auth?.type === 'password' ? endpoint.auth.password : undefined

  /* eslint-disable react-hooks/set-state-in-effect -- A changed endpoint invalidates the iframe readiness state immediately. */
  useEffect(() => {
    setFrameReady(false)
    setFrameSrc(undefined)
    setFrameOrigin(undefined)
    setStatus(endpointId ? 'Loading ComfyUI editor' : 'No ComfyUI endpoint configured')
    setError(undefined)
    wasOpenRef.current = false
    if (!open || !endpointBaseUrl || !proxyUrl) return

    let cancelled = false
    setStatus('Preparing secure ComfyUI session')
    void prepareIsolatedComfyProxySession(endpointBaseUrl, {
      bearerToken: proxyBearerToken,
      password: proxyPassword,
    })
      .then((session) => {
        if (cancelled) return
        setFrameOrigin(session.frameOrigin)
        setFrameSrc(session.proxyUrl)
        setStatus('Loading ComfyUI editor')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to prepare the ComfyUI proxy session')
      })

    return () => {
      cancelled = true
    }
  }, [endpointBaseUrl, endpointId, open, proxyBearerToken, proxyPassword, proxyUrl])
  /* eslint-enable react-hooks/set-state-in-effect */

  const initializeFrame = useCallback(async () => {
    if (initializingRef.current) {
      try {
        await initializingRef.current
      } catch {
        // The active initializer owns error/status reporting. Concurrent iframe load events must not leak its rejection.
      }
      return
    }
    const frame = frameRef.current
    if (!frame || !endpointId || !frameOrigin) return
    const run = (async () => {
      setStatus('Loading ComfyUI editor')
      await waitForComfyFrameBridge(frame, frameOrigin)
      if (initialUiJson) {
        await loadUiWorkflowIntoComfyFrame(frame, frameOrigin, initialUiJson)
        setStatus('Loaded editable ComfyUI workflow')
      } else if (initialApiJson) {
        await loadApiWorkflowIntoComfyFrame(frame, frameOrigin, initialApiJson)
        setStatus('Loaded API workflow into ComfyUI editor')
      } else {
        setStatus(initialUiJson ? 'ComfyUI editor ready' : 'ComfyUI editor ready. No editable UI workflow is stored yet.')
      }
      setFrameReady(true)
      setError(undefined)
    })()
    initializingRef.current = run
    try {
      await run
    } catch (err) {
      if (err instanceof ComfyFrameLoginRequiredError) {
        setStatus('ComfyUI login page opened. Log in to continue.')
        setError(undefined)
        return
      }
      setFrameReady(false)
      setError(err instanceof Error ? err.message : 'Failed to initialize ComfyUI editor')
    } finally {
      if (initializingRef.current === run) initializingRef.current = undefined
    }
  }, [endpointId, frameOrigin, initialApiJson, initialUiJson])

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true
    void initializeFrame()
  }, [initializeFrame, open])

  const saveFromComfy = async () => {
    if (!frameRef.current || !endpoint || !frameOrigin) return
    setSaving(true)
    try {
      const { rawJson, uiJson } = await exportWorkflowFromComfyFrame(frameRef.current, frameOrigin)
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

  const showLoadingFallback = Boolean(open && endpoint && proxyUrl && !frameReady && !error && !status.includes('login page'))

  return (
    <ModalShell label="ComfyUI Workflow Editor" modalClassName="comfy-editor-modal" hidden={!open} onClose={onClose}>
      <div className="comfy-editor-shell">
        <div className="comfy-editor-toolbar">
          <div>
            <strong>{endpoint?.name ?? 'ComfyUI'}</strong>
            <span>{endpoint?.baseUrl ?? 'Configure a ComfyUI server first'}</span>
          </div>
          <div className="comfy-editor-actions">
            <span className={error ? 'field-error' : 'comfy-editor-status'}>{error ?? status}</span>
            <button type="button" onClick={saveFromComfy} disabled={!endpoint || saving || !frameReady}>
              {saving ? 'Saving...' : 'Save from ComfyUI'}
            </button>
          </div>
        </div>
        {proxyUrl ? (
          <div className="comfy-editor-frame-wrap">
            {frameSrc ? (
              <iframe
                ref={frameRef}
                title={`ComfyUI editor ${endpoint?.name ?? ''}`.trim()}
                className="comfy-editor-frame"
                src={frameSrc}
                sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                onLoad={() => {
                  if (open) void initializeFrame()
                }}
              />
            ) : null}
            {showLoadingFallback ? (
              <div className="comfy-editor-loading" role="status" aria-label="ComfyUI editor loading">
                <strong>{frameSrc ? 'Waiting for ComfyUI' : 'Loading ComfyUI editor'}</strong>
                <span>
                  {frameSrc
                    ? 'Log in inside ComfyUI if prompted. Extensions and custom nodes will continue loading automatically.'
                    : 'Initializing ComfyUI, extensions, and custom nodes.'}
                </span>
              </div>
            ) : null}
          </div>
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
    // The endpoint list is external store state; keep the local selector on an available entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <ComfyWorkflowEditorDialog
      open={comfyEditorOpen}
      endpoint={selectedComfyEndpoint}
      initialUiJson={workflowUiJson}
      initialApiJson={workflowRawJson}
      onSave={saveEmbeddedWorkflow}
      onClose={() => setComfyEditorOpen(false)}
    />
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
  const selectedFunctionType = selectedIsComfyWorkflow
    ? 'comfyui'
    : selectedIsRequest
      ? 'request'
      : selectedIsOpenAI
        ? 'openai'
        : selectedIsGemini
          ? 'gemini'
          : selectedFunction?.workflow.format ?? ''
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

  /* eslint-disable react-hooks/set-state-in-effect -- Function and endpoint selections are external store state that can disappear independently. */
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
  /* eslint-enable react-hooks/set-state-in-effect */

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
                <label className="field">
                  <span>Function type</span>
                  <input aria-label="Function type" readOnly value={selectedFunctionType} />
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
      {selectedFunction && !selectedIsRequest && !selectedIsProvider ? (
        <ComfyWorkflowEditorDialog
          open={comfyEditorOpen}
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
  endpoint?: ComfyEndpointConfig
  endpointCount: number
  functions: GenerationFunction[]
  queueCounts: Record<string, number>
  onAddEndpoint: (patch?: Omit<Partial<ComfyEndpointConfig>, 'id' | 'health'>) => void
  onUpdateEndpoint: (endpointId: string, patch: Partial<ComfyEndpointConfig>) => void
  onDeleteEndpoint: (endpointId: string) => void
  onTestEndpoint: (endpoint: ComfyEndpointConfig) => void
  onClose: () => void
}

type EndpointSavePatch = Omit<Partial<ComfyEndpointConfig>, 'id' | 'health'>

const endpointHeaders = (endpoint: ComfyEndpointConfig) => Object.entries(endpoint.customHeaders ?? {})

const cloneEndpointDraft = (endpoint: ComfyEndpointConfig): ComfyEndpointConfig => ({
  ...endpoint,
  auth: endpoint.auth ? { ...endpoint.auth } : undefined,
  customHeaders: endpoint.customHeaders ? { ...endpoint.customHeaders } : undefined,
  capabilities: endpoint.capabilities
    ? {
        ...endpoint.capabilities,
        supportedFunctions: endpoint.capabilities.supportedFunctions
          ? [...endpoint.capabilities.supportedFunctions]
          : undefined,
        requiredModels: endpoint.capabilities.requiredModels ? [...endpoint.capabilities.requiredModels] : undefined,
        requiredNodes: endpoint.capabilities.requiredNodes ? [...endpoint.capabilities.requiredNodes] : undefined,
      }
    : undefined,
  health: endpoint.health ? { ...endpoint.health } : undefined,
})

const createEndpointDraft = (endpointCount: number, workflowFunctionIds: string[]): ComfyEndpointConfig => ({
  id: '__new_comfy_endpoint__',
  name: `ComfyUI ${endpointCount + 1}`,
  baseUrl: 'http://127.0.0.1:8188',
  enabled: true,
  maxConcurrentJobs: 1,
  priority: 1,
  timeoutMs: 600000,
  auth: { type: 'none' },
  capabilities: { supportedFunctions: workflowFunctionIds },
  health: { status: 'unknown' },
})

const endpointSavePatch = (endpoint: ComfyEndpointConfig): EndpointSavePatch => ({
  name: endpoint.name,
  baseUrl: endpoint.baseUrl,
  enabled: endpoint.enabled,
  maxConcurrentJobs: endpoint.maxConcurrentJobs,
  priority: endpoint.priority,
  tags: endpoint.tags,
  timeoutMs: endpoint.timeoutMs,
  auth: endpoint.auth,
  customHeaders: endpoint.customHeaders,
  capabilities: endpoint.capabilities,
})

const endpointDraftFingerprint = (endpoint: ComfyEndpointConfig) => JSON.stringify(endpointSavePatch(endpoint))

function EndpointManager({
  endpoint,
  endpointCount,
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
  const workflowFunctionKey = workflowFunctionIds.join('\u0000')
  const [draft, setDraft] = useState<ComfyEndpointConfig>(() =>
    endpoint ? cloneEndpointDraft(endpoint) : createEndpointDraft(endpointCount, workflowFunctionIds),
  )

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- Reset an unsaved draft only when endpoint identity or compatible functions change. */
  useEffect(() => {
    setDraft(endpoint ? cloneEndpointDraft(endpoint) : createEndpointDraft(endpointCount, workflowFunctionIds))
  }, [endpoint?.id, endpointCount, workflowFunctionKey])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const updateDraft = (patch: Partial<ComfyEndpointConfig>) => {
    setDraft((current) => ({ ...current, ...patch }))
  }
  const updateHeader = (index: number, nextKey: string, nextValue: string) => {
    const entries = endpointHeaders(draft)
    entries[index] = [nextKey, nextValue]
    updateDraft({ customHeaders: Object.fromEntries(entries) })
  }
  const addHeader = () => {
    updateDraft({ customHeaders: Object.fromEntries([...endpointHeaders(draft), ['', '']]) })
  }
  const deleteHeader = (index: number) => {
    updateDraft({ customHeaders: Object.fromEntries(endpointHeaders(draft).filter((_, headerIndex) => headerIndex !== index)) })
  }
  const updatePassword = (password: string) => {
    if (password) {
      updateDraft({
        auth: {
          type: 'password',
          password,
          token: draft.auth?.token,
          exportSecret: draft.auth?.exportSecret,
        },
      })
      return
    }
    updateDraft({
      auth: draft.auth?.token
        ? { type: 'token', token: draft.auth.token, exportSecret: draft.auth.exportSecret }
        : { type: 'none' },
    })
  }
  const updateApiToken = (token: string) => {
    if (draft.auth?.type === 'password') {
      updateDraft({ auth: { ...draft.auth, token: token || undefined } })
      return
    }
    updateDraft({
      auth: token ? { type: 'token', token, exportSecret: draft.auth?.exportSecret } : { type: 'none' },
    })
  }
  const setEndpointAllFunctions = (enabled: boolean) => {
    updateDraft(endpointCapabilitiesPatch(draft, enabled ? undefined : workflowFunctionIds))
  }
  const setEndpointFunction = (functionId: string, enabled: boolean) => {
    const supportedFunctions = draft.capabilities?.supportedFunctions
    const explicitFunctions = supportedFunctions === undefined ? workflowFunctionIds : supportedFunctions
    const nextFunctions = enabled
      ? [...explicitFunctions, functionId]
      : explicitFunctions.filter((id) => id !== functionId)
    updateDraft(endpointCapabilitiesPatch(draft, nextFunctions))
  }
  const saveEndpoint = () => {
    if (!draft.name.trim() || !draft.baseUrl.trim()) return
    const patch = endpointSavePatch({
      ...draft,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      maxConcurrentJobs: Math.max(1, Number(draft.maxConcurrentJobs) || 1),
      priority: Number(draft.priority) || 0,
      timeoutMs: Math.max(1000, Number(draft.timeoutMs) || 1000),
    })
    if (endpoint) onUpdateEndpoint(endpoint.id, patch)
    else onAddEndpoint(patch)
    onClose()
  }
  const deleteEndpoint = () => {
    if (!endpoint) return
    onDeleteEndpoint(endpoint.id)
    onClose()
  }
  const status = endpoint?.health?.status ?? draft.health?.status ?? 'unknown'
  const queueCount = endpoint ? (queueCounts[endpoint.id] ?? 0) : 0
  const savedDraftChanged = endpoint ? endpointDraftFingerprint(endpoint) !== endpointDraftFingerprint(draft) : true
  const canTestEndpoint = Boolean(endpoint && !savedDraftChanged)
  const title = endpoint ? 'Edit ComfyUI Server' : 'New ComfyUI Server'
  const saveDisabled = !draft.name.trim() || !draft.baseUrl.trim()

  return (
    <ModalShell label={title} modalClassName="endpoint-manager-modal" onClose={onClose}>
      <div className="endpoint-editor">
        <div className="manager-editor-title endpoint-editor-summary">
          <div className="endpoint-editor-identity">
            <span className="endpoint-editor-glyph" aria-hidden="true">
              <Server size={18} />
            </span>
            <div>
              <strong>{draft.name || title}</strong>
              <span className="endpoint-editor-address">{draft.baseUrl || 'Server URL not set'}</span>
            </div>
          </div>
          <div className="endpoint-summary-actions">
            <div className={`endpoint-signal endpoint-signal-${status}`} aria-label={`Server status ${status}, queue ${queueCount}`}>
              <span className={`status-dot ${status}`} />
              <span>{status}</span>
              <span className="endpoint-signal-divider" aria-hidden="true" />
              <span>{queueCount} queued</span>
            </div>
            {endpoint ? (
              <button
                type="button"
                className="danger-button"
                aria-label="Delete endpoint"
                onClick={deleteEndpoint}
              >
                <Trash2 size={14} />
                Delete
              </button>
            ) : null}
          </div>
        </div>
        <div className="endpoint-editor-scroll">
        <section className="endpoint-section endpoint-connection-section" aria-labelledby="endpoint-connection-heading">
          <div className="endpoint-section-heading">
            <span className="endpoint-section-icon" aria-hidden="true"><Server size={16} /></span>
            <div>
              <h4 id="endpoint-connection-heading">Connection</h4>
              <p>Where jobs run and how this server participates in the queue.</p>
            </div>
          </div>
        <div className="manager-grid endpoint-grid">
          <label className="field endpoint-name-field">
            <span>Name</span>
            <input
              aria-label="Endpoint name"
              value={draft.name}
              onChange={(event) => updateDraft({ name: event.target.value })}
            />
          </label>
          <label className="field endpoint-url-field">
            <span>Server URL</span>
            <input
              className="endpoint-url-input"
              aria-label="Endpoint URL"
              spellCheck={false}
              value={draft.baseUrl}
              onChange={(event) => updateDraft({ baseUrl: event.target.value })}
            />
          </label>
          <label className="field endpoint-number-field">
            <span>Max jobs</span>
            <input
              aria-label="Max jobs"
              type="number"
              min="1"
              value={draft.maxConcurrentJobs}
              onChange={(event) => updateDraft({ maxConcurrentJobs: Math.max(1, Number(event.target.value) || 1) })}
            />
          </label>
          <label className="field endpoint-number-field">
            <span>Priority</span>
            <input
              aria-label="Priority"
              type="number"
              value={draft.priority}
              onChange={(event) => updateDraft({ priority: Number(event.target.value) || 0 })}
            />
          </label>
          <label className="field endpoint-timeout-field">
            <span>Timeout ms</span>
            <input
              aria-label="Timeout"
              type="number"
              min="1000"
              value={draft.timeoutMs}
              onChange={(event) => updateDraft({ timeoutMs: Math.max(1000, Number(event.target.value) || 1000) })}
            />
          </label>
          <label className="inline-check endpoint-enabled">
            <input
              aria-label="Endpoint enabled"
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => updateDraft({ enabled: event.target.checked })}
            />
            Enabled
          </label>
        </div>
        <div className="endpoint-actions">
          <button type="button" disabled={!canTestEndpoint} onClick={() => endpoint && onTestEndpoint(endpoint)}>
            <Route size={14} />
            Test connection
          </button>
          {endpoint?.health?.message ? <span className="endpoint-message">{endpoint.health.message}</span> : null}
          {!canTestEndpoint ? <span className="endpoint-message">Save changes before testing</span> : null}
        </div>
        </section>

        <section className="endpoint-section endpoint-credentials-section" aria-labelledby="endpoint-credentials-heading">
          <div className="endpoint-section-heading">
            <span className="endpoint-section-icon" aria-hidden="true"><KeyRound size={16} /></span>
            <div>
              <h4 id="endpoint-credentials-heading">Credentials</h4>
              <p>Secrets stay with this project and are omitted from normal exports.</p>
            </div>
          </div>
          <div className="endpoint-credential-grid">
            <label className="field endpoint-credential-field endpoint-password-field">
              <span>ComfyUI password</span>
              <input
                aria-label="ComfyUI password"
                type="password"
                autoComplete="current-password"
                value={draft.auth?.type === 'password' ? (draft.auth.password ?? '') : ''}
                onChange={(event) => updatePassword(event.target.value)}
              />
              <small>Use the password configured by ComfyUI authentication.</small>
            </label>
            <label className="field endpoint-credential-field endpoint-api-token-field">
              <span>API token</span>
              <input
                aria-label="ComfyUI API token"
                type="password"
                autoComplete="off"
                value={draft.auth?.token ?? ''}
                onChange={(event) => updateApiToken(event.target.value)}
              />
              <small>Used when API calls cannot reuse the server login cookie.</small>
            </label>
          </div>
        </section>

        <section className="endpoint-section endpoint-function-editor" aria-labelledby="endpoint-workflow-heading">
          <div className="endpoint-section-heading endpoint-section-heading-split">
            <span className="endpoint-section-icon" aria-hidden="true"><Workflow size={16} /></span>
            <div>
              <h4 id="endpoint-workflow-heading">Workflow access</h4>
              <p>Choose which saved workflows may dispatch jobs here.</p>
            </div>
            <span className="endpoint-section-count">{endpointFunctionScopeLabel(draft, workflowFunctionIds)}</span>
          </div>
          <label className="inline-check endpoint-all-functions">
            <input
              aria-label="Endpoint supports all functions"
              type="checkbox"
              checked={draft.capabilities?.supportedFunctions === undefined}
              onChange={(event) => setEndpointAllFunctions(event.target.checked)}
            />
            All workflow functions
          </label>
          <div className="endpoint-function-list">
            {workflowFunctions.length > 0 ? (
              workflowFunctions.map((fn) => {
                const allFunctions = draft.capabilities?.supportedFunctions === undefined
                return (
                  <label className="endpoint-function-item" key={`${draft.id}_${fn.id}`}>
                    <input
                      aria-label={`Endpoint supports ${fn.name}`}
                      type="checkbox"
                      disabled={allFunctions}
                      checked={endpointSupportsWorkflowFunction(draft, fn.id)}
                      onChange={(event) => setEndpointFunction(fn.id, event.target.checked)}
                    />
                    <span>{fn.name}</span>
                  </label>
                )
              })
            ) : (
              <div className="empty-list">No ComfyUI workflow functions</div>
            )}
          </div>
        </section>

        <section className="endpoint-section header-editor" aria-labelledby="endpoint-headers-heading">
          <div className="endpoint-section-heading endpoint-section-heading-split">
            <span className="endpoint-section-icon" aria-hidden="true"><Braces size={16} /></span>
            <div>
              <h4 id="endpoint-headers-heading">Custom headers</h4>
              <p>Attach proxy or gateway headers to every request.</p>
            </div>
            <button type="button" aria-label="Add header" onClick={addHeader}>
              <Plus size={14} />
              Add header
            </button>
          </div>
          <div className="header-list">
            {endpointHeaders(draft).map(([key, value], index) => (
              <div className="header-row" key={`${draft.id}_${index}`}>
                <label>
                  <span>Header name</span>
                  <input
                    aria-label={`Header name ${index + 1}`}
                    spellCheck={false}
                    value={key}
                    onChange={(event) => updateHeader(index, event.target.value, value)}
                  />
                </label>
                <label>
                  <span>Value</span>
                  <input
                    aria-label={`Header value ${index + 1}`}
                    spellCheck={false}
                    value={value}
                    onChange={(event) => updateHeader(index, key, event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete header ${index + 1}`}
                  onClick={() => deleteHeader(index)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
        </div>
        <div className="project-info-actions endpoint-editor-actions">
          <span className="endpoint-save-hint">Changes apply to future jobs.</span>
          <div>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary-action" disabled={saveDisabled} onClick={saveEndpoint}>
              {endpoint ? 'Save changes' : 'Add server'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}

export function ProjectInfoDialog({
  project,
  onUpdate,
  onClose,
}: {
  project: ProjectState['project']
  onUpdate: (patch: { name?: string; description?: string }) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState({
    name: project.name,
    description: project.description ?? '',
  })

  /* eslint-disable react-hooks/set-state-in-effect -- The dialog draft must refresh when another project becomes active. */
  useEffect(() => {
    setDraft({
      name: project.name,
      description: project.description ?? '',
    })
  }, [project.description, project.id, project.name])
  /* eslint-enable react-hooks/set-state-in-effect */

  const saveProjectInfo = () => {
    onUpdate({ name: draft.name, description: draft.description })
    onClose()
  }

  return (
    <ModalShell label="Project information" onClose={onClose}>
      <div className="project-info-dialog" aria-label="Project information form">
        <label className="field">
          <span>Project name</span>
          <input
            aria-label="Project name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>Project description</span>
          <textarea
            aria-label="Project description"
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
          />
        </label>
        <div className="project-info-meta">
          <span>Created {formatHistoryTimestamp(project.createdAt)}</span>
          <span>Updated {formatHistoryTimestamp(project.updatedAt)}</span>
        </div>
        <div className="project-info-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-action" onClick={saveProjectInfo}>
            Save
          </button>
        </div>
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
  const [endpointEditorId, setEndpointEditorId] = useState<'new' | string>()
  const [error, setError] = useState<string>()
  const [pendingProjectDelete, setPendingProjectDelete] = useState<{ projectId: string; projectName: string }>()

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
  const endpointEditorEndpoint = endpointEditorId && endpointEditorId !== 'new'
    ? project.comfy.endpoints.find((endpoint) => endpoint.id === endpointEditorId)
    : undefined
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
    await downloadProjectPackage(exportProject())
  }

  const handleExportConfig = async () => {
    await downloadConfigPackage(exportConfig())
  }

  const handleImport = async (file?: File) => {
    if (!file) return
    try {
      const payload = await readPackageFile(file)
      if (payload.project) importProject({ project: payload.project })
      if (payload.config) importConfig({ config: payload.config })
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
    setPendingProjectDelete({
      projectId: project.project.id,
      projectName: project.project.name || 'Untitled Project',
    })
  }

  const confirmProjectDelete = () => {
    if (!pendingProjectDelete) return
    const { projectId } = pendingProjectDelete
    setPendingProjectDelete(undefined)
    deleteProject(projectId)
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
          <button
            type="button"
            className="section-manage-button"
            onClick={() => setEndpointEditorId(project.comfy.endpoints[0]?.id ?? 'new')}
          >
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

      {endpointEditorId ? (
        <EndpointManager
          endpoint={endpointEditorEndpoint}
          endpointCount={project.comfy.endpoints.length}
          functions={managedFunctions}
          queueCounts={queueCounts}
          onAddEndpoint={addEndpoint}
          onUpdateEndpoint={updateEndpoint}
          onDeleteEndpoint={deleteEndpoint}
          onTestEndpoint={(endpoint) => void checkEndpointStatus(endpoint.id)}
          onClose={() => setEndpointEditorId(undefined)}
        />
      ) : null}
      {pendingProjectDelete ? (
        <ConfirmationDialog
          label="Delete project confirmation"
          title="Delete project?"
          message={
            <>
              Delete <strong>{pendingProjectDelete.projectName}</strong> and all of its assets, functions, and run history?
              This action cannot be undone.
            </>
          }
          confirmLabel="Delete project"
          onCancel={() => setPendingProjectDelete(undefined)}
          onConfirm={confirmProjectDelete}
        />
      ) : null}
    </ModalShell>
  )
}

type LeftDockPanel = 'assets' | 'history' | 'functions' | 'servers' | 'tasks' | 'runQueue'

export function LeftPanel() {
  const project = useProjectStore((state) => state.project)
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId)
  const selectedNodeIds = useProjectStore((state) => state.selectedNodeIds)
  const selectNode = useProjectStore((state) => state.selectNode)
  const undoLastProjectChange = useProjectStore((state) => state.undoLastProjectChange)
  const redoProjectChange = useProjectStore((state) => state.redoProjectChange)
  const fetchComfyHistory = useProjectStore((state) => state.fetchComfyHistory)
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
  const [openDock, setOpenDock] = useState<LeftDockPanel>()
  const [historyRows, setHistoryRows] = useState<HistoryDockRow[]>([])
  const [expandedTaskId, setExpandedTaskId] = useState<string | undefined>()
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>()
  const [functionManagerOpen, setFunctionManagerOpen] = useState(false)
  const [createFunctionOpen, setCreateFunctionOpen] = useState(false)
  const [endpointEditorId, setEndpointEditorId] = useState<'new' | string>()
  const [dockError, setDockError] = useState<string>()
  const [pendingConfirmation, setPendingConfirmation] = useState<
    | { kind: 'function'; functionId: string; name: string }
    | { kind: 'endpoint'; endpointId: string; name: string }
  >()
  const [previewResource, setPreviewResource] = useState<Resource | undefined>()
  const [historyDialog, setHistoryDialog] = useState<{
    title: string
    status: 'loading' | 'loaded' | 'failed'
    content: string
  }>()
  const previewTimerRef = useRef<number | undefined>(undefined)
  const historyRefreshTimerRef = useRef<number | undefined>(undefined)
  const newFunctionButtonRef = useRef<HTMLButtonElement | null>(null)
  const newServerButtonRef = useRef<HTMLButtonElement | null>(null)
  const assetsOpen = openDock === 'assets'
  const historyOpen = openDock === 'history'
  const functionsOpen = openDock === 'functions'
  const serversOpen = openDock === 'servers'
  const tasksOpen = openDock === 'tasks'
  const runQueueOpen = openDock === 'runQueue'
  const resources = Object.values(project.resources)
  const functions = useMemo(() => Object.values(project.functions), [project.functions])
  const managedFunctions = useMemo(() => functions.filter((fn) => !isBuiltInFunction(fn)), [functions])
  const workflowFunctionIds = useMemo(() => managedFunctions.filter(isComfyWorkflowFunction).map((fn) => fn.id), [managedFunctions])
  const historyCount = (project.history?.undoStack.length ?? 0) + (project.history?.redoStack.length ?? 0)
  const queueCounts = useMemo(() => endpointQueueCounts(project.tasks), [project.tasks])
  const endpointEditorEndpoint = endpointEditorId && endpointEditorId !== 'new'
    ? project.comfy.endpoints.find((endpoint) => endpoint.id === endpointEditorId)
    : undefined
  const projectTasks = useMemo(
    () =>
      Object.values(project.tasks).sort((left, right) => {
        const created = right.createdAt.localeCompare(left.createdAt)
        if (created !== 0) return created
        return right.id.localeCompare(left.id)
      }),
    [project.tasks],
  )
  const activeProjectTasks = useMemo(
    () => projectTasks.filter((task) => activeTaskStatuses.has(task.status)),
    [projectTasks],
  )
  const activeSelectedNodeIds = useMemo(
    () => (selectedNodeIds.length > 0 ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : []),
    [selectedNodeId, selectedNodeIds],
  )
  const runQueueHistory = useMemo(
    () =>
      activeSelectedNodeIds.length > 0
        ? getSelectedNodesRunHistory(project, activeSelectedNodeIds)
        : getProjectRunHistory(project),
    [activeSelectedNodeIds, project],
  )
  const refreshHistoryRows = useCallback(() => setHistoryRows(buildHistoryDockRows(project)), [project])
  const closeDock = () => setOpenDock(undefined)
  const toggleDock = (panel: LeftDockPanel) => {
    setOpenDock((current) => {
      const nextPanel = current === panel ? undefined : panel
      if (nextPanel === 'history') setHistoryRows(buildHistoryDockRows(project))
      return nextPanel
    })
  }
  const focusResourceNode = (resource: Resource) => {
    setPreviewResource(undefined)
    const nodeId = resourceOwnerNodeId(project, resource)
    if (!nodeId) return
    selectNode(nodeId)
    closeDock()
    window.dispatchEvent(new CustomEvent('infinity-focus-node', { detail: { nodeId } }))
  }
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
  const bindNewWorkflowFunctionToEndpoint = (functionId: string, endpointId: string) => {
    const nextWorkflowFunctionIds = [...workflowFunctionIds, functionId]
    for (const endpoint of project.comfy.endpoints) {
      const supportedFunctions = endpoint.capabilities?.supportedFunctions
      const nextSupportedFunctions =
        endpoint.id === endpointId
          ? [...(supportedFunctions ?? workflowFunctionIds), functionId]
          : supportedFunctions === undefined
            ? workflowFunctionIds
            : supportedFunctions.filter((id) => id !== functionId)
      updateEndpoint(endpoint.id, endpointCapabilitiesPatch(endpoint, nextSupportedFunctions.filter((id) => nextWorkflowFunctionIds.includes(id))))
    }
  }
  const handleWorkflowAdd = (
    name: string,
    workflow: ComfyWorkflow,
    options?: { uiJson?: ComfyUiWorkflow; editor?: ComfyWorkflowEditorMetadata },
  ) => {
    try {
      const functionId = addFunctionFromWorkflow(name.trim() || 'ComfyUI Workflow', workflow, options)
      setDockError(undefined)
      setSelectedFunctionId(functionId)
      return functionId
    } catch (err) {
      setDockError(err instanceof Error ? err.message : 'Invalid workflow JSON')
      return undefined
    }
  }
  const handleRequestFunctionAdd = (name: string, config: Partial<RequestFunctionConfig>) => {
    try {
      const functionId = addRequestFunction(name.trim() || 'Request Function', config)
      setDockError(undefined)
      setSelectedFunctionId(functionId)
      return functionId
    } catch (err) {
      setDockError(err instanceof Error ? err.message : 'Invalid request function')
      return undefined
    }
  }
  const handleOpenAIFunctionAdd = (name: string, config: Partial<OpenAILlmConfig>) => {
    try {
      const functionId = addOpenAILlmFunction(name.trim() || 'OpenAI LLM Function', config)
      setDockError(undefined)
      setSelectedFunctionId(functionId)
      return functionId
    } catch (err) {
      setDockError(err instanceof Error ? err.message : 'Invalid OpenAI function')
      return undefined
    }
  }
  const handleGeminiFunctionAdd = (name: string, config: Partial<GeminiLlmConfig>) => {
    try {
      const functionId = addGeminiLlmFunction(name.trim() || 'Gemini LLM Function', config)
      setDockError(undefined)
      setSelectedFunctionId(functionId)
      return functionId
    } catch (err) {
      setDockError(err instanceof Error ? err.message : 'Invalid Gemini function')
      return undefined
    }
  }
  const editFunction = (functionId: string) => {
    setSelectedFunctionId(functionId)
    setFunctionManagerOpen(true)
  }
  const removeFunction = (functionId: string) => {
    const fn = managedFunctions.find((item) => item.id === functionId)
    if (!fn) return
    setPendingConfirmation({ kind: 'function', functionId, name: fn.name })
  }
  const removeEndpoint = (endpoint: ComfyEndpointConfig) => {
    const activeEndpointTasks = Object.values(project.tasks).filter(
      (task) => task.endpointId === endpoint.id && activeTaskStatuses.has(task.status),
    )
    if (activeEndpointTasks.length > 0) {
      setDockError(
        `Cannot delete "${endpoint.name}" while ${activeEndpointTasks.length} active task${activeEndpointTasks.length > 1 ? 's are' : ' is'} running.`,
      )
      return
    }
    setPendingConfirmation({ kind: 'endpoint', endpointId: endpoint.id, name: endpoint.name })
  }
  const confirmPendingAction = () => {
    if (!pendingConfirmation) return
    const action = pendingConfirmation
    setPendingConfirmation(undefined)
    if (action.kind === 'function') {
      deleteFunction(action.functionId)
      if (selectedFunctionId === action.functionId) setSelectedFunctionId(undefined)
      return
    }
    const activeEndpointTasks = Object.values(project.tasks).filter(
      (task) => task.endpointId === action.endpointId && activeTaskStatuses.has(task.status),
    )
    if (activeEndpointTasks.length > 0) {
      setDockError(
        `Cannot delete "${action.name}" while ${activeEndpointTasks.length} active task${activeEndpointTasks.length > 1 ? 's are' : ' is'} running.`,
      )
      return
    }
    deleteEndpoint(action.endpointId)
    setDockError(undefined)
  }
  const functionKind = (fn: GenerationFunction) => {
    if (isRequestFunction(fn)) return 'request'
    if (isOpenAILlmFunction(fn)) return 'openai'
    if (isGeminiLlmFunction(fn)) return 'gemini'
    return 'comfyui'
  }
  const functionSummary = (fn: GenerationFunction) =>
    `${fn.inputs.length} inputs · ${fn.outputs.length} outputs · ${fn.workflow.format}`

  useEffect(
    () => () => {
      if (previewTimerRef.current === undefined) return
      window.clearTimeout(previewTimerRef.current)
    },
    [],
  )
  useEffect(() => {
    if (!historyOpen) {
      if (historyRefreshTimerRef.current !== undefined) {
        window.clearTimeout(historyRefreshTimerRef.current)
        historyRefreshTimerRef.current = undefined
      }
      return
    }

    if (historyRefreshTimerRef.current !== undefined) window.clearTimeout(historyRefreshTimerRef.current)
    historyRefreshTimerRef.current = window.setTimeout(() => {
      refreshHistoryRows()
      historyRefreshTimerRef.current = undefined
    }, HISTORY_LIST_IDLE_MS)

    return () => {
      if (historyRefreshTimerRef.current === undefined) return
      window.clearTimeout(historyRefreshTimerRef.current)
      historyRefreshTimerRef.current = undefined
    }
  }, [historyOpen, project, refreshHistoryRows])

  return (
    <aside
      className={`assets-dock ${openDock ? 'is-open' : ''}`}
      aria-label="Assets panel"
      onMouseLeave={closeDock}
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeDock()
      }}
    >
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
      {createFunctionOpen ? (
        <NewFunctionDialog
          comfyEndpoints={project.comfy.endpoints}
          onClose={() => setCreateFunctionOpen(false)}
          onSaveComfy={handleWorkflowAdd}
          onSaveRequest={handleRequestFunctionAdd}
          onSaveOpenAI={handleOpenAIFunctionAdd}
          onSaveGemini={handleGeminiFunctionAdd}
          onBindComfyEndpoint={bindNewWorkflowFunctionToEndpoint}
        />
      ) : null}
      {endpointEditorId ? (
        <EndpointManager
          endpoint={endpointEditorEndpoint}
          endpointCount={project.comfy.endpoints.length}
          functions={managedFunctions}
          queueCounts={queueCounts}
          onAddEndpoint={addEndpoint}
          onUpdateEndpoint={updateEndpoint}
          onDeleteEndpoint={deleteEndpoint}
          onTestEndpoint={(endpoint) => void checkEndpointStatus(endpoint.id)}
          onClose={() => setEndpointEditorId(undefined)}
        />
      ) : null}
      {pendingConfirmation ? (
        <ConfirmationDialog
          label={pendingConfirmation.kind === 'function' ? 'Delete function confirmation' : 'Delete ComfyUI server confirmation'}
          title={pendingConfirmation.kind === 'function' ? 'Delete function?' : 'Delete ComfyUI server?'}
          message={
            pendingConfirmation.kind === 'function' ? (
              <>
                Delete <strong>{pendingConfirmation.name}</strong> from this project? Existing run history is kept, but the
                function will no longer be available for new runs.
              </>
            ) : (
              <>
                Delete <strong>{pendingConfirmation.name}</strong> from this project? Saved workflows will remain, but this
                server configuration and its credentials will be removed.
              </>
            )
          }
          confirmLabel={pendingConfirmation.kind === 'function' ? 'Delete function' : 'Delete server'}
          restoreFocusFallback={() =>
            pendingConfirmation.kind === 'function' ? newFunctionButtonRef.current : newServerButtonRef.current
          }
          onCancel={() => setPendingConfirmation(undefined)}
          onConfirm={confirmPendingAction}
        />
      ) : null}
      <div className="assets-dock-stack">
        <button
          type="button"
          className={`assets-dock-button${assetsOpen ? ' is-active' : ''}`}
          aria-label="Assets"
          aria-expanded={assetsOpen}
          aria-controls="assets-popover"
          onClick={() => toggleDock('assets')}
        >
          <FileInput size={20} />
        </button>
        <button
          type="button"
          className={`assets-dock-button${historyOpen ? ' is-active' : ''}`}
          aria-label="History"
          aria-expanded={historyOpen}
          aria-controls="history-popover"
          onClick={() => toggleDock('history')}
        >
          <History size={20} />
        </button>
        <button
          type="button"
          className={`assets-dock-button${functionsOpen ? ' is-active' : ''}`}
          aria-label="Functions"
          aria-expanded={functionsOpen}
          aria-controls="functions-popover"
          onClick={() => toggleDock('functions')}
        >
          <Workflow size={20} />
        </button>
        <button
          type="button"
          className={`assets-dock-button${serversOpen ? ' is-active' : ''}`}
          aria-label="ComfyUI Servers"
          aria-expanded={serversOpen}
          aria-controls="comfyui-servers-popover"
          onClick={() => toggleDock('servers')}
        >
          <Network size={20} />
        </button>
        <button
          type="button"
          className={`assets-dock-button${tasksOpen ? ' is-active' : ''}`}
          aria-label="Project Tasks"
          aria-expanded={tasksOpen}
          aria-controls="project-tasks-popover"
          onClick={() => toggleDock('tasks')}
        >
          <Zap size={20} />
        </button>
        <button
          type="button"
          className={`assets-dock-button${runQueueOpen ? ' is-active' : ''}`}
          aria-label="Run Queue"
          aria-expanded={runQueueOpen}
          aria-controls="run-queue-popover"
          onClick={() => toggleDock('runQueue')}
        >
          <Route size={20} />
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
            <span>{historyOpen ? historyRows.length : historyCount}</span>
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
            {historyRows.length > 0 ? (
              historyRows.map((row) => {
                const previewResources = row.assetIds.map((resourceId) => project.resources[resourceId]).filter((item): item is Resource => Boolean(item))
                const focusNodeId = row.nodeIds.find((nodeId) =>
                  project.canvas.nodes.some((node) => node.id === nodeId),
                )

                return (
                  <article
                    key={row.id}
                    className={`history-command-row history-command-row-${row.stack}`}
                    onDoubleClick={() => {
                      if (!focusNodeId) return
                      selectNode(focusNodeId)
                      window.dispatchEvent(new CustomEvent('infinity-focus-node', { detail: { nodeId: focusNodeId } }))
                    }}
                  >
                    <div className="history-command-main">
                      <strong>{row.title}</strong>
                      <small>
                        {row.subtitle}
                        <span>{`#${row.sequence}`}</span>
                        <span>{row.createdAtLabel}</span>
                        {row.durationLabel ? <span>{row.durationLabel}</span> : null}
                        <span>{row.stack === 'redo' ? 'redo' : 'undo'}</span>
                      </small>
                    </div>
                    {previewResources.length > 0 ? (
                      <div className="history-command-assets" aria-label={`${row.label} assets`}>
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
      {functionsOpen ? (
        <section
          id="functions-popover"
          className="side-panel left-panel asset-popover left-dock-popover functions-popover"
          aria-label="Functions popover"
        >
          <div className="panel-title asset-popover-title">
            <Workflow size={16} />
            <h2>Functions</h2>
            <span>{managedFunctions.length}</span>
          </div>
          <div className="dock-management-toolbar">
            <button
              ref={newFunctionButtonRef}
              type="button"
              className="dock-create-button"
              onClick={() => setCreateFunctionOpen(true)}
            >
              <Plus size={15} />
              New function
            </button>
          </div>
          <div className="dock-management-list function-management-list" aria-label="Function list">
            {managedFunctions.length > 0 ? (
              managedFunctions.map((fn) => (
                <article key={fn.id} className="dock-management-item function-management-item">
                  <Workflow size={18} />
                  <span className="dock-management-copy">
                    <strong title={fn.name}>{fn.name}</strong>
                    <small title={functionSummary(fn)}>{functionSummary(fn)}</small>
                  </span>
                  <em>{functionKind(fn)}</em>
                  <span className="dock-management-actions">
                    <button type="button" aria-label={`Edit function ${fn.name}`} onClick={() => editFunction(fn.id)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      aria-label={`Delete function ${fn.name}`}
                      onClick={() => removeFunction(fn.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </article>
              ))
            ) : (
              <div className="empty-list">No custom functions</div>
            )}
          </div>
          {dockError ? <div className="toast-error dock-toast-error">{dockError}</div> : null}
        </section>
      ) : null}
      {serversOpen ? (
        <section
          id="comfyui-servers-popover"
          className="side-panel left-panel asset-popover left-dock-popover servers-popover"
          aria-label="ComfyUI Servers popover"
        >
          <div className="panel-title asset-popover-title">
            <Network size={16} />
            <h2>ComfyUI Servers</h2>
            <span>{project.comfy.endpoints.length}</span>
          </div>
          <div className="dock-management-toolbar">
            <button
              ref={newServerButtonRef}
              type="button"
              className="dock-create-button"
              onClick={() => setEndpointEditorId('new')}
            >
              <Plus size={15} />
              New server
            </button>
          </div>
          <div className="dock-management-list endpoint-list" aria-label="ComfyUI server list">
            {project.comfy.endpoints.length > 0 ? (
              project.comfy.endpoints.map((endpoint) => {
                const status = endpoint.enabled ? (endpoint.health?.status ?? 'unknown') : 'disabled'
                const queueCount = queueCounts[endpoint.id] ?? 0
                return (
                  <article key={endpoint.id} className="dock-management-item server-management-item">
                    <span className={`status-dot ${status}`} />
                    <span className="dock-management-copy">
                      <strong title={endpoint.name}>{endpoint.name}</strong>
                      <small title={endpoint.baseUrl}>{endpoint.baseUrl}</small>
                    </span>
                    <em>
                      {status} · queue {queueCount}
                    </em>
                    <span className="dock-management-actions">
                      <button
                        type="button"
                        aria-label={`Edit server ${endpoint.name}`}
                        onClick={() => setEndpointEditorId(endpoint.id)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        aria-label={`Delete server ${endpoint.name}`}
                      onClick={() => removeEndpoint(endpoint)}
                    >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </article>
                )
              })
            ) : (
              <div className="empty-list">No servers</div>
            )}
          </div>
          {dockError ? <div className="toast-error dock-toast-error">{dockError}</div> : null}
        </section>
      ) : null}
      {tasksOpen ? (
        <section
          id="project-tasks-popover"
          className="side-panel left-panel asset-popover left-dock-popover project-tasks-popover"
          aria-label="Project Tasks popover"
        >
          <div className="panel-title asset-popover-title">
            <Zap size={16} />
            <h2>Active Runs</h2>
            <span>{activeProjectTasks.length}</span>
          </div>
          <div className="job-list task-popover-list" aria-label="Project task list">
            {activeProjectTasks.map((task) => (
              <ProjectTaskCard
                key={task.id}
                project={project}
                task={task}
                expanded={expandedTaskId === task.id}
                onToggle={() => setExpandedTaskId((current) => (current === task.id ? undefined : task.id))}
                onFocusNode={focusCanvasNode}
                onPreviewResource={setPreviewResource}
              />
            ))}
            {activeProjectTasks.length === 0 ? <div className="inspector-empty">No active runs</div> : null}
          </div>
        </section>
      ) : null}
      {runQueueOpen ? (
        <section
          id="run-queue-popover"
          className="side-panel left-panel asset-popover left-dock-popover run-queue-popover"
          aria-label="Run Queue popover"
        >
          <div className="panel-title asset-popover-title">
            <Route size={16} />
            <h2>Runs</h2>
            <span>{runQueueHistory.length}</span>
          </div>
          <p className="dock-popover-note">
            {activeSelectedNodeIds.length > 0
              ? `${activeSelectedNodeIds.length} selected node${activeSelectedNodeIds.length > 1 ? 's' : ''}`
              : 'All nodes'}
          </p>
          {runQueueHistory.length > 0 ? (
            <div className="run-record-list run-queue-list" aria-label="Run queue list">
              {runQueueHistory.map((item) => (
                <RunRecordCard
                  key={item.taskId}
                  project={project}
                  item={item}
                  onFocusNode={focusCanvasNode}
                  onOpenHistory={openHistory}
                  onPreviewResource={setPreviewResource}
                />
              ))}
            </div>
          ) : (
            <div className="inspector-empty">
              {activeSelectedNodeIds.length > 0 ? 'No runs for selected nodes' : 'No runs'}
            </div>
          )}
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
