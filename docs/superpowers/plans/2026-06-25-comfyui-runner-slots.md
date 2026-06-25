# ComfyUI Runner Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ComfyUI runner inputs reusable without overwhelming the run dialog: support boolean slots, default to media slots only, allow manual slot exposure, and show media previews beside selected input values.

**Architecture:** Keep ComfyUI workflow values inside the captured API workflow unless a user explicitly exposes a slot. The workflow domain provides reusable input-candidate metadata with type inference, while the run dialog owns temporary slot editing for one-off ComfyUI workflows.

**Tech Stack:** React, TypeScript, Zustand, Vitest, React Testing Library, embedded ComfyUI workflow capture.

---

### Task 1: Workflow Input Candidate Model

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/workflow.ts`
- Test: `src/domain/workflow.test.ts`

- [x] Add `boolean` to `ResourceType` and `PrimitiveInputValue`.
- [x] Add tests proving boolean workflow values can be injected into API JSON.
- [x] Add tests proving default ComfyUI function creation exposes image/video/audio inputs but does not expose text/number/boolean widget values by default.
- [x] Add a reusable workflow input candidate helper for manual slot creation with inferred `text | number | boolean | image | video | audio` type.

### Task 2: Run Dialog Slot Editing

**Files:**
- Modify: `src/components/CanvasWorkspace.tsx`
- Test: `src/components/CanvasWorkspace.test.tsx`

- [x] Add tests proving a temporary ComfyUI workflow runner shows media slots after save.
- [x] Add tests proving primitive slots can be manually added from workflow fields, including boolean fields.
- [x] Add tests proving manually added slots can be deleted so the workflow's captured value is used.
- [x] Implement ComfyUI-only slot editor controls in `FunctionRunDialog` when `onFunctionDefChange` is available.

### Task 3: Input Value Preview

**Files:**
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/styles.css`
- Test: `src/components/CanvasWorkspace.test.tsx`

- [x] Add tests proving image/video/audio input selections render previews next to the slot.
- [x] Render compact previews beside selected media input values.
- [x] Make the compact preview clickable and open the full resource preview modal.

### Task 4: Store and Compatibility

**Files:**
- Modify: `src/store/projectStore.ts`
- Modify: `src/store/projectStore.test.ts`
- Modify: any resource UI type lists that enumerate `ResourceType`

- [x] Ensure required boolean inputs validate correctly.
- [x] Ensure execution snapshots preserve boolean inline values.
- [x] Ensure legacy function node primitive editing accepts boolean where still reachable.
- [x] Ensure add-menu/resource type enumerations include boolean only where creating a boolean asset is valid.

### Task 5: Verification and Release

- [x] Run targeted tests for workflow, store, and canvas components.
- [x] Run full `npm test`.
- [x] Run `npm run build`.
- [x] Restart docker service on port 7930.
- [x] Run browser smoke tests where available.
- [x] Review `git status --short`.
- [x] Commit, create minor-version tag, and push branch plus tag.
