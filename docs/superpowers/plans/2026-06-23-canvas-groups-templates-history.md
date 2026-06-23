# Canvas Groups Templates History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted visual operation history, robust undo/redo, and first-class canvas group/ungroup operations as the foundation for later template workflows.

**Architecture:** Store project-changing transactions inside `ProjectState.history` with serializable snapshot entries. Add focused store commands for group/ungroup and update the left dock UI to expose assets and history as sibling popovers.

**Tech Stack:** React 19, TypeScript, Zustand, React Flow, Vitest, Testing Library.

---

### Task 1: Persistent History Types and Store Actions

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/store/projectStore.ts`
- Test: `src/store/projectStore.test.ts`

- [ ] Step 1: Add failing tests for project-persisted history and redo after undo.
- [ ] Step 2: Run `npm test -- src/store/projectStore.test.ts --runInBand` or the closest Vitest equivalent for the targeted test.
- [ ] Step 3: Add `ProjectHistoryState`, `ProjectHistoryEntry`, and preview types to `src/domain/types.ts`.
- [ ] Step 4: Initialize `project.history` in new projects and hydrate missing history for old projects.
- [ ] Step 5: Replace or wrap `undoLastProjectChange` so it uses persisted project history and add `redoProjectChange`.
- [ ] Step 6: Run targeted store tests.

### Task 2: Command Recording for Core Operations

**Files:**
- Modify: `src/store/projectStore.ts`
- Test: `src/store/projectStore.test.ts`

- [ ] Step 1: Add failing tests proving add asset, connect, delete, and move commands create history entries with affected ids.
- [ ] Step 2: Introduce a store helper that captures before/after project snapshots as one transaction.
- [ ] Step 3: Record history in core user actions while avoiding duplicate entries for no-op updates.
- [ ] Step 4: Keep legacy tests passing by preserving `undoLastProjectChange` API.
- [ ] Step 5: Run targeted store tests.

### Task 3: Canvas Group and Ungroup

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/store/projectStore.ts`
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/components/NodeViews.tsx`
- Test: `src/store/projectStore.test.ts`
- Test: `src/components/NodeViews.test.tsx`

- [ ] Step 1: Add failing tests for grouping selected nodes, ungrouping, and undoing both actions.
- [ ] Step 2: Define typed group node data: title, child node ids, collapsed state, color, size.
- [ ] Step 3: Implement `groupSelectedNodes` and `ungroupNode`.
- [ ] Step 4: Add canvas context menu actions for Group Selection and Ungroup.
- [ ] Step 5: Update group node rendering to show title and count.
- [ ] Step 6: Run store and node view tests.

### Task 4: History Dock UI

**Files:**
- Modify: `src/components/WorkbenchPanels.tsx`
- Modify: `src/styles.css`
- Test: `src/components/WorkbenchPanels.test.tsx`

- [ ] Step 1: Add failing UI tests for the History button, popover, command rows, asset previews, undo, and redo.
- [ ] Step 2: Refactor the left dock to support stacked dock buttons.
- [ ] Step 3: Render command preview rows using `project.history.undoStack` and `redoStack`.
- [ ] Step 4: Wire row double-click to focus affected nodes and asset thumbnail click to preview resources.
- [ ] Step 5: Run WorkbenchPanels tests.

### Task 5: Verification and Release

**Files:**
- Any changed source/test/docs files from prior tasks.

- [ ] Step 1: Run `npm run build`.
- [ ] Step 2: Rebuild and restart the Docker service on port `7930`.
- [ ] Step 3: Use browser verification to check assets dock, history dock, group/ungroup, and undo/redo.
- [ ] Step 4: Check `git status --short` and avoid touching unrelated `docker-compose.yml` user changes unless necessary.
- [ ] Step 5: Commit changes.
- [ ] Step 6: Create the next feature tag using `v大.小.迭代号`.
- [ ] Step 7: Push branch and tag.
