import type { CanvasNode, ExecutionTask, GenerationFunction, Resource, ResourceType } from './types'
import { formatDurationMs, runDurationMs } from './runTiming'

const NODE_PADDING_X = 30
const NODE_PADDING_Y = 30
const TITLE_ICON_WIDTH = 16
const TITLE_GAP = 8
const TITLE_ROW_HEIGHT = 28
const META_ROW_HEIGHT = 28
const ACTION_ROW_HEIGHT = 30
const META_MARGIN_TOP = 6
const ACTION_MARGIN_TOP = 8
const PREVIEW_MARGIN_TOP = 10
const REF_BADGE_MIN_WIDTH = 46
const DELETE_BUTTON_WIDTH = 28
const ACTION_BUTTONS_WIDTH = 30 * 3 + 6 * 2

const TITLE_TEXT_MIN_WIDTH = 80
const TITLE_TEXT_MAX_WIDTH = 280
const FUNCTION_CHIP_MIN_WIDTH = 112
const FUNCTION_CHIP_MAX_WIDTH = 220

const PREVIEW_MIN_SIZE_BY_TYPE: Record<ResourceType, { width: number; height: number }> = {
  image: { width: 260, height: 154 },
  video: { width: 260, height: 154 },
  audio: { width: 260, height: 44 },
  text: { width: 230, height: 92 },
  number: { width: 200, height: 42 },
  boolean: { width: 200, height: 42 },
}

const visibleAssetStatuses = new Set(['pending', 'queued', 'running', 'fetching_outputs', 'failed'])

export type ResourceNodeMinSizeInput = {
  resourceType?: ResourceType | string
  title?: string
  referenceCount?: number
  assetStatus?: string
  durationLabel?: string
  sourceFunctionName?: string
}

export type ResourceNodeLayoutContext = {
  functionsById: Record<string, GenerationFunction>
  resourcesById?: Record<string, Resource>
  tasksById?: Record<string, ExecutionTask>
  nodeReferenceCountsById?: Record<string, number>
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

const typedResourceType = (value: unknown): ResourceType =>
  value === 'image' ||
  value === 'video' ||
  value === 'audio' ||
  value === 'number' ||
  value === 'boolean' ||
  value === 'text'
    ? value
    : 'text'

const estimateTextWidth = (value: string | undefined) => {
  if (!value) return 0

  let width = 0
  for (const character of Array.from(value)) {
    if (/[\u2E80-\u9FFF]/u.test(character)) {
      width += 14
    } else if (/[A-Z]/.test(character)) {
      width += 8
    } else if (/[mwMW]/.test(character)) {
      width += 9
    } else if (/[0-9]/.test(character)) {
      width += 7
    } else if (/\s/.test(character)) {
      width += 4
    } else if (/[-_.:/]/.test(character)) {
      width += 4
    } else {
      width += 7
    }
  }

  return Math.ceil(width)
}

const chipWidth = (label: string | undefined, min: number, max: number, extra = 18) =>
  label ? clamp(estimateTextWidth(label) + extra, min, max) : 0

export function resourceNodeMinSize(input: ResourceNodeMinSizeInput) {
  const resourceType = typedResourceType(input.resourceType)
  const preview = PREVIEW_MIN_SIZE_BY_TYPE[resourceType]
  const referenceLabel = `${Math.max(0, input.referenceCount ?? 0)} refs`
  const referenceWidth = Math.max(REF_BADGE_MIN_WIDTH, estimateTextWidth(referenceLabel) + 12)
  const titleTextWidth = clamp(estimateTextWidth(input.title), TITLE_TEXT_MIN_WIDTH, TITLE_TEXT_MAX_WIDTH)
  const titleWidth =
    NODE_PADDING_X +
    TITLE_ICON_WIDTH +
    titleTextWidth +
    referenceWidth +
    DELETE_BUTTON_WIDTH +
    TITLE_GAP * 3

  const statusWidth = input.assetStatus && visibleAssetStatuses.has(input.assetStatus)
    ? chipWidth(input.assetStatus, 64, 126, 28)
    : 0
  const durationWidth = input.durationLabel ? chipWidth(input.durationLabel, 58, 88, 18) : 0
  const functionWidth = input.sourceFunctionName
    ? chipWidth(input.sourceFunctionName, FUNCTION_CHIP_MIN_WIDTH, FUNCTION_CHIP_MAX_WIDTH, 22)
    : 0
  const metaItemWidths = [estimateTextWidth(resourceType), statusWidth, durationWidth, functionWidth].filter(
    (width) => width > 0,
  )
  const metaWidth =
    NODE_PADDING_X +
    metaItemWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, metaItemWidths.length - 1) * 8

  const actionsWidth = NODE_PADDING_X + ACTION_BUTTONS_WIDTH
  const previewWidth = NODE_PADDING_X + preview.width
  const width = Math.ceil(Math.max(titleWidth, metaWidth, actionsWidth, previewWidth))
  const height = Math.ceil(
    NODE_PADDING_Y +
      TITLE_ROW_HEIGHT +
      META_MARGIN_TOP +
      META_ROW_HEIGHT +
      ACTION_MARGIN_TOP +
      ACTION_ROW_HEIGHT +
      PREVIEW_MARGIN_TOP +
      preview.height,
  )

  return { width, height }
}

const resourceTitle = (node: CanvasNode, resource: Resource | undefined) =>
  String(node.data.title ?? resource?.name ?? 'Resource')

const resourceSourceFunction = (
  resource: Resource | undefined,
  functionsById: Record<string, GenerationFunction>,
  tasksById: Record<string, ExecutionTask> | undefined,
) => {
  const taskId = resource?.source.taskId
  const functionId = resource?.metadata?.workflowFunctionId ?? (taskId ? tasksById?.[taskId]?.functionId : undefined)
  return functionId ? functionsById[functionId] : undefined
}

const visibleResourceStatus = (
  node: CanvasNode,
  resource: Resource | undefined,
  tasksById: Record<string, ExecutionTask> | undefined,
) => {
  if (resource?.source.kind !== 'function_output') return undefined
  const taskId = resource.source.taskId ?? (typeof node.data.taskId === 'string' ? node.data.taskId : undefined)
  const taskStatus = taskId ? tasksById?.[taskId]?.status : undefined
  const status = taskStatus ?? (typeof node.data.status === 'string' ? node.data.status : undefined)
  return status && visibleAssetStatuses.has(status) ? status : undefined
}

const resourceDurationLabel = (
  resource: Resource | undefined,
  tasksById: Record<string, ExecutionTask> | undefined,
) => {
  const taskId = resource?.source.taskId
  const task = taskId ? tasksById?.[taskId] : undefined
  return formatDurationMs(runDurationMs(task))
}

export function resourceNodeMinSizeForCanvasNode(node: CanvasNode, context: ResourceNodeLayoutContext) {
  const resourceId = typeof node.data.resourceId === 'string' ? node.data.resourceId : undefined
  const resource = resourceId ? context.resourcesById?.[resourceId] : undefined
  const sourceFunction = resourceSourceFunction(resource, context.functionsById, context.tasksById)

  return resourceNodeMinSize({
    resourceType: resource?.type ?? (typeof node.data.resourceType === 'string' ? node.data.resourceType : undefined),
    title: resourceTitle(node, resource),
    referenceCount: context.nodeReferenceCountsById?.[node.id] ?? 0,
    assetStatus: visibleResourceStatus(node, resource, context.tasksById),
    durationLabel: resourceDurationLabel(resource, context.tasksById),
    sourceFunctionName: sourceFunction?.name,
  })
}
