import type { ExecutionTask, ProjectState } from './types'

export type NodeRunHistoryItem = {
  taskId: string
  status: ExecutionTask['status']
  runLabel: string
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

export function getNodeRunHistory(project: ProjectState, selectedNodeId?: string): NodeRunHistoryItem[] {
  if (!selectedNodeId) return []

  const selectedNode = project.canvas.nodes.find((node) => node.id === selectedNodeId)
  if (!selectedNode) return []

  let tasks: ExecutionTask[] = []

  if (selectedNode.type === 'function') {
    tasks = Object.values(project.tasks).filter((task) => task.functionNodeId === selectedNode.id)
  }

  if (selectedNode.type === 'result_group' && typeof selectedNode.data.taskId === 'string') {
    const task = project.tasks[selectedNode.data.taskId]
    tasks = task ? [task] : []
  }

  if (selectedNode.type === 'resource' && typeof selectedNode.data.resourceId === 'string') {
    const resource = project.resources[selectedNode.data.resourceId]
    const taskId = resource?.source.taskId
    const task = taskId ? project.tasks[taskId] : undefined
    tasks = task ? [task] : []
  }

  return tasks.sort(sortTasks).map((task) => toHistoryItem(project, task))
}
