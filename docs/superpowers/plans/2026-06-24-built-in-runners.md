# Built-In Runners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct built-in runners for ComfyUI, Request, OpenAI, and Gemini so users can run them from the canvas menu without creating saved function templates.

**Architecture:** Introduce an in-memory temporary `GenerationFunction` execution path and keep saved function templates separate. Move ComfyUI workflow input/output detection into a reusable domain helper so both saved functions and temporary ComfyUI drafts share the same detection rules.

**Tech Stack:** React, TypeScript, Zustand, Vitest, React Testing Library, embedded ComfyUI iframe bridge.

---

## File Structure

- Modify `src/domain/workflow.ts`: add generalized ComfyUI input/output detection for text, number, image, video, and audio; keep `createGenerationFunctionFromWorkflow` as the public factory.
- Modify `src/domain/workflow.test.ts`: add RED tests for video, audio, and numeric input detection.
- Modify `src/store/projectStore.ts`: add `runTemporaryFunctionAtPosition` to execute a provided `GenerationFunction` draft without storing it in `project.functions`.
- Modify `src/store/projectStore.test.ts`: verify temporary functions run and are not persisted.
- Modify `src/components/CanvasWorkspace.tsx`: split add menu into Built-in and Functions sections; add temporary runner state; reuse `FunctionRunDialog`; add a ComfyUI temporary workflow dialog.
- Modify or add `src/components/CanvasWorkspace.test.tsx`: verify built-in menu entries open run dialogs without creating function templates and ComfyUI draft inputs appear after saving.
- Modify `src/styles.css`: add small section labels and ComfyUI runner layout styles.

---

### Task 1: Expand ComfyUI Input Detection

**Files:**
- Modify: `src/domain/workflow.ts`
- Test: `src/domain/workflow.test.ts`

- [x] **Step 1: Write failing tests**

Add tests showing `createGenerationFunctionFromWorkflow` detects:

- a numeric primitive field as a `number` input
- a video loader input as a `video` input
- an audio loader input as an `audio` input

Run:

```bash
npm test -- src/domain/workflow.test.ts
```

Expected: FAIL because these inputs are not currently detected.

- [x] **Step 2: Implement detection**

Update `workflow.ts` to:

- ignore graph links like `[sourceNodeId, outputIndex]`
- detect friendly prompt/image cases first
- detect remaining primitive text/number/media inputs by class name, input name, and node title
- generate stable input keys and labels
- avoid duplicate bind paths

- [x] **Step 3: Verify**

Run:

```bash
npm test -- src/domain/workflow.test.ts
```

Expected: PASS.

---

### Task 2: Add Temporary Function Execution

**Files:**
- Modify: `src/store/projectStore.ts`
- Test: `src/store/projectStore.test.ts`

- [x] **Step 1: Write failing test**

Add a store test that creates a ComfyUI `GenerationFunction` draft object, calls `runTemporaryFunctionAtPosition`, and verifies:

- output/result nodes are created
- the draft id is not added to `project.functions`
- output resource metadata keeps the draft function id or embedded workflow metadata needed for rerun

Run:

```bash
npm test -- src/store/projectStore.test.ts
```

Expected: FAIL because the action does not exist.

- [x] **Step 2: Implement action**

Add `runTemporaryFunctionAtPosition(functionDef, inputValues, position, runCount)` and route it through the same execution branches as saved functions.

Implementation notes:

- Reuse as much of `runFunctionAtPosition` as possible.
- Do not add `functionDef` to `project.functions`.
- Ensure task snapshots store the function definition fields needed for inspectors and rerun.
- Keep existing saved function behavior unchanged.

- [x] **Step 3: Verify**

Run:

```bash
npm test -- src/store/projectStore.test.ts
```

Expected: PASS.

---

### Task 3: Add Built-In Runner Menu Entries

**Files:**
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/styles.css`
- Test: `src/components/CanvasWorkspace.test.tsx`

- [x] **Step 1: Write failing component tests**

Test that the add menu shows a `Built-in` section with:

- ComfyUI Workflow
- Request
- OpenAI LLM
- Gemini LLM
- OpenAI Image
- Gemini Image

Test that saved user functions remain under a `Functions` section.

Run:

```bash
npm test -- src/components/CanvasWorkspace.test.tsx
```

Expected: FAIL because the sections and ComfyUI entry do not exist.

- [x] **Step 2: Implement menu split**

In `CanvasWorkspace.tsx`:

- derive built-in runner options from existing built-in function ids plus a new ComfyUI workflow option
- filter built-in runners by connection resource type
- keep saved custom functions as templates under `Functions`
- close the menu when a runner is chosen

- [x] **Step 3: Verify**

Run:

```bash
npm test -- src/components/CanvasWorkspace.test.tsx
```

Expected: PASS.

---

### Task 4: Add Request/OpenAI/Gemini Temporary Runner Flow

**Files:**
- Modify: `src/components/CanvasWorkspace.tsx`
- Test: `src/components/CanvasWorkspace.test.tsx`

- [x] **Step 1: Write failing tests**

Add tests that selecting Request, OpenAI LLM, and Gemini LLM opens the run dialog and does not change `project.functions`.

Run:

```bash
npm test -- src/components/CanvasWorkspace.test.tsx
```

Expected: FAIL until temporary runner state is implemented.

- [x] **Step 2: Implement temporary runner state**

In `CanvasWorkspace.tsx`:

- add a dialog state that can hold a `GenerationFunction` object as well as a saved `functionId`
- use existing `FunctionRunDialog` for both cases
- call `runTemporaryFunctionAtPosition` for temporary functions
- keep `runFunctionAtPosition` for saved functions

- [x] **Step 3: Verify**

Run:

```bash
npm test -- src/components/CanvasWorkspace.test.tsx
```

Expected: PASS.

---

### Task 5: Add Temporary ComfyUI Workflow Runner

**Files:**
- Modify: `src/components/CanvasWorkspace.tsx`
- Modify: `src/components/WorkbenchPanels.tsx` if shared ComfyUI editor components need exporting
- Modify: `src/styles.css`
- Test: `src/components/CanvasWorkspace.test.tsx`

- [x] **Step 1: Write failing tests**

Add a component test for the ComfyUI runner dialog:

- choose `ComfyUI Workflow` from the menu
- simulate saving an API workflow draft
- verify input selectors appear for text, number, image, video, and audio when present in the workflow

Run:

```bash
npm test -- src/components/CanvasWorkspace.test.tsx
```

Expected: FAIL because the dialog does not exist.

- [x] **Step 2: Extract shared editor if needed**

If `ComfyWorkflowEditorDialog` is private to `WorkbenchPanels.tsx`, either export it cleanly or move it to a focused component module.

- [x] **Step 3: Implement dialog**

Add a `TemporaryComfyRunnerDialog` that:

- selects an enabled ComfyUI endpoint
- opens the embedded editor
- saves UI/API workflow into local state
- creates a temporary `GenerationFunction` with `createGenerationFunctionFromWorkflow`
- shows `FunctionRunDialog` fields after capture
- runs through `runTemporaryFunctionAtPosition`

- [x] **Step 4: Verify**

Run:

```bash
npm test -- src/components/CanvasWorkspace.test.tsx
```

Expected: PASS.

---

### Task 6: Full Verification and Release

**Files:**
- All changed files

- [x] **Step 1: Run focused tests**

```bash
npm test -- src/domain/workflow.test.ts src/store/projectStore.test.ts src/components/CanvasWorkspace.test.tsx
```

- [x] **Step 2: Run full tests**

```bash
npm test
```

- [x] **Step 3: Run build**

```bash
npm run build
```

- [x] **Step 4: Restart Docker**

```bash
docker compose -f docker-compose.yml up -d --build
```

- [x] **Step 5: Browser smoke**

Open `http://127.0.0.1:7930`, verify the add menu exposes Built-in runners and at least one built-in opens the run dialog.

- [x] **Step 6: Commit, tag, push**

Use a feature tag bump from the current latest tag.

```bash
git status --short
git add <changed files>
git commit -m "Add built-in runner workflows"
git tag v5.3.0
git push origin master
git push origin v5.3.0
```
