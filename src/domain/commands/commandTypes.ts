export type CommandTransactionType = 'asset' | 'canvas' | 'connection' | 'group' | 'template' | 'run' | 'settings'

export type CommandHistoryStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled'

export type CommandAffectedIds = {
  assetIds?: string[]
  resourceIds?: string[]
  nodeIds?: string[]
  groupIds?: string[]
  templateIds?: string[]
  runIds?: string[]
  taskIds?: string[]
}

export type CommandPreview = {
  title: string
  subtitle?: string
  assetIds?: string[]
  resourceIds?: string[]
  nodeIds?: string[]
  groupIds?: string[]
  templateIds?: string[]
  status?: CommandHistoryStatus
}

export type CommandTransaction<Snapshot> = {
  id: string
  type: CommandTransactionType
  label: string
  createdAt: string
  affectedIds: CommandAffectedIds
  preview: CommandPreview
  before: Snapshot
  after: Snapshot
}

export type CommandHistoryState<Snapshot> = {
  schemaVersion: string
  undoStack: CommandTransaction<Snapshot>[]
  redoStack: CommandTransaction<Snapshot>[]
}

export type CreateCommandTransactionInput<Snapshot> = {
  id: string
  type: CommandTransactionType
  label: string
  createdAt: string
  affectedIds: CommandAffectedIds
  preview: CommandPreview
  before: Snapshot
  after: Snapshot
  compactSnapshot?: (snapshot: Snapshot) => Snapshot
}
