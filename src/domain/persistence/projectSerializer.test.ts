import { describe, expect, it } from 'vitest'
import { createOpenAIImageFunction } from '../openaiImage'
import type { ProjectState } from '../types'
import {
  createPersistentProjectSnapshot,
  createProjectLibraryRevisionKey,
  createProjectLibrarySnapshot,
  restoreProjectLibrarySnapshot,
} from './projectSerializer'

const baseProject = (id = 'project_1'): ProjectState => ({
  schemaVersion: '1.0.0',
  project: {
    id,
    name: 'Project',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
  },
  canvas: {
    nodes: [{ id: 'node_res_1', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'res_1' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resources: {
    res_1: { id: 'res_1', type: 'text', value: 'hello', source: { kind: 'manual_input' } },
  },
  assets: {},
  functions: {},
  runs: {},
  tasks: {},
  history: { schemaVersion: '1.0.0', undoStack: [], redoStack: [] },
  templates: {},
  comfy: {
    endpoints: [
      {
        id: 'endpoint_1',
        name: 'Local',
        baseUrl: 'http://127.0.0.1:27707',
        enabled: true,
        maxConcurrentJobs: 1,
        priority: 1,
        timeoutMs: 600000,
        auth: { type: 'none' },
        health: { status: 'online', lastCheckedAt: '2026-05-08T01:00:00.000Z' },
      },
    ],
    scheduler: { strategy: 'least_busy', retry: { maxAttempts: 1, fallbackToOtherEndpoint: true } },
  },
})

describe('project persistence serializer', () => {
  it('removes built-in functions and endpoint health from persisted project snapshots', () => {
    const builtIn = createOpenAIImageFunction('2026-05-08T00:00:00.000Z')
    const project: ProjectState = {
      ...baseProject(),
      functions: {
        [builtIn.id]: builtIn,
        fn_custom: {
          id: 'fn_custom',
          name: 'Custom',
          category: 'Render',
          workflow: { format: 'comfyui_api_json', rawJson: {} },
          inputs: [],
          outputs: [],
          createdAt: '2026-05-08T00:00:00.000Z',
          updatedAt: '2026-05-08T00:00:00.000Z',
        },
      },
    }

    const snapshot = createPersistentProjectSnapshot(project)

    expect(snapshot.functions).toEqual({ fn_custom: project.functions.fn_custom })
    expect(snapshot.comfy.endpoints[0]).not.toHaveProperty('health')
  })

  it('serializes the active project into the library snapshot', () => {
    const active = baseProject('active_project')
    const old = baseProject('old_project')

    const snapshot = createProjectLibrarySnapshot({
      project: active,
      projectLibrary: { [old.project.id]: old },
    })

    expect(snapshot.currentProjectId).toBe(active.project.id)
    expect(snapshot.projects[active.project.id]).toMatchObject({ project: { name: 'Project' } })
    expect(snapshot.projects[old.project.id]).toMatchObject({ project: { id: old.project.id } })
  })

  it('restores a saved library and hydrates each project exactly once', () => {
    const active = baseProject('active_project')
    const old = baseProject('old_project')
    const seenProjectIds: string[] = []

    const restored = restoreProjectLibrarySnapshot(
      {
        currentProjectId: active.project.id,
        projects: {
          [active.project.id]: active,
          [old.project.id]: old,
        },
      },
      (project) => {
        seenProjectIds.push(project.project.id)
        return { ...project, project: { ...project.project, name: `${project.project.name} hydrated` } }
      },
    )

    expect(seenProjectIds.sort()).toEqual([active.project.id, old.project.id].sort())
    expect(restored?.activeProject.project.id).toBe(active.project.id)
    expect(restored?.activeProject.project.name).toBe('Project hydrated')
  })

  it('uses project revision data instead of UI selection state for persistence keys', () => {
    const project = baseProject()
    const key = createProjectLibraryRevisionKey({ project, projectLibrary: {} })

    const sameProjectWithUiSelection = createProjectLibraryRevisionKey({
      project,
      projectLibrary: {},
    })
    const editedProject = createProjectLibraryRevisionKey({
      project: {
        ...project,
        project: { ...project.project, updatedAt: '2026-05-08T00:00:01.000Z' },
      },
      projectLibrary: {},
    })

    expect(sameProjectWithUiSelection).toBe(key)
    expect(editedProject).not.toBe(key)
  })
})
