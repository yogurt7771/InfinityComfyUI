# Asset-First Full Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every user-facing function workflow to an asset-first architecture where future changes are fast, localized, low-risk, high-cohesion, and low-coupling.

**Architecture:** Introduce an asset graph domain, command/history boundary, run snapshot model, provider adapters, and React Flow projection layer. Then migrate all function providers and UI entry points to `Asset(s) -> Function Command Modal -> Run Command -> Pending Asset(s) -> Final Asset(s)` before deleting visible `function` and `result_group` canvas paths.

**Tech Stack:** TypeScript, React 19, Zustand, React Flow, Vitest, IndexedDB/Electron persistence, Docker.

---

## File Structure Target

### New Domain Files

- Create `src/domain/assetGraph.ts`: asset-first canvas node/edge types and pure graph helpers.
- Create `src/domain/assetGraph.test.ts`: tests for asset/group-only graph behavior.
- Create `src/domain/assetGraphProjection.ts`: converts asset graph state to React Flow nodes/edges.
- Create `src/domain/assetGraphProjection.test.ts`: verifies projection has no function/result group node types.
- Create `src/domain/commands/commandTypes.ts`: command and transaction type definitions.
- Create `src/domain/commands/commandHistory.ts`: transaction snapshot creation, compaction, undo/redo restore.
- Create `src/domain/commands/assetCommands.ts`: create/update/delete/move asset commands.
- Create `src/domain/commands/groupCommands.ts`: group/ungroup commands.
- Create `src/domain/commands/templateCommands.ts`: save/instantiate template commands.
- Create `src/domain/commands/runCommands.ts`: run command input/output mutation helpers.
- Create `src/domain/runs/runSnapshot.ts`: run snapshot normalization and validation.
- Create `src/domain/runs/dependencyResolver.ts`: pending dependency resolution and failure propagation.
- Create `src/domain/runs/runOrchestrator.ts`: provider-neutral run lifecycle.
- Create `src/domain/runs/adapters/comfyRunAdapter.ts`: ComfyUI adapter.
- Create `src/domain/runs/adapters/openAiLlmRunAdapter.ts`: OpenAI/Gemini-compatible LLM split begins here.
- Create `src/domain/runs/adapters/geminiLlmRunAdapter.ts`: Gemini LLM adapter.
- Create `src/domain/runs/adapters/openAiImageRunAdapter.ts`: OpenAI image adapter.
- Create `src/domain/runs/adapters/geminiImageRunAdapter.ts`: Gemini image adapter.
- Create `src/domain/runs/adapters/httpRequestRunAdapter.ts`: HTTP request adapter.
- Create `src/domain/runs/adapters/localTransformRunAdapter.ts`: local transform adapter.
- Create `src/domain/persistence/projectSerializer.ts`: persistence serializer independent of store subscription.
- Create `src/domain/persistence/projectPersistence.ts`: revision-based idle persistence scheduling.

### New UI Files

- Create `src/components/canvas/CanvasWorkspace.tsx`: asset/group-only canvas shell.
- Create `src/components/canvas/AssetNodeView.tsx`: resource asset node view.
- Create `src/components/canvas/GroupNodeView.tsx`: group node view.
- Create `src/components/canvas/CanvasContextMenus.tsx`: asset/group context menus.
- Create `src/components/canvas/CanvasPickMode.tsx`: Excel-style asset picker overlay.
- Create `src/components/functions/FunctionCommandModal.tsx`: modal shell.
- Create `src/components/functions/InputTray.tsx`: selected/candidate input assets.
- Create `src/components/functions/SlotMapping.tsx`: function asset input assignment.
- Create `src/components/functions/FunctionParameters.tsx`: primitive/provider settings.
- Create `src/components/functions/OutputPreviewStrip.tsx`: pending/final output preview strip.
- Create `src/components/panels/AssetsDock.tsx`: extracted assets popover.
- Create `src/components/panels/HistoryDock.tsx`: extracted command history popover.
- Create `src/components/panels/InspectorPanel.tsx`: extracted inspector.
- Create `src/components/panels/SettingsPanel.tsx`: extracted settings.

### Existing Files To Shrink Or Replace

- Modify `src/domain/types.ts`: replace old canvas node/run fields after new model is wired.
- Modify `src/store/projectStore.ts`: reduce to store composition and action delegation.
- Modify `src/components/CanvasWorkspace.tsx`: replace with compatibility wrapper or remove after new canvas path is active.
- Modify `src/components/NodeViews.tsx`: remove from active canvas path; later delete function/result-group views.
- Modify `src/components/WorkbenchPanels.tsx`: route to extracted panels and function modal.
- Modify `src/domain/canvasEdges.ts`: replace with asset graph projection or delete.
- Modify tests beside each changed module.

## Task 1: Asset Graph Domain Boundary

**Files:**
- Create: `src/domain/assetGraph.ts`
- Create: `src/domain/assetGraph.test.ts`
- Reference: `docs/superpowers/specs/2026-06-23-asset-first-full-migration-design.md`

- [x] **Step 1: Write failing tests for the asset-only graph contract**

```ts
import { describe, expect, it } from 'vitest'
import { assetGraphNodeKinds, createAssetLineageEdge, isAssetGraphNode } from './assetGraph'

describe('assetGraph', () => {
  it('allows only asset and group canvas node kinds', () => {
    expect(assetGraphNodeKinds).toEqual(['asset', 'group'])
    expect(isAssetGraphNode({ id: 'node_asset', type: 'asset', position: { x: 0, y: 0 }, data: { resourceId: 'res_1' } })).toBe(true)
    expect(isAssetGraphNode({ id: 'node_group', type: 'group', position: { x: 0, y: 0 }, size: { width: 200, height: 120 }, data: { title: 'Group', childNodeIds: [] } })).toBe(true)
    expect(isAssetGraphNode({ id: 'node_fn', type: 'function', position: { x: 0, y: 0 }, data: {} })).toBe(false)
    expect(isAssetGraphNode({ id: 'node_result', type: 'result_group', position: { x: 0, y: 0 }, data: {} })).toBe(false)
  })

  it('creates deterministic asset lineage edges between resources', () => {
    expect(
      createAssetLineageEdge({
        runId: 'run_1',
        inputKey: 'image',
        sourceResourceId: 'res_input',
        targetResourceId: 'res_output',
      }),
    ).toEqual({
      id: 'lineage:run_1:image:res_input:res_output',
      runId: 'run_1',
      inputKey: 'image',
      sourceResourceId: 'res_input',
      targetResourceId: 'res_output',
    })
  })
})
```

- [x] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run src/domain/assetGraph.test.ts`

Expected: fail because `assetGraph` does not exist.

- [x] **Step 3: Implement the minimal asset graph domain**

Create focused exported types and helpers only. Do not edit the legacy `CanvasNodeKind` yet.

- [x] **Step 4: Run the test and verify it passes**

Run: `npm test -- --run src/domain/assetGraph.test.ts`

Expected: pass.

- [x] **Step 5: Run nearby tests**

Run: `npm test -- --run src/domain/canvasEdges.test.ts src/domain/resourceNodeLayout.test.ts`

Expected: pass.

## Task 2: Command Transaction Core

**Files:**
- Create: `src/domain/commands/commandTypes.ts`
- Create: `src/domain/commands/commandHistory.ts`
- Create: `src/domain/commands/commandHistory.test.ts`
- Modify later: `src/store/projectStore.ts`

- [x] **Step 1: Write failing tests for one-command-one-history behavior**
- [x] **Step 2: Implement serializable command and transaction types**
- [x] **Step 3: Implement compact snapshot creation and hydrate restore helpers**
- [x] **Step 4: Prove batch delete/move commands produce one transaction**
- [x] **Step 5: Run command tests**

Run: `npm test -- --run src/domain/commands/commandHistory.test.ts`

Expected: pass.

## Task 3: Asset Commands

**Files:**
- Create: `src/domain/commands/assetCommands.ts`
- Create: `src/domain/commands/assetCommands.test.ts`
- Modify: `src/store/projectStore.ts`

- [x] **Step 1: Write failing tests for create/update/delete asset commands**
- [x] **Step 2: Implement create asset command that adds resource, optional asset record, and asset canvas node**
- [x] **Step 3: Implement delete assets command that removes selected asset nodes and lineage edges in one transaction**
- [x] **Step 4: Implement move/resize asset commands**
- [ ] **Step 5: Wire store actions to asset commands without changing UI yet**

Run: `npm test -- --run src/domain/commands/assetCommands.test.ts src/store/projectStore.test.ts`

Expected: pass.

## Task 4: Run Snapshot Model

**Files:**
- Create: `src/domain/runs/runSnapshot.ts`
- Create: `src/domain/runs/runSnapshot.test.ts`
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Write failing tests for run snapshot normalization**
- [ ] **Step 2: Add `RunSnapshot` and provider discriminants**
- [ ] **Step 3: Add helpers to derive output resource source metadata from `runId/outputKey`**
- [ ] **Step 4: Add tests that generated resources no longer need `functionNodeId/resultGroupNodeId`**

Run: `npm test -- --run src/domain/runs/runSnapshot.test.ts`

Expected: pass.

## Task 5: Pending Output Asset Builder

**Files:**
- Create: `src/domain/runs/runCommands.ts`
- Create: `src/domain/runs/runCommands.test.ts`
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Write failing tests that a run creates pending asset nodes immediately**
- [ ] **Step 2: Implement pending resource value creation for text/number/image/video/audio**
- [ ] **Step 3: Implement output asset node placement**
- [ ] **Step 4: Implement initial input-to-output lineage edges**

Run: `npm test -- --run src/domain/runs/runCommands.test.ts`

Expected: pass.

## Task 6: Provider Adapter Interface

**Files:**
- Create: `src/domain/runs/runOrchestrator.ts`
- Create: `src/domain/runs/runOrchestrator.test.ts`
- Create: `src/domain/runs/adapters/*.ts`

- [ ] **Step 1: Write failing adapter contract tests**
- [ ] **Step 2: Implement provider-neutral adapter interface**
- [ ] **Step 3: Move provider-specific request preparation behind adapters**
- [ ] **Step 4: Keep existing provider domain modules pure and reusable**
- [ ] **Step 5: Test each adapter with existing provider tests**

Run: `npm test -- --run src/domain/runs/runOrchestrator.test.ts src/domain/*Image*.test.ts src/domain/*Llm*.test.ts src/domain/requestFunction.test.ts src/domain/localTransforms.test.ts`

Expected: pass. If `localTransforms.test.ts` does not exist, add focused local transform adapter tests instead.

## Task 7: Dependency Resolver

**Files:**
- Create: `src/domain/runs/dependencyResolver.ts`
- Create: `src/domain/runs/dependencyResolver.test.ts`
- Modify: `src/store/projectStore.ts`

- [ ] **Step 1: Write failing tests for deep pending dependency chains**
- [ ] **Step 2: Implement pending task resolution when upstream output assets succeed**
- [ ] **Step 3: Implement immediate downstream failure when upstream output assets fail**
- [ ] **Step 4: Wire resolver into task completion/failure store actions**

Run: `npm test -- --run src/domain/runs/dependencyResolver.test.ts src/store/projectStore.test.ts`

Expected: pass.

## Task 8: Asset Graph Projection

**Files:**
- Create: `src/domain/assetGraphProjection.ts`
- Create: `src/domain/assetGraphProjection.test.ts`
- Modify: `src/domain/canvasEdges.ts` or deprecate it.

- [ ] **Step 1: Write failing tests that projection emits only asset/group node types**
- [ ] **Step 2: Implement projection for asset nodes, group nodes, and lineage edges**
- [ ] **Step 3: Keep hidden React Flow handles as projection details**
- [ ] **Step 4: Remove business dependence on DOM handles**

Run: `npm test -- --run src/domain/assetGraphProjection.test.ts src/domain/canvasEdges.test.ts`

Expected: pass until `canvasEdges` is fully replaced, then delete old tests.

## Task 9: Function Command Modal

**Files:**
- Create: `src/components/functions/FunctionCommandModal.tsx`
- Create: `src/components/functions/InputTray.tsx`
- Create: `src/components/functions/SlotMapping.tsx`
- Create: `src/components/functions/FunctionParameters.tsx`
- Create: `src/components/functions/OutputPreviewStrip.tsx`
- Create tests beside each component.

- [ ] **Step 1: Write failing tests for automatic compatible slot fill**
- [ ] **Step 2: Implement Input Tray**
- [ ] **Step 3: Implement Slot Mapping**
- [ ] **Step 4: Implement provider parameter sections**
- [ ] **Step 5: Implement output strip with pending/final previews**
- [ ] **Step 6: Wire modal submit to `RunFunctionCommand`**

Run: `npm test -- --run src/components/functions`

Expected: pass.

## Task 10: Canvas UI Cutover

**Files:**
- Create/replace: `src/components/canvas/CanvasWorkspace.tsx`
- Create: `src/components/canvas/AssetNodeView.tsx`
- Create: `src/components/canvas/GroupNodeView.tsx`
- Create: `src/components/canvas/CanvasContextMenus.tsx`
- Create: `src/components/canvas/CanvasPickMode.tsx`
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing tests that canvas nodeTypes exclude function/result nodes**
- [ ] **Step 2: Implement asset/group node views using existing preview components**
- [ ] **Step 3: Implement context menu entry to open Function Command Modal**
- [ ] **Step 4: Implement Pick Mode**
- [ ] **Step 5: Replace old workspace import path**

Run: `npm test -- --run src/components/canvas src/components/CanvasWorkspace.test.ts`

Expected: pass.

## Task 11: Provider Migration

**Files:**
- Modify: `src/store/projectStore.ts`
- Modify: `src/domain/runs/adapters/*.ts`
- Test: `src/store/projectStore.test.ts`

- [ ] **Step 1: Write failing tests for every provider asserting no `function` or `result_group` canvas node is created**
- [ ] **Step 2: Migrate ComfyUI runs**
- [ ] **Step 3: Migrate OpenAI LLM runs**
- [ ] **Step 4: Migrate Gemini LLM runs**
- [ ] **Step 5: Migrate OpenAI image runs**
- [ ] **Step 6: Migrate Gemini image runs**
- [ ] **Step 7: Migrate HTTP request runs**
- [ ] **Step 8: Migrate local transform runs**

Run: `npm test -- --run src/store/projectStore.test.ts src/domain/runs`

Expected: pass.

## Task 12: Group and Template Migration

**Files:**
- Create/modify: `src/domain/commands/groupCommands.ts`
- Create/modify: `src/domain/commands/templateCommands.ts`
- Modify: `src/domain/types.ts`
- Test: `src/store/projectStore.test.ts`

- [ ] **Step 1: Write failing tests for group/ungroup asset nodes**
- [ ] **Step 2: Write failing tests for template recipe creation from asset subgraph**
- [ ] **Step 3: Implement group commands**
- [ ] **Step 4: Implement template recipe commands**
- [ ] **Step 5: Implement template instantiation as a new group containing cloned asset nodes**

Run: `npm test -- --run src/domain/commands/groupCommands.test.ts src/domain/commands/templateCommands.test.ts src/store/projectStore.test.ts`

Expected: pass.

## Task 13: Persistence Refactor

**Files:**
- Create: `src/domain/persistence/projectSerializer.ts`
- Create: `src/domain/persistence/projectPersistence.ts`
- Create tests beside them.
- Modify: `src/store/projectStore.ts`

- [ ] **Step 1: Write failing tests that UI-only state does not schedule persistence**
- [ ] **Step 2: Implement project revision tracking**
- [ ] **Step 3: Implement idle persistence scheduler**
- [ ] **Step 4: Implement unload flush**
- [ ] **Step 5: Remove full-store stringify from the hot notification path**

Run: `npm test -- --run src/domain/persistence src/store/projectPersistence.test.ts`

Expected: pass.

## Task 14: Remove Old Visible Node Paths

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/components/NodeViews.tsx`
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/store/projectStore.ts`
- Modify/delete obsolete tests.

- [ ] **Step 1: Write failing compile-time/runtime tests that legacy canvas node kinds are absent**
- [ ] **Step 2: Remove `function` and `result_group` from `CanvasNodeKind`**
- [ ] **Step 3: Remove `FunctionNodeView` and `ResultGroupNodeView` from active nodeTypes**
- [ ] **Step 4: Remove `addFunctionNode`, `runLocalFunctionNode`, `rerunResultNode`, and result-node helpers**
- [ ] **Step 5: Delete or rewrite tests that assert old visible node behavior**

Run: `npm test -- --run`

Expected: pass.

## Task 15: Final Verification and Release

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run full tests**

Run: `npm test -- --run`

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 3: Run diff hygiene check**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 4: Rebuild Docker**

Run: `docker compose up -d --build`

Expected: container starts.

- [ ] **Step 5: Verify local service**

Run: `Invoke-WebRequest -Uri 'http://127.0.0.1:7930/' -UseBasicParsing -TimeoutSec 10`

Expected: HTTP 200.

- [ ] **Step 6: Commit, tag, and push**

Use the project tag rules:

- Bug fix: increment iteration.
- Feature/function change: increment minor.
- Page refactor: increment major.

For the full migration completion, use a major version tag because it is a page and architecture refactor.
