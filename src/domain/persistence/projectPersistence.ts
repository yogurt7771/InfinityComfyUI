type TimerHandle = ReturnType<typeof setTimeout>

export type IdleProjectPersistenceController = {
  markLoaded: (savedRevisionKey?: string) => void
  schedule: () => void
  flush: () => void
  dispose: () => void
}

export type IdleProjectPersistenceControllerOptions<TSnapshot> = {
  idleMs: number
  getRevisionKey: () => string
  createSnapshot: () => TSnapshot
  saveSnapshot: (snapshot: TSnapshot) => Promise<boolean> | boolean
  setTimer?: (callback: () => void, ms: number) => TimerHandle
  clearTimer?: (timer: TimerHandle) => void
}

export function createIdleProjectPersistenceController<TSnapshot>({
  idleMs,
  getRevisionKey,
  createSnapshot,
  saveSnapshot,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer),
}: IdleProjectPersistenceControllerOptions<TSnapshot>): IdleProjectPersistenceController {
  let loaded = false
  let saveTimer: TimerHandle | undefined
  let saveInFlight = false
  let lastSavedRevisionKey: string | undefined

  const clearScheduledSave = () => {
    if (saveTimer === undefined) return
    clearTimer(saveTimer)
    saveTimer = undefined
  }

  const shouldSave = () => loaded && getRevisionKey() !== lastSavedRevisionKey

  const schedule = () => {
    if (!shouldSave()) {
      clearScheduledSave()
      return
    }

    clearScheduledSave()
    saveTimer = setTimer(() => {
      saveTimer = undefined
      runSave()
    }, idleMs)
  }

  const completeSave = (revisionKey: string, ok: boolean) => {
    saveInFlight = false
    if (ok) lastSavedRevisionKey = revisionKey
    if (shouldSave()) schedule()
  }

  const runSave = () => {
    if (!shouldSave() || saveInFlight) return

    const revisionKey = getRevisionKey()
    const snapshot = createSnapshot()
    saveInFlight = true

    void Promise.resolve(saveSnapshot(snapshot)).then(
      (ok) => completeSave(revisionKey, Boolean(ok)),
      () => completeSave(revisionKey, false),
    )
  }

  return {
    markLoaded: (savedRevisionKey = getRevisionKey()) => {
      loaded = true
      lastSavedRevisionKey = savedRevisionKey
      clearScheduledSave()
    },
    schedule,
    flush: () => {
      clearScheduledSave()
      runSave()
    },
    dispose: () => {
      loaded = false
      clearScheduledSave()
    },
  }
}
