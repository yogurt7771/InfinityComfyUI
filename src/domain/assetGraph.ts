export const assetGraphNodeKinds = ['asset', 'group'] as const

export type AssetGraphNodeKind = (typeof assetGraphNodeKinds)[number]

export type AssetGraphPoint = {
  x: number
  y: number
}

export type AssetGraphSize = {
  width: number
  height: number
}

export type AssetGraphAssetNode = {
  id: string
  type: 'asset'
  position: AssetGraphPoint
  size?: AssetGraphSize
  data: {
    resourceId: string
    title?: string
  }
}

export type AssetGraphGroupNode = {
  id: string
  type: 'group'
  position: AssetGraphPoint
  size: AssetGraphSize
  data: {
    title: string
    childNodeIds: string[]
    color?: string
    collapsed?: boolean
    templateInstanceId?: string
  }
}

export type AssetGraphNode = AssetGraphAssetNode | AssetGraphGroupNode

export type AssetLineageEdge = {
  id: string
  runId: string
  inputKey: string
  sourceResourceId: string
  targetResourceId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPoint = (value: unknown): value is AssetGraphPoint =>
  isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number'

const isSize = (value: unknown): value is AssetGraphSize =>
  isRecord(value) && typeof value.width === 'number' && typeof value.height === 'number'

export function isAssetGraphNode(value: unknown): value is AssetGraphNode {
  if (!isRecord(value) || typeof value.id !== 'string' || !isPoint(value.position) || !isRecord(value.data)) {
    return false
  }

  if (value.type === 'asset') {
    return (
      typeof value.data.resourceId === 'string' &&
      (value.size === undefined || isSize(value.size)) &&
      (value.data.title === undefined || typeof value.data.title === 'string')
    )
  }

  if (value.type === 'group') {
    return (
      isSize(value.size) &&
      typeof value.data.title === 'string' &&
      Array.isArray(value.data.childNodeIds) &&
      value.data.childNodeIds.every((nodeId) => typeof nodeId === 'string')
    )
  }

  return false
}

export function assetLineageEdgeId(input: {
  runId: string
  inputKey: string
  sourceResourceId: string
  targetResourceId: string
}) {
  return `lineage:${input.runId}:${input.inputKey}:${input.sourceResourceId}:${input.targetResourceId}`
}

export function createAssetLineageEdge(input: {
  runId: string
  inputKey: string
  sourceResourceId: string
  targetResourceId: string
}): AssetLineageEdge {
  return {
    id: assetLineageEdgeId(input),
    runId: input.runId,
    inputKey: input.inputKey,
    sourceResourceId: input.sourceResourceId,
    targetResourceId: input.targetResourceId,
  }
}
