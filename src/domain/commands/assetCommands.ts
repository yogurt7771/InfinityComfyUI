import type { AssetGraphNode, AssetGraphPoint, AssetLineageEdge } from '../assetGraph'
import type { AssetRecord, Resource } from '../types'
import { createCommandTransaction } from './commandHistory'
import type { CommandTransaction } from './commandTypes'

export type AssetCommandProject = {
  canvas: {
    nodes: AssetGraphNode[]
    edges: AssetLineageEdge[]
  }
  resources: Record<string, Resource>
  assets: Record<string, AssetRecord>
}

type AssetCommandResult = {
  project: AssetCommandProject
  transaction: CommandTransaction<AssetCommandProject> | undefined
}

type CommandMeta = {
  now: string
  transactionId: string
}

const resourceAssetId = (resource: Resource | undefined) => {
  const value = resource?.value
  return typeof value === 'object' && value !== null && 'assetId' in value && typeof value.assetId === 'string'
    ? value.assetId
    : undefined
}

const assetNodeResourceId = (node: AssetGraphNode | undefined) => (node?.type === 'asset' ? node.data.resourceId : undefined)

const unique = (items: Array<string | undefined>) => [...new Set(items.filter((item): item is string => Boolean(item)))]

const commandProjectSnapshot = (project: AssetCommandProject): AssetCommandProject => structuredClone(project)

const assetNodeIdsForResources = (project: AssetCommandProject, resourceIds: string[]) => {
  const resourceIdSet = new Set(resourceIds)
  return project.canvas.nodes
    .filter((node) => node.type === 'asset' && resourceIdSet.has(node.data.resourceId))
    .map((node) => node.id)
}

export function createAssetNodeCommand(
  project: AssetCommandProject,
  input: CommandMeta & {
    node: AssetGraphNode
    resource: Resource
    asset?: AssetRecord
  },
): AssetCommandResult {
  const before = commandProjectSnapshot(project)
  const assetIds = unique([input.asset?.id, resourceAssetId(input.resource)])
  const nextProject: AssetCommandProject = {
    ...project,
    canvas: {
      ...project.canvas,
      nodes: [...project.canvas.nodes, input.node],
    },
    resources: {
      ...project.resources,
      [input.resource.id]: input.resource,
    },
    assets: input.asset
      ? {
          ...project.assets,
          [input.asset.id]: input.asset,
        }
      : project.assets,
  }

  return {
    project: nextProject,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'asset',
      label: 'Create asset',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        assetIds,
        resourceIds: [input.resource.id],
        nodeIds: [input.node.id],
      },
      preview: {
        title: 'Create asset',
        assetIds,
        resourceIds: [input.resource.id],
        nodeIds: [input.node.id],
      },
    }),
  }
}

export function deleteAssetNodesCommand(
  project: AssetCommandProject,
  input: CommandMeta & {
    nodeIds: string[]
  },
): AssetCommandResult {
  const before = commandProjectSnapshot(project)
  const nodeIdsToDelete = new Set(input.nodeIds)
  const nodesToDelete = project.canvas.nodes.filter((node) => nodeIdsToDelete.has(node.id))
  const resourceIds = unique(nodesToDelete.map(assetNodeResourceId))
  const resourceIdsToDelete = new Set(resourceIds)
  const assetIds = unique(resourceIds.map((resourceId) => resourceAssetId(project.resources[resourceId])))
  const assetIdsToDelete = new Set(assetIds)
  const nextResources = Object.fromEntries(
    Object.entries(project.resources).filter(([resourceId]) => !resourceIdsToDelete.has(resourceId)),
  )
  const nextAssets = Object.fromEntries(Object.entries(project.assets).filter(([assetId]) => !assetIdsToDelete.has(assetId)))
  const nextProject: AssetCommandProject = {
    ...project,
    canvas: {
      nodes: project.canvas.nodes.filter((node) => !nodeIdsToDelete.has(node.id)),
      edges: project.canvas.edges.filter(
        (edge) => !resourceIdsToDelete.has(edge.sourceResourceId) && !resourceIdsToDelete.has(edge.targetResourceId),
      ),
    },
    resources: nextResources,
    assets: nextAssets,
  }

  return {
    project: nextProject,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'asset',
      label: resourceIds.length > 1 ? 'Delete assets' : 'Delete asset',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        assetIds,
        resourceIds,
        nodeIds: input.nodeIds,
      },
      preview: {
        title: resourceIds.length > 1 ? 'Delete assets' : 'Delete asset',
        subtitle: `${resourceIds.length} ${resourceIds.length === 1 ? 'asset' : 'assets'}`,
        assetIds,
        resourceIds,
        nodeIds: input.nodeIds,
      },
    }),
  }
}

export function updateAssetResourceCommand(
  project: AssetCommandProject,
  input: CommandMeta & {
    resource: Resource
  },
): AssetCommandResult {
  const before = commandProjectSnapshot(project)
  const assetIds = unique([resourceAssetId(input.resource)])
  const nodeIds = assetNodeIdsForResources(project, [input.resource.id])
  const nextProject: AssetCommandProject = {
    ...project,
    resources: {
      ...project.resources,
      [input.resource.id]: input.resource,
    },
  }

  return {
    project: nextProject,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'asset',
      label: 'Update asset',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        assetIds,
        resourceIds: [input.resource.id],
        nodeIds,
      },
      preview: {
        title: 'Update asset',
        assetIds,
        resourceIds: [input.resource.id],
        nodeIds,
      },
    }),
  }
}

export function moveAssetNodesCommand(
  project: AssetCommandProject,
  input: CommandMeta & {
    positionsByNodeId: Record<string, AssetGraphPoint>
  },
): AssetCommandResult {
  const before = commandProjectSnapshot(project)
  const movedNodeIds = Object.keys(input.positionsByNodeId)
  const movedNodeSet = new Set(movedNodeIds)
  const nextNodes = project.canvas.nodes.map((node) =>
    movedNodeSet.has(node.id)
      ? {
          ...node,
          position: input.positionsByNodeId[node.id],
        }
      : node,
  )
  const resourceIds = unique(project.canvas.nodes.filter((node) => movedNodeSet.has(node.id)).map(assetNodeResourceId))
  const assetIds = unique(resourceIds.map((resourceId) => resourceAssetId(project.resources[resourceId])))
  const nextProject: AssetCommandProject = {
    ...project,
    canvas: {
      ...project.canvas,
      nodes: nextNodes,
    },
  }

  return {
    project: nextProject,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'canvas',
      label: movedNodeIds.length > 1 ? 'Move assets' : 'Move asset',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        assetIds,
        resourceIds,
        nodeIds: movedNodeIds,
      },
      preview: {
        title: movedNodeIds.length > 1 ? 'Move assets' : 'Move asset',
        subtitle: `${movedNodeIds.length} ${movedNodeIds.length === 1 ? 'asset' : 'assets'}`,
        assetIds,
        resourceIds,
        nodeIds: movedNodeIds,
      },
    }),
  }
}

export function resizeAssetNodeCommand(
  project: AssetCommandProject,
  input: CommandMeta & {
    nodeId: string
    size: { width: number; height: number }
  },
): AssetCommandResult {
  const before = commandProjectSnapshot(project)
  const targetNode = project.canvas.nodes.find((node) => node.id === input.nodeId)
  const resourceIds = unique([assetNodeResourceId(targetNode)])
  const assetIds = unique(resourceIds.map((resourceId) => resourceAssetId(project.resources[resourceId])))
  const nextProject: AssetCommandProject = {
    ...project,
    canvas: {
      ...project.canvas,
      nodes: project.canvas.nodes.map((node) =>
        node.id === input.nodeId
          ? {
              ...node,
              size: input.size,
            }
          : node,
      ),
    },
  }

  return {
    project: nextProject,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'canvas',
      label: 'Resize asset',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        assetIds,
        resourceIds,
        nodeIds: [input.nodeId],
      },
      preview: {
        title: 'Resize asset',
        assetIds,
        resourceIds,
        nodeIds: [input.nodeId],
      },
    }),
  }
}
