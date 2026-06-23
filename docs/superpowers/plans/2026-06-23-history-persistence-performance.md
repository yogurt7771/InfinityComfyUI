# History Persistence Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce canvas jank caused by large history snapshots, real-time persistence, and eager history-list rendering.

**Architecture:** Keep live project resources behavior unchanged, but compact history snapshots so asset blob/data URLs are not duplicated into every undo entry. Restore compact snapshots by hydrating media resource URLs from the project asset library. Persist project state only after 5 seconds of idle changes, and render the history dock from a lightweight summary that updates when the popover opens or after an idle delay.

**Tech Stack:** TypeScript, React, Zustand store, Vitest, IndexedDB/Electron persistence bridge.

---

### Task 1: Compact History Snapshots

**Files:**
- Modify: `src/store/projectStore.ts`
- Test: `src/store/projectStore.test.ts`

- [x] Add a failing store test that creates a media resource with a data URL and asserts history `before/after` snapshots do not contain the data URL.
- [x] Implement history snapshot compaction by stripping `assets[*].blobUrl`, media `value.url`, and media `value.thumbnailUrl` from history snapshots.
- [x] Hydrate compact snapshots during undo/redo by merging the current project asset library back into restored resources.
- [x] Run the targeted store tests.

### Task 2: Idle Persistence

**Files:**
- Modify: `src/store/projectStore.ts`
- Test: `src/store/projectPersistence.test.ts`

- [x] Update persistence tests to expect no save before 5 seconds of no changes.
- [x] Replace immediate IndexedDB writes and 250ms desktop writes with a shared 5000ms idle-save scheduler.
- [x] Keep startup-load protection and `beforeunload` flush behavior.
- [x] Run persistence tests.

### Task 3: Lightweight History Dock

**Files:**
- Modify: `src/components/WorkbenchPanels.tsx`
- Test: `src/components/WorkbenchPanels.test.tsx`

- [x] Add/update a test that keeps the history popover closed while project history changes and verifies the list is populated only when opened.
- [x] Derive history rows into lightweight objects containing only ids, labels, preview ids, stack, and display text.
- [x] Refresh history rows when the popover opens and after a 5 second idle delay while it remains open.
- [x] Run Workbench panel tests.

### Task 4: Verification and Release

**Files:**
- Verify all changed files.

- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] Rebuild Docker with `docker compose up -d --build`.
- [x] Confirm `http://127.0.0.1:7930/` returns 200.
- [ ] Commit, tag the feature/performance change as the next minor version, and push.
