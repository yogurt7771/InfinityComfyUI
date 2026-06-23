import type { AssetGraphAssetNode, AssetGraphGroupNode, AssetGraphNode, AssetLineageEdge } from '../assetGraph'
import type { AssetRecord, Resource } from '../types'
import { createCommandTransaction } from './commandHistory'
import type { CommandTransaction } from './commandTypes'

export type AssetGraphTemplate = {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  nodes: AssetGraphNode[]
  edges: AssetLineageEdge[]
  resources: Record<string, Resource>
  assets: Record<string, AssetRecord>
  inputResourceIds: string[]
  outputResourceIds: string[]
}

export type TemplateCommandProject = {
  canvas: {
    nodes: AssetGraphNode[]
    edges: AssetLineageEdge[]
  }
  resources: Record<string, Resource>
  assets: Record<string, AssetRecord>
  templates: Record<string, AssetGraphTemplate>
}

type TemplateCommandResult = {
  project: TemplateCommandProject
  transaction: CommandTransaction<TemplateCommandProject> | undefined
}

type InstantiateTemplateResult = TemplateCommandResult & {
  groupNodeId?: string
}

type CommandMeta = {
  now: string
  transactionId: string
}

const DEFAULT_NODE_SIZE = { width: 180, height: 140 }
const GROUP_PADDING = 24

const snapshot = (project: TemplateCommandProject): TemplateCommandProject => structuredClone(project)

const unique = (items: Array<string | undefined>) => [...new Set(items.filter((item): item is string => Boolean(item)))]

const mediaAssetId = (resource: Resource | undefined) => {
  const value = resource?.value
  return typeof value === 'object' && value !== null && 'assetId' in value && typeof value.assetId === 'string'
    ? value.assetId
    : undefined
}

const assetNodeResourceId = (node: AssetGraphNode | undefined) => (node?.type === 'asset' ? node.data.resourceId : undefined)

const selectedAssetNodes = (project: TemplateCommandProject, nodeIds: string[]) => {
  const selectedNodeIds = new Set(nodeIds)
  return project.canvas.nodes.filter(
    (node): node is AssetGraphAssetNode => selectedNodeIds.has(node.id) && node.type === 'asset',
  )
}

const nodeSize = (node: AssetGraphNode) => node.size ?? DEFAULT_NODE_SIZE

const groupBounds = (nodes: AssetGraphNode[]) => {
  const minX = Math.min(...nodes.map((node) => node.position.x))
  const minY = Math.min(...nodes.map((node) => node.position.y))
  const maxX = Math.max(...nodes.map((node) => node.position.x + nodeSize(node).width))
  const maxY = Math.max(...nodes.map((node) => node.position.y + nodeSize(node).height))
  return {
    position: { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING },
    size: {
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2,
    },
  }
}

export function saveAssetTemplateCommand(
  project: TemplateCommandProject,
  input: CommandMeta & {
    nodeIds: string[]
    templateId: string
    name?: string
  },
): TemplateCommandResult {
  const nodes = selectedAssetNodes(project, input.nodeIds).map((node) => structuredClone(node))
  if (nodes.length === 0) return { project, transaction: undefined }

  const resourceIds = unique(nodes.map(assetNodeResourceId))
  const resourceIdSet = new Set(resourceIds)
  const edges = project.canvas.edges
    .filter((edge) => resourceIdSet.has(edge.sourceResourceId) && resourceIdSet.has(edge.targetResourceId))
    .map((edge) => structuredClone(edge))
  const resources = Object.fromEntries(
    resourceIds
      .map((resourceId) => project.resources[resourceId])
      .filter((resource): resource is Resource => Boolean(resource))
      .map((resource) => [resource.id, structuredClone(resource)]),
  )
  const assetIds = unique(Object.values(resources).map(mediaAssetId))
  const assets = Object.fromEntries(
    assetIds
      .map((assetId) => project.assets[assetId])
      .filter((asset): asset is AssetRecord => Boolean(asset))
      .map((asset) => [asset.id, structuredClone(asset)]),
  )
  const template: AssetGraphTemplate = {
    id: input.templateId,
    name: input.name?.trim() || 'Template',
    createdAt: input.now,
    updatedAt: input.now,
    nodes,
    edges,
    resources,
    assets,
    inputResourceIds: resourceIds,
    outputResourceIds: resourceIds,
  }
  const before = snapshot(project)
  const nextProject: TemplateCommandProject = {
    ...project,
    templates: {
      ...project.templates,
      [input.templateId]: template,
    },
  }

  return {
    project: nextProject,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'template',
      label: 'Save template',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        templateIds: [input.templateId],
        resourceIds,
        nodeIds: nodes.map((node) => node.id),
      },
      preview: {
        title: 'Save template',
        subtitle: template.name,
        templateIds: [input.templateId],
        resourceIds,
        nodeIds: nodes.map((node) => node.id),
      },
    }),
  }
}

export function instantiateAssetTemplateCommand(
  project: TemplateCommandProject,
  input: CommandMeta & {
    templateId: string
    position?: { x: number; y: number }
    idFactory: () => string
  },
): InstantiateTemplateResult {
  const template = project.templates[input.templateId]
  if (!template || template.nodes.length === 0) return { project, transaction: undefined }

  const minX = Math.min(...template.nodes.map((node) => node.position.x))
  const minY = Math.min(...template.nodes.map((node) => node.position.y))
  const targetPosition = input.position ?? { x: minX + 48, y: minY + 48 }
  const offset = { x: targetPosition.x - minX, y: targetPosition.y - minY }
  const resourceIdMap = new Map<string, string>()
  const clonedResources: Record<string, Resource> = {}
  const clonedAssets: Record<string, AssetRecord> = {}

  for (const resource of Object.values(template.resources)) {
    const nextResourceId = input.idFactory()
    resourceIdMap.set(resource.id, nextResourceId)
    const value = structuredClone(resource.value)
    const originalAssetId = mediaAssetId(resource)
    if (originalAssetId && typeof value === 'object' && value !== null && 'assetId' in value) {
      const nextAssetId = input.idFactory()
      ;(value as { assetId: string }).assetId = nextAssetId
      const sourceAsset = template.assets[originalAssetId]
      if (sourceAsset) clonedAssets[nextAssetId] = { ...structuredClone(sourceAsset), id: nextAssetId, createdAt: input.now }
    }
    clonedResources[nextResourceId] = {
      ...structuredClone(resource),
      id: nextResourceId,
      name: `${resource.name ?? 'Resource'} Copy`,
      value,
      source: { kind: 'duplicated', parentResourceId: resource.id },
      metadata: { ...resource.metadata, createdAt: input.now },
    }
  }

  const clonedNodes = template.nodes.flatMap((node): AssetGraphAssetNode[] => {
    if (node.type !== 'asset') return []
    const nextResourceId = resourceIdMap.get(node.data.resourceId)
    if (!nextResourceId) return []
    return [
      {
        ...structuredClone(node),
        id: `node_${nextResourceId}`,
        position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
        data: { ...node.data, resourceId: nextResourceId },
      },
    ]
  })
  const clonedEdges = template.edges.flatMap((edge): AssetLineageEdge[] => {
    const sourceResourceId = resourceIdMap.get(edge.sourceResourceId)
    const targetResourceId = resourceIdMap.get(edge.targetResourceId)
    if (!sourceResourceId || !targetResourceId) return []
    return [
      {
        ...structuredClone(edge),
        id: `lineage:${edge.runId}:${edge.inputKey}:${sourceResourceId}:${targetResourceId}`,
        sourceResourceId,
        targetResourceId,
      },
    ]
  })
  const groupNodeId = input.idFactory()
  const bounds = groupBounds(clonedNodes)
  const childNodeIds = clonedNodes.map((node) => node.id)
  const groupNode: AssetGraphGroupNode = {
    id: groupNodeId,
    type: 'group',
    position: bounds.position,
    size: bounds.size,
    data: {
      title: template.name,
      childNodeIds,
      color: '#14b8a6',
      collapsed: false,
    },
  }
  const before = snapshot(project)
  const nextProject: TemplateCommandProject = {
    ...project,
    resources: { ...project.resources, ...clonedResources },
    assets: { ...project.assets, ...clonedAssets },
    canvas: {
      nodes: [...project.canvas.nodes, ...clonedNodes, groupNode],
      edges: [...project.canvas.edges, ...clonedEdges],
    },
  }
  const resourceIds = Object.keys(clonedResources)

  return {
    project: nextProject,
    groupNodeId,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'template',
      label: 'Create template instance',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        templateIds: [input.templateId],
        resourceIds,
        nodeIds: [groupNodeId, ...childNodeIds],
        groupIds: [groupNodeId],
      },
      preview: {
        title: 'Create template instance',
        subtitle: template.name,
        templateIds: [input.templateId],
        resourceIds,
        nodeIds: [groupNodeId, ...childNodeIds],
        groupIds: [groupNodeId],
      },
    }),
  }
}
