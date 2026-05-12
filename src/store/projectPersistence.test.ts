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
})
