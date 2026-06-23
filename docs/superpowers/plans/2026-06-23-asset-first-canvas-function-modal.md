# Asset-First Canvas Function Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the first working slice so function runs are launched through a modal and the visible canvas contains only assets, pending assets, and groups.

**Architecture:** Keep function definitions and execution tasks as data-layer concepts. Replace visible function/result-group workflow nodes with asset nodes plus task snapshots. Derive visible asset-to-asset lineage edges from task input/output refs.

**Tech Stack:** React 19, TypeScript, Zustand, React Flow, Vitest, Testing Library, Docker Compose.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-06-23-asset-first-canvas-function-modal-design.md`
- Existing related spec: `docs/superpowers/specs/2026-06-23-canvas-groups-templates-history-design.md`

## File Responsibilities

- `src/domain/types.ts`: project-level data model for resources, tasks, run snapshots, canvas nodes, groups, templates, and history.
- `src/domain/canvasEdges.ts`: convert project state into React Flow edges, including asset lineage edges.
- `src/store/projectStore.ts`: create assets, run functions, create pending assets, finalize outputs, update history, and manage task dependency resolution.
- `src/components/CanvasWorkspace.tsx`: React Flow surface, function menu, function command modal, pick mode, and visible-node filtering.
- `src/components/NodeViews.tsx`: asset, pending asset, and group visual rendering.
- `src/components/ResourcePreviewModal.tsx`: full asset preview.
- `src/styles.css`: modal, asset, edge, picker, and group presentation.
- Tests mirror the above files.

## Task 1: Lock Visible Canvas Rules

Status: completed in this slice.

**Files:**
- Modify: `src/components/CanvasWorkspace.test.ts`
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/domain/canvasEdges.test.ts`
- Modify: `src/domain/canvasEdges.ts`

- [x] Step 1: Add a failing test proving visible canvas nodes include only `resource` and `group`.
- [x] Step 2: Add a failing test proving asset lineage edges connect resource nodes through task input/output refs.
- [x] Step 3: Run targeted tests and verify they fail for the expected reason.
- [x] Step 4: Implement visible node filtering and lineage edge derivation.
- [x] Step 5: Run targeted tests and verify they pass.

## Task 2: Function Command Modal Input Drafts

Status: completed for the first function-command slice, including Excel-style canvas asset picking.

**Files:**
- Modify: `src/components/CanvasWorkspace.test.ts`
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/styles.css`

- [x] Step 1: Add a failing test for auto-filling function inputs from selected assets in function input order.
- [ ] Step 2: Add a failing test for leaving unmatched assets in the modal tray model.
- [x] Step 3: Implement input draft construction from selected resource refs.
- [x] Step 4: Implement the first Function Command Modal with Input Tray, Slot Mapping, primitive parameter fields, and Run action.
- [x] Step 5: Implement Pick Mode so a slot can select a compatible asset directly from the canvas.
- [x] Step 6: Run component tests.

## Task 3: Run Functions Without Visible Function Nodes

Status: completed for local-transform and ComfyUI API workflow command runs.

**Files:**
- Modify: `src/store/projectStore.test.ts`
- Modify: `src/store/projectStore.ts`
- Modify: `src/domain/types.ts`

- [x] Step 1: Add a failing test proving `runFunctionFromCommand` creates pending output asset nodes and no visible `function` or `result_group` nodes.
- [x] Step 2: Add a failing test proving completed local-transform output updates the pending asset and task output refs.
- [ ] Step 3: Add a failing test proving failed execution marks pending output asset as failed.
- [x] Step 4: Implement a data-layer run command that creates internal task records and visible pending assets.
- [x] Step 5: Adapt local transform execution first because it is deterministic and fast.
- [x] Step 6: Run targeted store tests.

## Task 4: Generated Asset Snapshot Entry

Status: completed with current task/resource metadata snapshots.

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/store/projectStore.test.ts`
- Modify: `src/store/projectStore.ts`
- Modify: `src/components/NodeViews.tsx`
- Modify: `src/components/CanvasWorkspace.tsx`

- [x] Step 1: Add a failing test proving generated assets store a run snapshot with function, inputs, parameters, task id, and workflow snapshot.
- [x] Step 2: Add a failing UI test or helper test proving generated asset actions can open a function modal prefilled from the snapshot.
- [x] Step 3: Extend resource metadata/source with a run snapshot structure.
- [x] Step 4: Render a compact function chip on generated assets.
- [x] Step 5: Wire chip click to open Function Command Modal from the saved snapshot.
- [x] Step 6: Run targeted tests.

## Task 5: Remove Old Visible Function Entry Points

Status: completed for the new asset-first entry points. Legacy helper code remains internal.

**Files:**
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/components/NodeViews.tsx`
- Modify: `src/store/projectStore.ts`
- Test: relevant component and store tests

- [x] Step 1: Add a failing test proving add-function from the canvas opens the modal instead of creating a function node.
- [x] Step 2: Remove user-facing right-click function-node actions from the asset-first flow.
- [x] Step 3: Merge resource quick actions into the same Function Command Modal path.
- [x] Step 4: Keep old function execution helpers only as internal implementation details where unavoidable.
- [x] Step 5: Run targeted tests.

## Task 6: Browser Verification

Status: completed.

**Files:**
- Any changed source/test/style files.

- [x] Step 1: Run `npm test`.
- [x] Step 2: Run `npm run build`.
- [x] Step 3: Rebuild and restart Docker with `docker compose up -d --build`.
- [x] Step 4: Use browser automation on `http://127.0.0.1:7930`.
- [x] Step 5: Verify double-click canvas opens add menu.
- [x] Step 6: Verify choosing a function opens the modal and no function node appears.
- [x] Step 7: Verify running a local text function creates visible asset output and asset-to-asset lineage.
- [x] Step 8: Verify slot Pick Mode selects a canvas asset, restores the function modal, and unlocks Run.
- [x] Step 9: Capture a screenshot for visual inspection.

## Task 7: Release

Status: pending until commit, tag, and push complete.

**Files:**
- All changed files.

- [ ] Step 1: Run `git diff --check`.
- [ ] Step 2: Run `git status --short` and confirm only related files changed.
- [ ] Step 3: Commit the implementation.
- [ ] Step 4: Create the next minor feature tag using `v大.小.迭代号`.
- [ ] Step 5: Push the current branch and tag.
