import type { CanvasNode, ProjectState } from './types'

export type NodeReferenceSummary = {
  nodeId: string
  title: string
  type: CanvasNode['type']
  direction: 'incoming' | 'outgoing'
}

const nodeDisplayTitle = (project: ProjectState, node: CanvasNode) => {
  if (typeof node.data.title === 'string' && node.data.title.trim()) return node.data.title
  if (node.type === 'resource' && typeof node.data.resourceId === 'string') {
    return project.resources[node.data.resourceId]?.name ?? node.data.resourceId
  }
  if (node.type === 'function' && typeof node.data.functionId === 'string') {
    return project.functions[node.data.functionId]?.name ?? node.data.functionId
  }
  if (node.type === 'result_group') {
    if (typeof node.data.runIndex === 'number') return `Run ${node.data.runIndex}`
    return 'Run'
  }
  if (node.type === 'group') return 'Group'
  return 'Node'
}

export function buildNodeReferenceMap(project: ProjectState) {
  const nodesById = new Map(project.canvas.nodes.map((node) => [node.id, node]))
  const references: Record<string, NodeReferenceSummary[]> = Object.fromEntries(
    project.canvas.nodes.map((node) => [node.id, []]),
  )

  for (const edge of project.canvas.edges) {
    const sourceNode = nodesById.get(edge.source.nodeId)
    const targetNode = nodesById.get(edge.target.nodeId)
    if (!sourceNode || !targetNode) continue

    references[sourceNode.id]?.push({
      nodeId: targetNode.id,
      title: nodeDisplayTitle(project, targetNode),
      type: targetNode.type,
      direction: 'outgoing',
    })
    references[targetNode.id]?.push({
      nodeId: sourceNode.id,
      title: nodeDisplayTitle(project, sourceNode),
      type: sourceNode.type,
      direction: 'incoming',
    })
  }

  return references
}
