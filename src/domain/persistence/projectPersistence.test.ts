import { describe, expect, it, vi } from 'vitest'
import { createIdleProjectPersistenceController } from './projectPersistence'

describe('idle project persistence controller', () => {
  it('does not schedule a save while startup loading is pending', async () => {
    vi.useFakeTimers()
    const saveSnapshot = vi.fn().mockResolvedValue(true)
    const controller = createIdleProjectPersistenceController({
      idleMs: 5000,
      getRevisionKey: () => 'rev_1',
      createSnapshot: () => ({ revision: 'rev_1' }),
      saveSnapshot,
    })

    controller.schedule()
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveSnapshot).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not save when the revision key has not changed', async () => {
    vi.useFakeTimers()
    const saveSnapshot = vi.fn().mockResolvedValue(true)
    const controller = createIdleProjectPersistenceController({
      idleMs: 5000,
      getRevisionKey: () => 'rev_1',
      createSnapshot: () => ({ revision: 'rev_1' }),
      saveSnapshot,
    })

    controller.markLoaded()
    controller.schedule()
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveSnapshot).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('saves the latest snapshot after the idle delay when the revision changes', async () => {
    vi.useFakeTimers()
    let revision = 'rev_1'
    const saveSnapshot = vi.fn().mockResolvedValue(true)
    const controller = createIdleProjectPersistenceController({
      idleMs: 5000,
      getRevisionKey: () => revision,
      createSnapshot: () => ({ revision }),
      saveSnapshot,
    })

    controller.markLoaded()
    revision = 'rev_2'
    controller.schedule()
    await vi.advanceTimersByTimeAsync(4999)
    expect(saveSnapshot).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(saveSnapshot).toHaveBeenCalledWith({ revision: 'rev_2' })
    vi.useRealTimers()
  })

  it('retries a failed save without another revision change', async () => {
    vi.useFakeTimers()
    let revision = 'rev_1'
    const saveSnapshot = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const controller = createIdleProjectPersistenceController({
      idleMs: 5000,
      getRevisionKey: () => revision,
      createSnapshot: () => ({ revision }),
      saveSnapshot,
    })

    controller.markLoaded()
    revision = 'rev_2'
    controller.schedule()
    await vi.advanceTimersByTimeAsync(5000)
    expect(saveSnapshot).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(saveSnapshot).toHaveBeenCalledTimes(2)
    expect(saveSnapshot).toHaveBeenLastCalledWith({ revision: 'rev_2' })
    vi.useRealTimers()
  })

  it('serializes saves so a slow older save cannot mark newer edits as persisted', async () => {
    vi.useFakeTimers()
    let revision = 'rev_1'
    let resolveFirstSave: (ok: boolean) => void = () => undefined
    const saveSnapshot = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirstSave = resolve
          }),
      )
      .mockResolvedValue(true)
    const controller = createIdleProjectPersistenceController({
      idleMs: 5000,
      getRevisionKey: () => revision,
      createSnapshot: () => ({ revision }),
      saveSnapshot,
    })

    controller.markLoaded()
    revision = 'rev_2'
    controller.schedule()
    await vi.advanceTimersByTimeAsync(5000)
    expect(saveSnapshot).toHaveBeenCalledTimes(1)

    revision = 'rev_3'
    controller.schedule()
    await vi.advanceTimersByTimeAsync(5000)
    expect(saveSnapshot).toHaveBeenCalledTimes(1)

    resolveFirstSave(true)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveSnapshot).toHaveBeenCalledTimes(2)
    expect(saveSnapshot).toHaveBeenLastCalledWith({ revision: 'rev_3' })
    vi.useRealTimers()
  })

  it('flushes a pending save immediately', async () => {
    vi.useFakeTimers()
    let revision = 'rev_1'
    const saveSnapshot = vi.fn().mockResolvedValue(true)
    const controller = createIdleProjectPersistenceController({
      idleMs: 5000,
      getRevisionKey: () => revision,
      createSnapshot: () => ({ revision }),
      saveSnapshot,
    })

    controller.markLoaded()
    revision = 'rev_2'
    controller.schedule()
    controller.flush()
    await Promise.resolve()

    expect(saveSnapshot).toHaveBeenCalledTimes(1)
    expect(saveSnapshot).toHaveBeenCalledWith({ revision: 'rev_2' })
    vi.useRealTimers()
  })
})
