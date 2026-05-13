import { afterEach, describe, expect, it, vi } from 'vitest'

describe('desktop project persistence', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    Reflect.deleteProperty(window, 'infinityComfyUIStorage')
  })

  it('loads through the Electron bridge and saves the active project library after changes', async () => {
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
    await vi.advanceTimersByTimeAsync(350)

    const savedLibrary = saveProjectLibrary.mock.calls.at(-1)?.[0]
    expect(savedLibrary).toMatchObject({
      currentProjectId: projectStore.getState().project.project.id,
    })
    expect(savedLibrary.projects[savedLibrary.currentProjectId].project.name).toBe('Desktop Saved Project')
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
    await vi.advanceTimersByTimeAsync(350)

    expect(saveProjectLibrary).not.toHaveBeenCalled()

    resolveLoad({
      currentProjectId: savedProject.project.id,
      projects: {
        [savedProject.project.id]: savedProject,
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(350)

    expect(projectStore.getState().project.project.id).toBe(savedProject.project.id)
    const savedLibrary = saveProjectLibrary.mock.calls.at(-1)?.[0]
    expect(savedLibrary.currentProjectId).toBe(savedProject.project.id)
    expect(savedLibrary.projects[savedProject.project.id].project.name).toBe('Saved Desktop Project')
    expect(savedLibrary.projects.project_local).toBeUndefined()
  })
})
