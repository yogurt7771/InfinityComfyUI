# Asset-First Full Migration Refactor Design

## Status

This document is the source of truth for the full asset-first architecture refactor.

It supersedes any design or implementation path that keeps visible `function` or `result_group` canvas nodes as supported runtime objects. Existing project data is not migrated. New behavior must use the asset-first model for every function provider and every user-facing workflow.

## Goal

The primary goal of this refactor is to make future changes fast, localized, and low-risk. The architecture should have high cohesion, low coupling, clear module boundaries, and explicit ownership of responsibilities so a change in one feature does not unexpectedly break canvas rendering, task execution, history, persistence, or previews.

Infinity ComfyUI should treat the canvas as an asset graph, not as a workflow-node editor.

Users select or create assets, run functions through a command modal, and receive pending output assets that later become final assets. Groups and templates organize and reproduce asset subgraphs. Function definitions, tasks, and run snapshots remain part of the project data, but functions are commands rather than visible canvas nodes.

This means the refactor is not successful if it merely recreates the current behavior with smaller files. It is successful only when each major subsystem can be changed and tested through a narrow interface:

- Canvas rendering depends on projection data, not execution internals.
- Function execution depends on run commands and provider adapters, not React components.
- History depends on command transactions, not ad hoc UI event handlers.
- Persistence depends on project revisions and serializers, not full-store subscriptions.
- Asset preview and layout depend on resource view models, not provider-specific task details.
- Groups and templates depend on asset graph recipes, not hidden function/result canvas nodes.

## Confirmed Scope

### In Scope

- Migrate every function execution path to asset-first:
  - ComfyUI workflow functions
  - OpenAI/Gemini LLM functions
  - OpenAI/Gemini image functions
  - HTTP request functions
  - Local transform functions
- Remove visible function-node and result-group-node behavior from the canvas.
- Replace rerun and edit-and-run with one action: open the function command modal from the output asset run snapshot.
- Make pending outputs first-class assets.
- Make asset lineage edges the only workflow edges shown on canvas.
- Route all graph-changing operations through commands so history is reliable and batch operations create one history entry.
- Keep group and template as independent features.
- Keep templates capable of reproducing asset subgraphs using run snapshots, not old function nodes.

### Out of Scope

- No automatic migration of old project graph data.
- No long-term compatibility layer for visible `function` / `result_group` canvas nodes.
- No dual-track UI where old nodes and new asset commands both remain supported.
- No partial provider migration that leaves some function types on the old execution path.

## Current Architectural Problem

The current codebase has two competing models:

1. Old model: visible `function` nodes receive inputs and visible `result_group` nodes represent runs.
2. New model: visible assets are connected directly, and function runs are stored in asset/task metadata.

This mixed model causes repeated bugs because UI rendering details, task execution, edge projection, history, persistence, and preview state all depend on each other. Examples already seen:

- Removing a visible left-side slot broke lineage edge rendering.
- Batch deletion produced multiple history entries because the UI called single-node commands repeatedly.
- Asset preview sizing had to be patched in several places.
- Pending/running state had to be propagated from task nodes back to asset nodes.
- History snapshots became too heavy because assets and resources were duplicated into command history.

The refactor must therefore change the model boundary, not only split files.

## Target Domain Model

### ProjectState

The target project state should separate canvas graph, resource library, execution runs, tasks, functions, templates, and history.

```ts
type ProjectState = {
  schemaVersion: string
  project: ProjectMetadata
  canvas: AssetCanvasState
  resources: Record<ResourceId, Resource>
  assets: Record<AssetId, AssetRecord>
  functions: Record<FunctionId, GenerationFunction>
  runs: Record<RunId, RunSnapshot>
  tasks: Record<TaskId, ExecutionTask>
  templates: Record<TemplateId, TemplateRecipe>
  history: ProjectHistoryState
  comfy: ComfySettings
}
```

### Canvas

The canvas should only contain visible asset nodes and group nodes.

```ts
type CanvasNodeKind = 'asset' | 'group'

type AssetCanvasNode = {
  id: NodeId
  type: 'asset'
  position: Point
  size?: Size
  data: {
    resourceId: ResourceId
    title?: string
  }
}

type GroupCanvasNode = {
  id: NodeId
  type: 'group'
  position: Point
  size: Size
  data: {
    title: string
    childNodeIds: NodeId[]
    color?: string
    collapsed?: boolean
    templateInstanceId?: TemplateInstanceId
  }
}

type AssetLineageEdge = {
  id: EdgeId
  sourceResourceId: ResourceId
  targetResourceId: ResourceId
  inputKey: string
  runId: RunId
}
```

The React Flow edge/node shape should be a projection, not the source of truth.

### Resource

Resources remain the typed user-facing asset content. Function output resources should no longer refer to function or result canvas nodes.

```ts
type Resource = {
  id: ResourceId
  type: ResourceType
  name?: string
  value: string | number | MediaResourceValue
  source: {
    kind: ResourceSourceKind
    runId?: RunId
    outputKey?: string
    parentResourceId?: ResourceId
  }
  metadata?: ResourceMetadata
}
```

### RunSnapshot

`RunSnapshot` is the reproducibility contract. Every generated output asset must point to a run snapshot.

```ts
type RunSnapshot = {
  id: RunId
  functionId: FunctionId
  functionName: string
  functionSnapshot: GenerationFunction
  provider: 'comfyui' | 'openai_llm' | 'gemini_llm' | 'openai_image' | 'gemini_image' | 'http_request' | 'local_transform'
  inputRefs: Record<InputKey, InputResourceRef>
  inputValuesSnapshot: Record<InputKey, ExecutionInputSnapshot>
  primitiveParams: Record<string, PrimitiveInputValue>
  runIndex: number
  runTotal: number
  outputRefs: Record<OutputKey, ResourceRef[]>
  endpointId?: string
  workflowTemplateSnapshot?: ComfyWorkflow
  compiledWorkflowSnapshot?: ComfyWorkflow
  requestSnapshot?: unknown
  seedPatchLog: SeedPatchRecord[]
  taskIds: TaskId[]
  status: ProjectHistoryStatus
  error?: ExecutionTask['error']
  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

Important rule: edit/run from a generated asset must default to the saved run snapshot, not the latest function definition.

### ExecutionTask

Tasks should describe execution work, not canvas nodes.

```ts
type ExecutionTask = {
  id: TaskId
  runId: RunId
  functionId: FunctionId
  status: TaskStatus
  inputRefs: Record<InputKey, InputResourceRef>
  outputRefs: Record<OutputKey, ResourceRef[]>
  endpointId?: string
  providerRequestId?: string
  comfyPromptId?: string
  createdAt: string
  startedAt?: string
  updatedAt: string
  completedAt?: string
  error?: TaskError
}
```

## Command Architecture

All project-changing operations should enter through commands. Commands are the only layer allowed to record history.

```ts
type ProjectCommand =
  | CreateAssetCommand
  | UpdateAssetCommand
  | DeleteAssetsCommand
  | MoveCanvasNodesCommand
  | ResizeCanvasNodeCommand
  | RunFunctionCommand
  | CompleteTaskCommand
  | FailTaskCommand
  | CancelTaskCommand
  | ConnectLineageCommand
  | CreateGroupCommand
  | UngroupCommand
  | SaveTemplateCommand
  | InstantiateTemplateCommand
```

Each command returns a transaction:

```ts
type ProjectTransaction = {
  id: string
  label: string
  type: ProjectTransactionType
  createdAt: string
  affectedIds: AffectedIds
  preview: ProjectHistoryPreview
  before: ProjectHistorySnapshot
  after: ProjectHistorySnapshot
}
```

Batch commands are first-class. For example, deleting three selected assets and their lineage edges is one `DeleteAssetsCommand`, therefore one history entry.

Viewport pan/zoom is UI state and must not record history. Node position changes are graph changes and must record history.

## Run Engine Architecture

Function execution should be split into orchestration and provider adapters.

### Run Orchestrator

Responsibilities:

1. Validate slot mapping and primitive parameters.
2. Create a `RunSnapshot`.
3. Create pending output resources and visible asset nodes immediately.
4. Create lineage edges from input assets to pending outputs.
5. Create one or more tasks.
6. Queue runnable tasks immediately.
7. Leave tasks pending when inputs depend on pending assets.
8. Resume pending tasks when upstream assets complete.
9. Fail dependent tasks immediately when upstream assets fail.

### Provider Adapter Interface

Each function provider should implement the same interface.

```ts
type FunctionRunAdapter = {
  provider: RunSnapshot['provider']
  canRun(functionDef: GenerationFunction): boolean
  prepare(request: RunPrepareRequest): RunPreparedTask
  execute(task: RunPreparedTask): Promise<RunExecutionResult>
  extractOutputs(result: RunExecutionResult): Promise<ExtractedOutput[]>
}
```

Adapters:

- `ComfyRunAdapter`
- `OpenAiLlmRunAdapter`
- `GeminiLlmRunAdapter`
- `OpenAiImageRunAdapter`
- `GeminiImageRunAdapter`
- `HttpRequestRunAdapter`
- `LocalTransformRunAdapter`

Provider-specific details stay inside adapters. The store should not contain large duplicated branches for each provider.

## Function Command Modal

The function command modal is the only user-facing function run interface.

### Entry Points

- Right-click selected assets and choose a function.
- Use the assets dock action to run a function.
- Click the function chip on a generated asset to edit/run from snapshot.
- Run a group/template instance.

### Modal Sections

1. Input Tray
   - Shows selected candidate assets.
   - Supports preview, remove, and drag reorder.
2. Slot Mapping
   - One row per asset input.
   - Supports automatic compatible assignment.
   - Supports Pick Mode from canvas.
3. Parameters
   - Primitive text/number inputs and provider-specific settings.
4. Outputs
   - Shows expected outputs before run.
   - Shows pending/final outputs after run.
5. Actions
   - Run
   - Cancel
   - Save preset later if needed

### Pick Mode

Pick Mode should be owned by UI state, not persisted project data.

Flow:

1. User clicks pick icon for a slot.
2. Modal collapses into a floating picker strip.
3. Compatible assets are highlighted.
4. Incompatible assets are dimmed.
5. Clicking an asset fills the slot.
6. `Enter` confirms and `Escape` cancels.
7. Modal restores after selection.

## Canvas Projection

React Flow should consume derived view models:

```ts
type CanvasProjection = {
  nodes: Node<AssetNodeViewData | GroupNodeViewData>[]
  edges: Edge[]
}
```

Projection responsibilities:

- Convert asset nodes to React Flow nodes.
- Convert group nodes to React Flow nodes.
- Convert `AssetLineageEdge` to React Flow edges.
- Provide hidden technical handles only when React Flow needs them.
- Never decide business relationships from DOM handles.

This prevents future UI-handle changes from breaking lineage logic.

## History and Persistence

### History

History should record command transactions, not component events.

Rules:

- One user command equals one history entry.
- Batch operations stay one transaction.
- Task status transitions that create/finalize assets are history-visible.
- History previews show affected assets by id and resolve thumbnails from the asset library.
- History snapshots must remain compact and hydrate media URLs from the asset library.

### Persistence

Persistence should use project revision tracking.

Recommended model:

```ts
type PersistenceState = {
  lastPersistedRevision: number
  dirtyRevision: number
  saveTimer?: number
  saveInFlight: boolean
}
```

Rules:

- Commands increment the project revision.
- UI-only state does not increment the project revision.
- Save after 5 seconds of idle project changes.
- Flush on page unload or desktop close.
- Avoid repeated `JSON.stringify` of the full project on every store notification.

## Group and Template Architecture

### Group

Group remains an organizational canvas node.

It can:

- Contain selected asset/group nodes.
- Move child nodes as a unit.
- Be resized/collapsed.
- Be deleted.
- Be ungrouped.

Group does not imply template origin.

### Template

Template is a reusable asset graph recipe.

It stores:

- Root input asset definitions.
- Internal asset definitions.
- Output asset definitions.
- Run snapshots for every generated internal/output asset.
- Asset lineage DAG.
- Relative layout.
- Exposed input/output mapping.
- Default group display metadata.

Creating a template instance creates a group and cloned asset subgraph.

Running a template/group uses the same run orchestrator and pending dependency system. It never restores visible function nodes.

## Module Layout

Target module layout:

```text
src/domain/
  assetGraph.ts
  assetGraphProjection.ts
  commands/
    commandTypes.ts
    commandHistory.ts
    assetCommands.ts
    canvasCommands.ts
    groupCommands.ts
    templateCommands.ts
    runCommands.ts
  runs/
    runSnapshot.ts
    runOrchestrator.ts
    dependencyResolver.ts
    adapters/
      comfyRunAdapter.ts
      openAiLlmRunAdapter.ts
      geminiLlmRunAdapter.ts
      openAiImageRunAdapter.ts
      geminiImageRunAdapter.ts
      httpRequestRunAdapter.ts
      localTransformRunAdapter.ts
  persistence/
    projectPersistence.ts
    projectSerializer.ts

src/store/
  projectStore.ts
  projectStoreActions.ts

src/components/canvas/
  CanvasWorkspace.tsx
  AssetNodeView.tsx
  GroupNodeView.tsx
  CanvasContextMenus.tsx
  CanvasPickMode.tsx

src/components/functions/
  FunctionCommandModal.tsx
  InputTray.tsx
  SlotMapping.tsx
  FunctionParameters.tsx
  OutputPreviewStrip.tsx

src/components/panels/
  AssetsDock.tsx
  HistoryDock.tsx
  InspectorPanel.tsx
  SettingsPanel.tsx
```

The store should coordinate state, not contain provider execution implementation.

## Migration Strategy

Because old project data is not migrated, the implementation can cut over cleanly.

Recommended sequence:

1. Add new asset-first domain types and command tests.
2. Implement command/history layer around asset canvas operations.
3. Implement run snapshot and pending output asset creation.
4. Implement provider adapter interface and migrate all providers.
5. Replace canvas projection with asset/group-only projection.
6. Replace function-node UI with function command modal.
7. Replace result-group rerun with asset snapshot edit/run.
8. Wire group/template to asset graph commands.
9. Remove old visible `FunctionNodeView` and `ResultGroupNodeView` from canvas `nodeTypes`.
10. Delete unused old node-run paths after test coverage passes.

## Testing Strategy

Required test guarantees:

- Running any function provider creates only asset canvas nodes.
- No function run creates `function` or `result_group` canvas nodes.
- Pending output assets appear immediately.
- Pending dependency chains can be arbitrarily deep.
- Upstream success resumes dependent runs.
- Upstream failure fails dependent runs.
- Asset lineage edges are derived from run snapshots.
- Batch delete/move/group commands create one history entry.
- Undo/redo restores asset graph and resources.
- Generated assets open function modal from saved run snapshot.
- Group and template runs use the same run orchestrator.
- Persistence does not write for UI-only state.

## Acceptance Criteria

The full migration is complete when:

1. `CanvasNodeKind` no longer includes `function` or `result_group`.
2. React Flow `nodeTypes` no longer registers function or result-group nodes.
3. Store actions no longer expose `addFunctionNode`, `runLocalFunctionNode`, or `rerunResultNode` style APIs.
4. All provider runs go through `RunFunctionCommand`.
5. Every output resource has a `runId` and output key when generated by a function.
6. Canvas edges are asset lineage edges only.
7. Function command modal supports all function providers.
8. History records command transactions for all graph changes.
9. Tests prove old visible function/result node paths are gone.
10. `npm test`, `npm run build`, and Docker startup pass.
11. Canvas projection, command/history, run orchestration, provider adapters, persistence, and UI modules can each be tested without importing the others' implementation internals.
12. New function providers can be added by implementing a provider adapter and function settings UI, without editing canvas projection, history recording, persistence scheduling, or asset node layout code.
13. New canvas asset interactions can be added through graph commands and projection updates, without editing provider execution branches.

## Risks

- This refactor touches state, execution, UI, history, and persistence. It should be implemented in planned slices with tests at each boundary.
- Deleting old runtime paths too early can strand provider behavior. Provider adapters should be migrated and tested before old branches are removed.
- Snapshot-based undo remains simple but can still grow large. History compaction should stay part of the command layer.
- Template execution depends on accurate run snapshots. Run snapshot shape must be stable before template runner work begins.

## Decision

Proceed with the full asset-first migration.

Do not build a legacy graph migration layer. Do not preserve old visible function/result nodes as supported runtime concepts. All user-facing function execution must be represented as asset commands, run snapshots, pending assets, final assets, and asset lineage.
