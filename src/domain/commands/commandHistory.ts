import type { CommandHistoryState, CommandTransaction, CreateCommandTransactionInput } from './commandTypes'

export const COMMAND_HISTORY_SCHEMA_VERSION = '1.0.0'
export const DEFAULT_COMMAND_HISTORY_LIMIT = 100

const snapshotKey = <Snapshot>(snapshot: Snapshot) => JSON.stringify(snapshot)

const cloneSnapshot = <Snapshot>(snapshot: Snapshot): Snapshot => structuredClone(snapshot)

export function emptyCommandHistory<Snapshot>(): CommandHistoryState<Snapshot> {
  return {
    schemaVersion: COMMAND_HISTORY_SCHEMA_VERSION,
    undoStack: [],
    redoStack: [],
  }
}

export function createCommandTransaction<Snapshot>(
  input: CreateCommandTransactionInput<Snapshot>,
): CommandTransaction<Snapshot> | undefined {
  const before = input.compactSnapshot ? input.compactSnapshot(input.before) : input.before
  const after = input.compactSnapshot ? input.compactSnapshot(input.after) : input.after
  if (snapshotKey(before) === snapshotKey(after)) return undefined

  return {
    id: input.id,
    type: input.type,
    label: input.label,
    createdAt: input.createdAt,
    affectedIds: input.affectedIds,
    preview: input.preview,
    before: cloneSnapshot(before),
    after: cloneSnapshot(after),
  }
}

export function pushCommandTransaction<Snapshot>(
  history: CommandHistoryState<Snapshot>,
  transaction: CommandTransaction<Snapshot> | undefined,
  limit = DEFAULT_COMMAND_HISTORY_LIMIT,
): CommandHistoryState<Snapshot> {
  if (!transaction) return history

  return {
    schemaVersion: history.schemaVersion,
    undoStack: [...history.undoStack, transaction].slice(-limit),
    redoStack: [],
  }
}

export function undoCommandHistory<Snapshot>(
  history: CommandHistoryState<Snapshot>,
  hydrateSnapshot: (snapshot: Snapshot) => Snapshot = (snapshot) => snapshot,
) {
  const transaction = history.undoStack.at(-1)
  if (!transaction) return undefined

  return {
    snapshot: hydrateSnapshot(cloneSnapshot(transaction.before)),
    transaction,
    history: {
      schemaVersion: history.schemaVersion,
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, transaction],
    },
  }
}

export function redoCommandHistory<Snapshot>(
  history: CommandHistoryState<Snapshot>,
  hydrateSnapshot: (snapshot: Snapshot) => Snapshot = (snapshot) => snapshot,
) {
  const transaction = history.redoStack.at(-1)
  if (!transaction) return undefined

  return {
    snapshot: hydrateSnapshot(cloneSnapshot(transaction.after)),
    transaction,
    history: {
      schemaVersion: history.schemaVersion,
      undoStack: [...history.undoStack, transaction],
      redoStack: history.redoStack.slice(0, -1),
    },
  }
}
