import type { Node } from '@xyflow/react'
import type { NodeReferenceSummary } from '../domain/nodeReferences'
import type { CanvasNode, ProjectState, Resource } from '../domain/types'

type RenderLookupProject = Pick<ProjectState, 'resources' | 'tasks' | 'functions'>

export type FlowNodeRenderIndex = {
  outputsByFunctionNodeId: Map<string, Resource[]>
  outputsByWorkflowFunctionId: Map<string, Resource[]>
}

// Node data carries the project-wide lookup maps, so any project change used to give every node new props.
// These keys are compared through `renderDependencies` (the entries a node actually reads) instead.
const PROJECT_LOOKUP_DATA_KEYS = new Set(['resourcesById', 'tasksById', 'functionsById', 'nodeReferences', 'renderDependencies'])

const pushGroup = (map: Map<string, Resource[]>, key: string | undefined, resource: Resource) => {
  if (!key) return
  const group = map.get(key)
  if (group) group.push(resource)
  else map.set(key, [resource])
}

export function buildFlowNodeRenderIndex(resources: Record<string, Resource>): FlowNodeRenderIndex {
  const outputsByFunctionNodeId = new Map<string, Resource[]>()
  const outputsByWorkflowFunctionId = new Map<string, Resource[]>()
  for (const resource of Object.values(resources)) {
    if (resource.source.kind !== 'function_output') continue
    pushGroup(outputsByFunctionNodeId, resource.source.functionNodeId, resource)
    pushGroup(outputsByWorkflowFunctionId, resource.metadata?.workflowFunctionId, resource)
  }
  return { outputsByFunctionNodeId, outputsByWorkflowFunctionId }
}

const stringField = (value: unknown) => (typeof value === 'string' ? value : undefined)

const resourceRefIds = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === 'object' && item !== null && typeof (item as { resourceId?: unknown }).resourceId === 'string'
          ? [(item as { resourceId: string }).resourceId]
          : [],
      )
    : []

const connectedInputResourceIds = (inputValues: unknown) =>
  typeof inputValues === 'object' && inputValues !== null ? resourceRefIds(Object.values(inputValues)) : []

/**
 * The project entries a node view reads from `resourcesById`, `tasksById`, `functionsById` and its
 * reference list. Two renders with element-wise identical dependencies produce the same output.
 */
export function flowNodeRenderDependencies(
  node: CanvasNode,
  project: RenderLookupProject,
  references: NodeReferenceSummary[],
  index: FlowNodeRenderIndex,
): unknown[] {
  const dependencies: unknown[] = []
  for (const reference of references) {
    dependencies.push(
      reference.nodeId,
      reference.title,
      reference.type,
      reference.direction,
      reference.resourceId,
      reference.resourceId ? project.resources[reference.resourceId] : undefined,
    )
  }

  const pushOutputs = (functionNodeId: string | undefined, workflowFunctionIds: Array<string | undefined>) => {
    const outputs = functionNodeId ? index.outputsByFunctionNodeId.get(functionNodeId) ?? [] : []
    dependencies.push(outputs.length, ...outputs)
    for (const workflowFunctionId of new Set([...workflowFunctionIds, ...outputs.map((output) => output.metadata?.workflowFunctionId)])) {
      const siblings = workflowFunctionId ? index.outputsByWorkflowFunctionId.get(workflowFunctionId) ?? [] : []
      dependencies.push(workflowFunctionId, siblings.length, ...siblings)
    }
  }

  const data = node.data
  if (node.type === 'resource') {
    const resourceId = stringField(data.resourceId)
    const resource = resourceId ? project.resources[resourceId] : undefined
    const taskId = resource?.source.taskId ?? stringField(data.taskId)
    const task = taskId ? project.tasks[taskId] : undefined
    const functionId = task?.functionId ?? resource?.metadata?.workflowFunctionId
    dependencies.push(resource, task, functionId ? project.functions[functionId] : undefined)
  } else if (node.type === 'function') {
    const functionId = stringField(data.functionId)
    dependencies.push(functionId ? project.functions[functionId] : undefined)
    for (const resourceId of connectedInputResourceIds(data.inputValues)) dependencies.push(project.resources[resourceId])
    pushOutputs(node.id, [functionId])
  } else if (node.type === 'result_group') {
    const functionId = stringField(data.functionId)
    const taskId = stringField(data.taskId)
    const resources = resourceRefIds(data.resources).map((resourceId) => project.resources[resourceId])
    dependencies.push(functionId ? project.functions[functionId] : undefined, taskId ? project.tasks[taskId] : undefined, ...resources)
    pushOutputs(stringField(data.sourceFunctionNodeId), [functionId, ...resources.map((resource) => resource?.metadata?.workflowFunctionId)])
  }
  return dependencies
}

const sameItems = (left: unknown, right: unknown) => {
  if (left === right) return true
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  return left.every((item, index) => Object.is(item, right[index]))
}

export function sameFlowNodeData(left: Node['data'], right: Node['data']) {
  if (left === right) return true
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  for (const key of leftKeys) {
    if (!(key in right)) return false
    if (PROJECT_LOOKUP_DATA_KEYS.has(key)) continue
    if (!Object.is(left[key], right[key])) return false
  }
  return sameItems(left.renderDependencies, right.renderDependencies)
}

const sameShallowRecord = (left: object | undefined, right: object | undefined) => {
  if (left === right) return true
  if (!left || !right) return false
  const leftEntries = Object.entries(left)
  if (leftEntries.length !== Object.keys(right).length) return false
  return leftEntries.every(([key, value]) => Object.is(value, (right as Record<string, unknown>)[key]))
}

/**
 * Merges freshly built flow nodes into React Flow's current nodes. Unchanged nodes keep their previous
 * object, so React Flow skips them entirely; nodes whose data did not change keep React Flow's measured
 * size, so they are not hidden and re-measured. Returns `previous` itself when nothing changed.
 */
export function stabilizeFlowNodes(previous: Node[], next: Node[]) {
  if (previous.length === 0 || next.length === 0) return next
  const previousById = new Map(previous.map((node) => [node.id, node]))
  let changed = previous.length !== next.length
  const stabilized = next.map((node, index) => {
    const prior = previousById.get(node.id)
    if (!prior) {
      changed = true
      return node
    }
    const dataUnchanged = sameFlowNodeData(prior.data, node.data)
    const position = prior.dragging ? prior.position : node.position
    if (
      dataUnchanged &&
      prior.type === node.type &&
      prior.position.x === position.x &&
      prior.position.y === position.y &&
      Boolean(prior.selected) === Boolean(node.selected) &&
      prior.zIndex === node.zIndex &&
      prior.className === node.className &&
      sameShallowRecord(prior.style, node.style) &&
      sameShallowRecord(prior.domAttributes, node.domAttributes)
    ) {
      if (previous[index] !== prior) changed = true
      return prior
    }
    changed = true
    if (!dataUnchanged) return { ...node, position }
    return { ...node, position, data: prior.data, measured: prior.measured, dragging: prior.dragging }
  })
  return changed ? stabilized : previous
}
