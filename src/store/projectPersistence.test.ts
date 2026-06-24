import { afterEach, describe, expect, it, vi } from 'vitest'

describe('desktop project persistence', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    Reflect.deleteProperty(window, 'infinityComfyUIStorage')
  })

  it('loads through the Electron bridge and saves the active project library after 5 idle seconds', async () => {
    vi.useFakeTimers()
    const loadProjectLibrary = vi.fn().mockResolvedValue(undefined)
    const saveProjectLibrary = vi.fn().mockResolvedValue({ ok: true, rootPath: 'C:/Infinity/projects' })

    Object.defineProperty(window, 'infinityComfyUIStorage', {
      configurable: true,
      value: {
        loadProjectLibrary,
        saveProjectLibrary,
      },
    })

    const { projectStore } = await import('./projectStore')
    await Promise.resolve()
    await Promise.resolve()

    expect(loadProjectLibrary).toHaveBeenCalledTimes(1)

    projectStore.getState().updateProjectMetadata({ name: 'Desktop Saved Project' })
    await vi.advanceTimersByTimeAsync(4999)

    expect(saveProjectLibrary).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    const savedLibrary = saveProjectLibrary.mock.calls.at(-1)?.[0]
    expect(savedLibrary).toMatchObject({
      currentProjectId: projectStore.getState().project.project.id,
    })
    expect(savedLibrary.projects[savedLibrary.currentProjectId].project.name).toBe('Desktop Saved Project')
  })

  it('saves edits made before startup loading finishes when no saved library exists', async () => {
    vi.useFakeTimers()
    let resolveLoad: (value: unknown) => void = () => undefined
    const loadProjectLibrary = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve
        }),
    )
    const saveProjectLibrary = vi.fn().mockResolvedValue({ ok: true, rootPath: 'C:/Infinity/projects' })

    Object.defineProperty(window, 'infinityComfyUIStorage', {
      configurable: true,
      value: {
        loadProjectLibrary,
        saveProjectLibrary,
      },
    })

    const { projectStore } = await import('./projectStore')
    await Promise.resolve()

    projectStore.getState().updateProjectMetadata({ name: 'Created Before Load Finished' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).not.toHaveBeenCalled()

    resolveLoad(undefined)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(4999)

    expect(saveProjectLibrary).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(saveProjectLibrary).toHaveBeenCalledTimes(1)
    const savedLibrary = saveProjectLibrary.mock.calls.at(-1)?.[0]
    expect(savedLibrary.projects[savedLibrary.currentProjectId].project.name).toBe('Created Before Load Finished')
  })

  it('does not overwrite a saved desktop library while startup loading is still pending', async () => {
    vi.useFakeTimers()
    let resolveLoad: (value: unknown) => void = () => undefined
    const loadProjectLibrary = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve
        }),
    )
    const saveProjectLibrary = vi.fn().mockResolvedValue({ ok: true, rootPath: 'C:/Infinity/projects' })

    Object.defineProperty(window, 'infinityComfyUIStorage', {
      configurable: true,
      value: {
        loadProjectLibrary,
        saveProjectLibrary,
      },
    })

    const { projectStore } = await import('./projectStore')
    await Promise.resolve()

    const savedProject = structuredClone(projectStore.getState().project)
    savedProject.project.id = 'saved_project'
    savedProject.project.name = 'Saved Desktop Project'

    projectStore.getState().updateProjectMetadata({ name: 'Unsaved Startup Default' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).not.toHaveBeenCalled()

    resolveLoad({
      currentProjectId: savedProject.project.id,
      projects: {
        [savedProject.project.id]: savedProject,
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5000)

    expect(projectStore.getState().project.project.id).toBe(savedProject.project.id)
    expect(projectStore.getState().project.project.name).toBe('Saved Desktop Project')
    expect(projectStore.getState().projectLibrary[savedProject.project.id].project.name).toBe('Saved Desktop Project')
    expect(projectStore.getState().projectLibrary.project_local).toBeUndefined()
    expect(saveProjectLibrary).not.toHaveBeenCalled()
  })

  it('does not save after loading an existing library until the project is edited', async () => {
    vi.useFakeTimers()
    const savedProject = {
      schemaVersion: '1.0.0',
      project: {
        id: 'saved_project',
        name: 'Saved Project',
        createdAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z',
      },
      canvas: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      resources: {},
      assets: {},
      functions: {},
      tasks: {},
      history: { schemaVersion: '1.0.0', undoStack: [], redoStack: [] },
      templates: {},
      comfy: {
        endpoints: [
          {
            id: 'endpoint_local',
            name: 'Local ComfyUI',
            baseUrl: 'http://127.0.0.1:8188',
            enabled: true,
            maxConcurrentJobs: 2,
            priority: 10,
            timeoutMs: 600000,
            auth: { type: 'none' },
            health: { status: 'online' },
          },
        ],
        scheduler: { strategy: 'least_busy', retry: { maxAttempts: 1, fallbackToOtherEndpoint: true } },
      },
    }
    const loadProjectLibrary = vi.fn().mockResolvedValue({
      currentProjectId: savedProject.project.id,
      projects: { [savedProject.project.id]: savedProject },
    })
    const saveProjectLibrary = vi.fn().mockResolvedValue({ ok: true, rootPath: 'C:/Infinity/projects' })

    Object.defineProperty(window, 'infinityComfyUIStorage', {
      configurable: true,
      value: {
        loadProjectLibrary,
        saveProjectLibrary,
      },
    })

    const { projectStore } = await import('./projectStore')
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).not.toHaveBeenCalled()

    projectStore.getState().markEndpoint('endpoint_local', 'online')
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).not.toHaveBeenCalled()

    projectStore.getState().updateProjectMetadata({ name: 'Edited Project' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).toHaveBeenCalledTimes(1)
    const savedLibrary = saveProjectLibrary.mock.calls.at(-1)?.[0]
    expect(savedLibrary.projects[savedLibrary.currentProjectId].project.name).toBe('Edited Project')
  })

  it('retries a failed desktop save without requiring another project edit', async () => {
    vi.useFakeTimers()
    const loadProjectLibrary = vi.fn().mockResolvedValue(undefined)
    const saveProjectLibrary = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'disk temporarily unavailable' })
      .mockResolvedValueOnce({ ok: true, rootPath: 'C:/Infinity/projects' })

    Object.defineProperty(window, 'infinityComfyUIStorage', {
      configurable: true,
      value: {
        loadProjectLibrary,
        saveProjectLibrary,
      },
    })

    const { projectStore } = await import('./projectStore')
    await Promise.resolve()
    await Promise.resolve()

    projectStore.getState().updateProjectMetadata({ name: 'Must Survive Refresh' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).toHaveBeenCalledTimes(2)
    const savedLibrary = saveProjectLibrary.mock.calls.at(-1)?.[0]
    expect(savedLibrary.projects[savedLibrary.currentProjectId].project.name).toBe('Must Survive Refresh')
  })

  it('serializes desktop saves so an older slow save cannot overwrite newer project data', async () => {
    vi.useFakeTimers()
    let resolveFirstSave: (value: { ok: boolean; rootPath?: string }) => void = () => undefined
    const loadProjectLibrary = vi.fn().mockResolvedValue(undefined)
    const saveProjectLibrary = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstSave = resolve
          }),
      )
      .mockResolvedValue({ ok: true, rootPath: 'C:/Infinity/projects' })

    Object.defineProperty(window, 'infinityComfyUIStorage', {
      configurable: true,
      value: {
        loadProjectLibrary,
        saveProjectLibrary,
      },
    })

    const { projectStore } = await import('./projectStore')
    await Promise.resolve()
    await Promise.resolve()

    projectStore.getState().updateProjectMetadata({ name: 'Older Save' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).toHaveBeenCalledTimes(1)

    projectStore.getState().updateProjectMetadata({ name: 'Newer Save' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).toHaveBeenCalledTimes(1)

    resolveFirstSave({ ok: true, rootPath: 'C:/Infinity/projects' })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveProjectLibrary).toHaveBeenCalledTimes(2)
    const savedLibrary = saveProjectLibrary.mock.calls.at(-1)?.[0]
    expect(savedLibrary.projects[savedLibrary.currentProjectId].project.name).toBe('Newer Save')
  })
})
