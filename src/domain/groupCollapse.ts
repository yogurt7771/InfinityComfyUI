import type { Edge } from '@xyflow/react'
import type { CanvasNode } from './types'

/** One end of a boundary edge that lives on the other side of the collapsed group's border. */
export type GroupPortLink = { nodeId: string; label?: string }

export type GroupPort = {
  /** Handle id on the collapsed group node; boundary edges attach to it. */
  handleId: string
  direction: 'input' | 'output'
  /** The node that owns the resource flowing through the port (external for inputs, a member for outputs). */
  sourceNodeId: string
  sourceHandle?: string
  /** Resource carried by the port, when the source handle names one (`resource:<id>`). */
  resourceId?: string
  /** Members on the inside of the border, with the input they use (inputs) or empty labels (outputs). */
  members: GroupPortLink[]
  /** Nodes on the outside of the border. */
  outside: GroupPortLink[]
}

export type CollapsedGroupView = {
  /** member node id → collapsed group node id that hides it */
  hiddenBy: Map<string, string>
  portsByGroupId: Map<string, { inputs: GroupPort[]; outputs: GroupPort[] }>
  edges: Edge[]
}

export const isCollapsedGroupNode = (node: Pick<CanvasNode, 'type' | 'data'>) =>
  node.type === 'group' && node.data.collapsed === true

const childIdsOf = (node: CanvasNode) =>
  Array.isArray(node.data.childNodeIds)
    ? node.data.childNodeIds.filter((id): id is string => typeof id === 'string')
    : []

const resourceIdOfHandle = (handle?: string | null) =>
  handle?.startsWith('resource:') ? handle.slice('resource:'.length) : undefined

const pushUnique = (links: GroupPortLink[], link: GroupPortLink) => {
  if (!links.some((item) => item.nodeId === link.nodeId && item.label === link.label)) links.push(link)
}

/**
 * Collapsing a group is view state only: its members are hidden, edges between members disappear, and edges that
 * cross the border are re-attached to ports on the group node. Inputs merge by external source (one outside
 * resource feeding several members is one port); outputs are one per member source handle.
 */
export function collapseGroupEdges(edges: Edge[], nodes: CanvasNode[]): CollapsedGroupView {
  const hiddenBy = new Map<string, string>()
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const node of nodes) {
    if (!isCollapsedGroupNode(node)) continue
    for (const childId of childIdsOf(node)) {
      if (nodeIds.has(childId) && !hiddenBy.has(childId)) hiddenBy.set(childId, node.id)
    }
  }
  const portsByGroupId = new Map<string, { inputs: GroupPort[]; outputs: GroupPort[] }>()
  if (hiddenBy.size === 0) return { hiddenBy, portsByGroupId, edges }

  const portsOf = (groupId: string) => {
    let ports = portsByGroupId.get(groupId)
    if (!ports) {
      ports = { inputs: [], outputs: [] }
      portsByGroupId.set(groupId, ports)
    }
    return ports
  }
  const label = (edge: Edge) => (typeof edge.label === 'string' ? edge.label : undefined)

  const remapped: Edge[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    const sourceGroup = hiddenBy.get(edge.source)
    const targetGroup = hiddenBy.get(edge.target)
    if (!sourceGroup && !targetGroup) {
      remapped.push(edge)
      continue
    }
    if (sourceGroup && sourceGroup === targetGroup) continue

    let source = edge.source
    let sourceHandle = edge.sourceHandle ?? undefined
    if (sourceGroup) {
      const handleId = edge.sourceHandle ?? `group-out:${edge.source}`
      const outputs = portsOf(sourceGroup).outputs
      let port = outputs.find((item) => item.handleId === handleId)
      if (!port) {
        port = {
          handleId,
          direction: 'output',
          sourceNodeId: edge.source,
          sourceHandle: edge.sourceHandle ?? undefined,
          resourceId: resourceIdOfHandle(edge.sourceHandle),
          members: [{ nodeId: edge.source }],
          outside: [],
        }
        outputs.push(port)
      }
      pushUnique(port.outside, { nodeId: targetGroup ?? edge.target, label: targetGroup ? undefined : label(edge) })
      source = sourceGroup
      sourceHandle = handleId
    }

    let target = edge.target
    let targetHandle = edge.targetHandle ?? undefined
    if (targetGroup) {
      const handleId = `group-in:${edge.source}:${edge.sourceHandle ?? ''}`
      const inputs = portsOf(targetGroup).inputs
      let port = inputs.find((item) => item.handleId === handleId)
      if (!port) {
        port = {
          handleId,
          direction: 'input',
          sourceNodeId: edge.source,
          sourceHandle: edge.sourceHandle ?? undefined,
          resourceId: resourceIdOfHandle(edge.sourceHandle),
          members: [],
          outside: [{ nodeId: sourceGroup ?? edge.source }],
        }
        inputs.push(port)
      }
      pushUnique(port.members, { nodeId: edge.target, label: label(edge) })
      target = targetGroup
      targetHandle = handleId
    }

    const key = `${source}\u0000${sourceHandle ?? ''}\u0000${target}\u0000${targetHandle ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    remapped.push({
      ...edge,
      id: targetGroup || sourceGroup ? `collapsed:${edge.id}` : edge.id,
      source,
      sourceHandle,
      target,
      targetHandle,
      label: targetGroup ? undefined : edge.label,
    })
  }

  // Ports read top-to-bottom in the same order as the nodes they come from, so wires do not cross needlessly.
  const positionById = new Map(nodes.map((node) => [node.id, node.position]))
  const byPosition = (left: GroupPort, right: GroupPort) => {
    const a = positionById.get(left.sourceNodeId) ?? { x: 0, y: 0 }
    const b = positionById.get(right.sourceNodeId) ?? { x: 0, y: 0 }
    return a.y - b.y || a.x - b.x || left.handleId.localeCompare(right.handleId)
  }
  for (const ports of portsByGroupId.values()) {
    ports.inputs.sort(byPosition)
    ports.outputs.sort(byPosition)
  }

  return { hiddenBy, portsByGroupId, edges: remapped }
}

/** What a collapsed group shows for one port: the resource on it and where it goes on the other side. */
export type GroupPortView = {
  handleId: string
  direction: 'input' | 'output'
  resourceId?: string
  title: string
  detail: string
}

export function describeGroupPorts(ports: GroupPort[], titleOf: (nodeId: string) => string): GroupPortView[] {
  const linkText = (links: GroupPortLink[]) =>
    links.map((link) => (link.label ? `${titleOf(link.nodeId)} · ${link.label}` : titleOf(link.nodeId))).join(', ')
  return ports.map((port) => ({
    handleId: port.handleId,
    direction: port.direction,
    resourceId: port.resourceId,
    // Inputs name the outside resource and the members (and their inputs) it feeds; outputs name the member it leaves.
    title: titleOf(port.sourceNodeId),
    detail: port.direction === 'input' ? `→ ${linkText(port.members)}` : port.outside.length ? `→ ${linkText(port.outside)}` : '',
  }))
}
