import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { AssetGraphAssetNode, AssetGraphGroupNode, AssetGraphNode, AssetLineageEdge } from './assetGraph'

export type AssetNodeViewData = AssetGraphAssetNode['data'] & {
  handles: {
    source: string
    target: string
  }
}

export type GroupNodeViewData = AssetGraphGroupNode['data']

export type AssetGraphProjection = {
  nodes: Node<AssetNodeViewData | GroupNodeViewData>[]
  edges: Edge[]
}

export type BuildAssetGraphProjectionInput = {
  nodes: AssetGraphNode[]
  edges: AssetLineageEdge[]
}

const edgeMarkerEnd = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: '#48616b',
} as const

const sourceHandleId = (resourceId: string) => `asset-source:${resourceId}`
const targetHandleId = (resourceId: string) => `asset-target:${resourceId}`

const assetNodeByResourceId = (nodes: AssetGraphNode[]) => {
  const byResourceId = new Map<string, AssetGraphAssetNode>()
  for (const node of nodes) {
    if (node.type === 'asset') byResourceId.set(node.data.resourceId, node)
  }
  return byResourceId
}

const nodeStyle = (node: AssetGraphNode) => (node.size ? { width: node.size.width, height: node.size.height } : undefined)

const projectNode = (node: AssetGraphNode): Node<AssetNodeViewData | GroupNodeViewData> => {
  if (node.type === 'asset') {
    return {
      id: node.id,
      type: 'asset',
      position: node.position,
      data: {
        ...node.data,
        handles: {
          source: sourceHandleId(node.data.resourceId),
          target: targetHandleId(node.data.resourceId),
        },
      },
      ...(nodeStyle(node) ? { style: nodeStyle(node) } : {}),
    }
  }

  return {
    id: node.id,
    type: 'group',
    position: node.position,
    data: node.data,
    style: nodeStyle(node),
  }
}

const projectEdge = (edge: AssetLineageEdge, nodesByResourceId: Map<string, AssetGraphAssetNode>): Edge | undefined => {
  const sourceNode = nodesByResourceId.get(edge.sourceResourceId)
  const targetNode = nodesByResourceId.get(edge.targetResourceId)
  if (!sourceNode || !targetNode) return undefined

  return {
    id: edge.id,
    source: sourceNode.id,
    sourceHandle: sourceHandleId(edge.sourceResourceId),
    target: targetNode.id,
    targetHandle: targetHandleId(edge.targetResourceId),
    animated: false,
    label: edge.inputKey,
    type: 'default',
    className: 'asset-lineage-edge',
    markerEnd: edgeMarkerEnd,
  }
}

export function buildAssetGraphProjection(input: BuildAssetGraphProjectionInput): AssetGraphProjection {
  const nodesByResourceId = assetNodeByResourceId(input.nodes)
  return {
    nodes: input.nodes.map(projectNode),
    edges: input.edges
      .map((edge) => projectEdge(edge, nodesByResourceId))
      .filter((edge): edge is Edge => Boolean(edge)),
  }
}
