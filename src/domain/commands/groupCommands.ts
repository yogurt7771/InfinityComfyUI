import type { AssetGraphAssetNode, AssetGraphGroupNode, AssetGraphNode, AssetLineageEdge } from '../assetGraph'
import { createCommandTransaction } from './commandHistory'
import type { CommandTransaction } from './commandTypes'

export type GroupCommandProject = {
  canvas: {
    nodes: AssetGraphNode[]
    edges: AssetLineageEdge[]
  }
}

type GroupCommandResult = {
  project: GroupCommandProject
  transaction: CommandTransaction<GroupCommandProject> | undefined
}

type CommandMeta = {
  now: string
  transactionId: string
}

const DEFAULT_NODE_SIZE = { width: 180, height: 140 }
const GROUP_PADDING = 24

const assetResourceId = (node: AssetGraphNode | undefined) => (node?.type === 'asset' ? node.data.resourceId : undefined)

const unique = (items: Array<string | undefined>) => [...new Set(items.filter((item): item is string => Boolean(item)))]

const snapshot = (project: GroupCommandProject): GroupCommandProject => structuredClone(project)

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

const groupChildNodeIds = (node: AssetGraphNode | undefined) =>
  node?.type === 'group' ? node.data.childNodeIds.filter(Boolean) : []

export function groupAssetNodesCommand(
  project: GroupCommandProject,
  input: CommandMeta & {
    nodeIds: string[]
    groupId: string
    title?: string
    color?: string
  },
): GroupCommandResult {
  const selectedNodeIds = new Set(input.nodeIds)
  const childNodes = project.canvas.nodes.filter(
    (node): node is AssetGraphAssetNode => selectedNodeIds.has(node.id) && node.type === 'asset',
  )
  if (childNodes.length < 2) return { project, transaction: undefined }

  const before = snapshot(project)
  const bounds = groupBounds(childNodes)
  const childNodeIds = childNodes.map((node) => node.id)
  const groupNode: AssetGraphGroupNode = {
    id: input.groupId,
    type: 'group',
    position: bounds.position,
    size: bounds.size,
    data: {
      title: input.title?.trim() || 'Group',
      childNodeIds,
      color: input.color ?? '#14b8a6',
      collapsed: false,
    },
  }
  const nextProject: GroupCommandProject = {
    ...project,
    canvas: {
      ...project.canvas,
      nodes: [...project.canvas.nodes, groupNode],
    },
  }
  const resourceIds = unique(childNodes.map(assetResourceId))

  return {
    project: nextProject,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'group',
      label: 'Group assets',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        resourceIds,
        nodeIds: [input.groupId, ...childNodeIds],
        groupIds: [input.groupId],
      },
      preview: {
        title: 'Group assets',
        subtitle: `${childNodeIds.length} assets`,
        resourceIds,
        nodeIds: [input.groupId, ...childNodeIds],
        groupIds: [input.groupId],
      },
    }),
  }
}

export function ungroupAssetNodeCommand(
  project: GroupCommandProject,
  input: CommandMeta & {
    groupNodeId: string
  },
): GroupCommandResult {
  const groupNode = project.canvas.nodes.find((node) => node.id === input.groupNodeId && node.type === 'group')
  const childNodeIds = groupChildNodeIds(groupNode)
  if (!groupNode) return { project, transaction: undefined }

  const before = snapshot(project)
  const nextProject: GroupCommandProject = {
    ...project,
    canvas: {
      ...project.canvas,
      nodes: project.canvas.nodes.filter((node) => node.id !== input.groupNodeId),
    },
  }

  return {
    project: nextProject,
    transaction: createCommandTransaction({
      id: input.transactionId,
      type: 'group',
      label: 'Ungroup assets',
      createdAt: input.now,
      before,
      after: nextProject,
      affectedIds: {
        nodeIds: [input.groupNodeId, ...childNodeIds],
        groupIds: [input.groupNodeId],
      },
      preview: {
        title: 'Ungroup assets',
        subtitle: groupNode.data.title,
        nodeIds: [input.groupNodeId, ...childNodeIds],
        groupIds: [input.groupNodeId],
      },
    }),
  }
}
