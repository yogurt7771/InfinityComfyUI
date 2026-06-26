import type { ExecutionTask, ProjectState } from './types'

export type NodeRunHistoryItem = {
  taskId: string
  status: ExecutionTask['status']
  runLabel: string
  endpointId?: string
  endpointName?: string
  comfyPromptId?: string
  resultNodeId?: string
  historyPath?: string
  historyUrl?: string
  errorMessage?: string
}

const resultNodeIdForTask = (project: ProjectState, taskId: string) =>
  project.canvas.nodes.find((node) => node.type === 'result_group' && node.data.taskId === taskId)?.id

const toHistoryItem = (project: ProjectState, task: ExecutionTask): NodeRunHistoryItem => {
  const endpoint = project.comfy.endpoints.find((item) => item.id === task.endpointId)
  const historyPath = task.comfyPromptId ? `/history/${task.comfyPromptId}` : undefined

  return {
    taskId: task.id,
    status: task.status,
    runLabel: `Run ${task.runIndex}/${task.runTotal}`,
    endpointId: task.endpointId,
    endpointName: endpoint?.name ?? task.endpointId,
    comfyPromptId: task.comfyPromptId,
    resultNodeId: resultNodeIdForTask(project, task.id),
    historyPath,
    historyUrl: endpoint && historyPath ? `${endpoint.baseUrl.replace(/\/+$/, '')}${historyPath}` : undefined,
    errorMessage: task.error?.message,
  }
}

const sortTasks = (left: ExecutionTask, right: ExecutionTask) => {
  if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt)
  if (left.runIndex !== right.runIndex) return left.runIndex - right.runIndex
  return left.id.localeCompare(right.id)
}

const sortTasksNewest = (left: ExecutionTask, right: ExecutionTask) => {
  const created = right.createdAt.localeCompare(left.createdAt)
  if (created !== 0) return created
  if (left.runIndex !== right.runIndex) return right.runIndex - left.runIndex
  return right.id.localeCompare(left.id)
}

const tasksForNode = (project: ProjectState, selectedNodeId?: string): ExecutionTask[] => {
  if (!selectedNodeId) return []

  const selectedNode = project.canvas.nodes.find((node) => node.id === selectedNodeId)
  if (!selectedNode) return []

  if (selectedNode.type === 'function') {
    return Object.values(project.tasks).filter((task) => task.functionNodeId === selectedNode.id)
  }

  if (selectedNode.type === 'result_group' && typeof selectedNode.data.taskId === 'string') {
    const task = project.tasks[selectedNode.data.taskId]
    return task ? [task] : []
  }

  if (selectedNode.type === 'resource' && typeof selectedNode.data.resourceId === 'string') {
    const resource = project.resources[selectedNode.data.resourceId]
    const taskId = resource?.source.taskId
    const task = taskId ? project.tasks[taskId] : undefined
    return task ? [task] : []
  }

  return []
}

export function getNodeRunHistory(project: ProjectState, selectedNodeId?: string): NodeRunHistoryItem[] {
  return tasksForNode(project, selectedNodeId)
    .sort(sortTasks)
    .map((task) => toHistoryItem(project, task))
}

export function getSelectedNodesRunHistory(project: ProjectState, selectedNodeIds: string[]): NodeRunHistoryItem[] {
  const taskMap = new Map<string, ExecutionTask>()
  selectedNodeIds.forEach((nodeId) => {
    tasksForNode(project, nodeId).forEach((task) => taskMap.set(task.id, task))
  })
  return Array.from(taskMap.values())
    .sort(sortTasksNewest)
    .map((task) => toHistoryItem(project, task))
}

export function getProjectRunHistory(project: ProjectState): NodeRunHistoryItem[] {
  return Object.values(project.tasks)
    .sort(sortTasksNewest)
    .map((task) => toHistoryItem(project, task))
}
