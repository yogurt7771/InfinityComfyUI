import { withoutBuiltInProjectFunctions } from '../builtInFunctions'
import type { ProjectState } from '../types'

export type ProjectLibraryPackage = {
  currentProjectId: string
  projects: Record<string, ProjectState>
}

export type ProjectLibrarySource = {
  project: ProjectState
  projectLibrary: Record<string, ProjectState>
}

export type RestoredProjectLibrary = {
  activeProject: ProjectState
  projects: Record<string, ProjectState>
}

export function createPersistentProjectSnapshot(project: ProjectState): ProjectState {
  const baseProject = withoutBuiltInProjectFunctions(project)
  return {
    ...baseProject,
    comfy: {
      ...baseProject.comfy,
      endpoints: baseProject.comfy.endpoints.map(({ health, ...endpoint }) => endpoint),
    },
  }
}

export function createProjectLibrarySnapshot(source: ProjectLibrarySource): ProjectLibraryPackage {
  const projects = {
    ...source.projectLibrary,
    [source.project.project.id]: source.project,
  }

  return {
    currentProjectId: source.project.project.id,
    projects: Object.fromEntries(
      Object.entries(projects).map(([projectId, project]) => [projectId, createPersistentProjectSnapshot(project)]),
    ),
  }
}

export function restoreProjectLibrarySnapshot(
  payload: ProjectLibraryPackage | undefined,
  hydrateProject: (project: ProjectState) => ProjectState = (project) => project,
): RestoredProjectLibrary | undefined {
  const projectEntries = Object.entries(payload?.projects ?? {})
  if (projectEntries.length === 0) return undefined

  const projects = Object.fromEntries(
    projectEntries.map(([projectId, project]) => [projectId, hydrateProject(project)]),
  ) as Record<string, ProjectState>
  const activeProject = projects[payload?.currentProjectId ?? ''] ?? Object.values(projects)[0]
  if (!activeProject) return undefined

  return { activeProject, projects }
}

const sortedEntries = <T>(record: Record<string, T> | undefined) =>
  Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right))

const nodeRevision = (node: ProjectState['canvas']['nodes'][number]) => ({
  id: node.id,
  type: node.type,
  position: node.position,
  data: {
    resourceId: node.data.resourceId,
    title: node.data.title,
    childNodeIds: node.data.childNodeIds,
    width: node.data.width,
    height: node.data.height,
  },
})

const edgeRevision = (edge: ProjectState['canvas']['edges'][number]) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  type: edge.type,
})

const resourceRevision = (resource: ProjectState['resources'][string]) => {
  if (typeof resource.value !== 'object' || resource.value === null) {
    return {
      id: resource.id,
      type: resource.type,
      value: resource.value,
      source: resource.source,
    }
  }

  return {
    id: resource.id,
    type: resource.type,
    value: {
      ...resource.value,
      url: undefined,
      thumbnailUrl: undefined,
    },
    source: resource.source,
  }
}

const assetRevision = (asset: ProjectState['assets'][string]) => {
  const { blobUrl, ...metadata } = asset
  return metadata
}

const functionRevision = (fn: ProjectState['functions'][string]) => ({
  id: fn.id,
  name: fn.name,
  category: fn.category,
  provider: fn.workflow.format,
  inputCount: fn.inputs.length,
  outputCount: fn.outputs.length,
  updatedAt: fn.updatedAt,
})

const runRevision = (run: NonNullable<ProjectState['runs']>[string]) => ({
  id: run.id,
  functionId: run.functionId,
  status: run.status,
  taskIds: run.taskIds,
  updatedAt: run.updatedAt,
  completedAt: run.completedAt,
})

const taskRevision = (task: ProjectState['tasks'][string]) => ({
  id: task.id,
  functionId: task.functionId,
  functionNodeId: task.functionNodeId,
  status: task.status,
  endpointId: task.endpointId,
  outputRefs: task.outputRefs,
  updatedAt: task.updatedAt,
  completedAt: task.completedAt,
})

const templateRevision = (template: NonNullable<ProjectState['templates']>[string]) => ({
  id: template.id,
  name: template.name,
  nodeCount: template.nodes.length,
  edgeCount: template.edges.length,
  resourceCount: Object.keys(template.resources).length,
  assetCount: Object.keys(template.assets).length,
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
})

const endpointRevision = (endpoint: ProjectState['comfy']['endpoints'][number]) => {
  const { health, ...persistentEndpoint } = endpoint
  return persistentEndpoint
}

const projectRevision = (project: ProjectState) => ({
  project: project.project,
  canvas: {
    nodes: project.canvas.nodes.map(nodeRevision),
    edges: project.canvas.edges.map(edgeRevision),
  },
  resources: sortedEntries(project.resources).map(([, resource]) => resourceRevision(resource)),
  assets: sortedEntries(project.assets).map(([, asset]) => assetRevision(asset)),
  functions: sortedEntries(project.functions).map(([, fn]) => functionRevision(fn)),
  runs: sortedEntries(project.runs).map(([, run]) => runRevision(run)),
  tasks: sortedEntries(project.tasks).map(([, task]) => taskRevision(task)),
  history: {
    undoCount: project.history?.undoStack.length ?? 0,
    redoCount: project.history?.redoStack.length ?? 0,
    undoHead: project.history?.undoStack.at(-1)?.id,
    redoHead: project.history?.redoStack.at(-1)?.id,
  },
  templates: sortedEntries(project.templates).map(([, template]) => templateRevision(template)),
  comfy: {
    endpoints: project.comfy.endpoints.map(endpointRevision),
    scheduler: project.comfy.scheduler,
  },
})

export function createProjectLibraryRevisionKey(source: ProjectLibrarySource): string {
  const projects = {
    ...source.projectLibrary,
    [source.project.project.id]: source.project,
  }
  const projectRevisions = Object.keys(projects)
    .sort()
    .map((projectId) => projectRevision(projects[projectId]!))

  return JSON.stringify({
    currentProjectId: source.project.project.id,
    projects: projectRevisions,
  })
}
