# Asset-First Canvas Validation Checklist

Last updated: 2026-06-24

Status values:

- `TODO`: not fully verified against this checklist yet.
- `DOING`: currently being implemented or verified.
- `PASS`: verified and passing.
- `FAIL`: verified and failing.
- `BLOCKED`: cannot verify without external dependency or user input.

## Scope

The product target is an asset-first canvas:

- The canvas displays only asset cards and canvas groups.
- Functions are run through popups and menus, not persistent visible function nodes.
- A function run creates output asset cards that retain enough function/run information to edit and run again.
- Asset lineage is shown as asset-to-asset edges.
- All graph-changing operations are undoable, visible in history, and persisted with the project.

## Acceptance Items

| ID | Status | Requirement | Verification |
| --- | --- | --- | --- |
| A01 | PASS | App loads on port 7930 and shows the asset canvas workspace. | `Invoke-WebRequest http://127.0.0.1:7930/`; browser smoke. |
| A02 | PASS | Canvas renders no visible `function` or `result_group` React Flow nodes. | Browser smoke checks `.react-flow__node-function` and `.react-flow__node-result_group` count is 0. |
| A03 | PASS | Asset cards render as bounded styled cards, not bare text, and page never shows `[object Object]`. | Browser smoke and `styles.test.ts`. |
| A04 | PASS | Native `asset` canvas nodes project into the visible asset graph. | `CanvasWorkspace.test.tsx` native asset projection test. |
| A05 | PASS | Native canvas lineage edges project into visible asset-to-asset graph edges. | `CanvasWorkspace.test.tsx` native lineage projection test. |
| A06 | PASS | Blank canvas right-click opens the asset creation menu. | `CanvasWorkspace.test.tsx`; browser smoke. |
| A07 | PASS | Asset node right-click opens compatible function menu and does not show asset creation actions. | `CanvasWorkspace.test.tsx`; browser smoke. |
| A08 | PASS | Asset node function menu filters functions by selected asset type for text, number, image, video, and audio. | `CanvasContextMenus.test.tsx` covers the full type matrix. |
| A09 | PASS | Creating a text asset from the canvas creates a canvas card, resource entry, assets/history entry where applicable, and survives refresh. | `projectStore.test.ts` covers text asset creation/resource/library/history; browser smoke covers refresh persistence path. |
| A10 | PASS | Creating a number asset from the canvas creates a canvas card, resource entry, assets/history entry where applicable, and survives refresh. | `projectStore.test.ts` covers number asset creation/resource/library/history; browser smoke covers refresh persistence path. |
| A11 | PASS | Creating an image asset from the canvas creates a canvas card, resource entry, assets/history entry where applicable, and survives refresh. | `projectStore.test.ts` covers image asset creation/resource/library/history; browser smoke covers refresh persistence path. |
| A12 | PASS | Creating a video asset from the canvas creates a canvas card, resource entry, assets/history entry where applicable, and survives refresh. | `projectStore.test.ts` covers video asset creation/resource/library/history; browser smoke covers refresh persistence path. |
| A13 | PASS | Creating an audio asset from the canvas creates a canvas card, resource entry, assets/history entry where applicable, and survives refresh. | `projectStore.test.ts` covers audio asset creation/resource/library/history; browser smoke covers refresh persistence path. |
| A14 | PASS | Dropping one supported file onto blank canvas creates one matching asset card for image, video, audio, and text-like files. | `resourceFiles.test.ts` covers image/video/audio type detection; `CanvasWorkspace.test.tsx` and browser smoke cover drop-to-canvas creation. |
| A15 | PASS | Dropping multiple files onto blank canvas creates a vertically arranged asset batch. | Browser smoke covers image + text; store tests cover positions. |
| A16 | PASS | A batch file drop is recorded as one history operation, not one operation per file. | `projectStore.test.ts`. |
| A17 | PASS | Unsupported dropped files do not create broken assets and show a user-visible feedback path. | `CanvasWorkspace.test.tsx` verifies skipped/failed files show `role=status` feedback and do not create resources. |
| A18 | PASS | Dropping a supported file onto an existing asset replaces that asset content without creating another asset node. | Browser smoke and `CanvasWorkspace.test.tsx`. |
| A19 | PASS | Replacing an asset preserves node position, selected state, function entry point, and undo restores the previous content. | `projectStore.test.ts` verifies replacement preserves node identity/position/selection and undo; `CanvasWorkspace.test.tsx` covers file drop replacement and function entry point. |
| A20 | PASS | Asset cards expose only the intended right-side visible slot/entry point; removing the old left slot must not break edge rendering. | `assetGraphProjection.test.ts` verifies hidden technical handles and lineage edge projection; `AssetNodeView.tsx` keeps handles invisible while the card exposes the function entry/menu surface. |
| A21 | PASS | Asset-to-asset lineage edges are visible after function runs and after loading saved projects. | `CanvasWorkspace.test.tsx` and `assetGraphProjection.test.ts` verify native lineage projection; browser smoke verifies persisted edge rendering after reload. |
| A22 | PASS | Deleting asset cards removes touching lineage edges, and undo restores nodes and edges in one operation. | `assetCommands.test.ts` and `projectStore.test.ts` verify delete/undo restores deleted source nodes, edges, and bindings as one command. |
| A23 | PASS | Running a function from selected assets opens a popup with selected assets prefilled in selection order. | `CanvasWorkspace.test.tsx` verifies selected asset commands open the function popup with selected inputs; `FunctionCommandModal.test.tsx` verifies ordered auto-assignment/reorder. |
| A24 | PASS | Function popup supports choosing canvas assets for each required asset input using an Excel-like picking flow. | `CanvasWorkspace.test.tsx` verifies pick-from-canvas replacement flow; `FunctionCommandModal.test.tsx` verifies picked resources populate the target slot. |
| A25 | PASS | Function popup input gallery shows every selected input asset, supports preview, remove, and reorder. | `FunctionCommandModal.test.tsx` verifies tray preview, full preview, remove payload cleanup, and reorder slot remapping. |
| A26 | PASS | Function popup run creates output asset cards, not function/result nodes. | `FunctionCommandModal.test.tsx`, `CanvasWorkspace.tsx`, and `projectStore.test.ts` verify modal submission creates asset outputs without visible function/result nodes. |
| A27 | PASS | Output assets store function/run metadata and can reopen the same function popup prefilled for edit-and-run. | `CanvasWorkspace.test.tsx` verifies generated asset function chip opens the saved function popup with snapshot inputs and submits through the run action. |
| A28 | PASS | Rerun and edit-and-run are merged into one clear action. | `CanvasWorkspace.test.tsx` verifies generated asset function chip opens the saved function popup with snapshot inputs and submits through one run action. |
| A29 | PASS | A run waiting on upstream running assets enters pending state and automatically runs when dependencies succeed. | `dependencyResolver.test.ts` and `projectStore.test.ts` cover pending resume. |
| A30 | PASS | If an upstream dependency fails, dependent pending runs fail immediately. | `dependencyResolver.test.ts` and `projectStore.test.ts` cover dependency failure propagation. |
| A31 | PASS | Dependency waiting supports arbitrarily deep asset dependency chains. | `dependencyResolver.test.ts` and `projectStore.test.ts` cover root -> middle -> leaf chains. |
| A32 | PASS | Running output asset cards show queued/running/succeeded/failed status. | `CanvasWorkspace.test.tsx` and `AssetNodeView.test.tsx` verify generated asset run status rendering. |
| A33 | PASS | Running asset duration continuously increases while running and final duration remains on completion. | `CanvasWorkspace.test.tsx` verifies live running duration ticks from 2s to 4s; failed/completed duration remains visible. |
| A34 | PASS | Failed asset cards expose error details. | `CanvasWorkspace.test.tsx` and `AssetNodeView.test.tsx` verify failed asset error details render with `role=alert`. |
| A35 | PASS | Every preview surface is clickable and opens a full preview for text, number, image, video, and audio. | `ResourcePreview.test.tsx` covers full preview modal for text/number/image/video/audio; asset/dock/history/input/output preview tests cover clickable surfaces. |
| A36 | PASS | Asset card preview opens a modal and Esc closes it. | Browser smoke and `CanvasWorkspace.test.tsx`. |
| A37 | PASS | Assets dock/list item click opens preview; double-click jumps to the corresponding asset node. | `WorkbenchPanels.test.tsx` covers click preview and double-click locate. |
| A38 | PASS | History list items show asset previews where relevant and can jump to related canvas assets. | `WorkbenchPanels.test.tsx` verifies history preview click opens modal and history item double-click selects/focuses the related asset node. |
| A39 | PASS | Refs popover previews all resource types and closes on blur. | `AssetNodeView.test.tsx` verifies refs popover previews text/number/image/video/audio, opens full preview, and closes on blur. |
| A40 | PASS | Function input gallery and output gallery previews open full preview and close with Esc. | `FunctionCommandModal.test.tsx` verifies input tray and output gallery full-preview behavior; `ResourcePreview.test.tsx` verifies Esc close. |
| A41 | PASS | Canvas pan/zoom viewport changes are not recorded as history operations. | `CanvasWorkspace.test.tsx` verifies minimap/viewport movement calls React Flow viewport APIs without adding history entries. |
| A42 | PASS | Asset placement/move/resize operations are recorded as graph history operations. | `assetCommands.test.ts`, `projectStore.test.ts`, and `CanvasWorkspace.test.tsx` verify create/move/resize/drag operations record graph history. |
| A43 | PASS | Batch operations, such as deleting multiple selected assets, produce one history entry. | `commandHistory.test.ts` and `projectStore.test.ts` cover multi-node delete as one command. |
| A44 | PASS | History entries include sequence number, operation time, duration when a run is involved, and asset previews where relevant. | `WorkbenchPanels.tsx` and `WorkbenchPanels.test.tsx` cover sequence/time/duration/previews. |
| A45 | PASS | History snapshots do not embed full asset content; they reference assets by stable keys. | `projectStore.test.ts` and `commandHistory.test.ts` cover compact history snapshots and hydration. |
| A46 | PASS | Asset library owns all asset content; asset nodes and history resolve content by key. | `projectStore.test.ts` verifies primitive assets live in `project.assets`; preview tests verify UI resolves by key. |
| A47 | PASS | Project persistence is debounced after inactivity and does not constantly write when idle. | `projectPersistence.test.ts` and `store/projectPersistence.test.ts` cover 5s idle debounce and no-op saves. |
| A48 | PASS | Refreshing the page restores the latest graph, assets, history, undo, and redo state. | Browser smoke verifies asset graph/position/preview state survives reload; store tests verify project history undo/redo hydration. |
| A49 | PASS | Groups can be created directly on canvas, moved as a group, run as a group where applicable, deleted, and ungrouped. | `groupCommands.test.ts` and `projectStore.test.ts` cover create/move/delete/ungroup/group-run state paths. |
| A50 | PASS | Saving a selected subgraph as a template and creating it back onto canvas creates a new group instance. | `templateCommands.test.ts` and `projectStore.test.ts` cover template save/create producing grouped canvas instances. |
| A51 | PASS | Group and template are independent features; ungrouping works for any group, including template-created groups. | `groupCommands.test.ts`, `templateCommands.test.ts`, and store tests cover independent group/template behavior and ungroup. |
| A52 | PASS | ComfyUI editor opens when the ComfyUI instance is password-protected. | `comfyProxy.test.ts` verifies password token parsing/proxying; embedded editor tests verify the editor opens through the proxied endpoint path. |
| A53 | PASS | Creating a new function is fully handled through embedded ComfyUI, not manual workflow JSON entry. | `WorkbenchPanels.test.tsx` verifies no manual Workflow JSON textbox and saving from embedded ComfyUI capture. |
| A54 | PASS | Editing a function uses a selected compatible ComfyUI endpoint and can save UI workflow and API workflow separately. | `WorkbenchPanels.test.tsx` verifies embedded editor, selected endpoint use, UI workflow capture, and API workflow capture. |
| A55 | PASS | Multiple ComfyUI endpoints can be bound per function, and create/edit/run uses the selected compatible endpoint. | `WorkbenchPanels.test.tsx` and store tests verify function endpoint binding and selected compatible endpoint usage. |
| A56 | PASS | Minimap adapts to node count, shows viewport rectangle, and can drag viewport. | `CanvasMinimap.tsx` renders node/edge thumbnails plus a draggable viewport rectangle; `CanvasWorkspace.test.tsx` verifies drag calls React Flow viewport API without history writes. |
| A57 | PASS | The light theme remains the default, and the theme switch works without layout regressions. | `App.test.tsx` verifies default light theme and theme toggle; browser smoke verifies workspace layout remains usable. |
| A58 | PASS | Build, unit tests, browser smoke, Docker service startup, and HTTP health all pass after all fixes. | Final verification log below records fresh `npm test`, `npm run build`, browser smoke, Docker build/start, HTTP 200, and Docker browser smoke. |
| A59 | PASS | Asset nodes can be dragged on the canvas; dropping a node updates its position, records exactly one graph/history operation, keeps existing lineage edges usable, and survives refresh. | `CanvasWorkspace.test.tsx`, `projectStore.test.ts`, and browser smoke verify drag writeback, one history entry, lineage preservation, and refresh persistence. |

## Verification Log

| Time | Command / Check | Result | Notes |
| --- | --- | --- | --- |
| 2026-06-24 | `npm test` | PASS | 46 test files, 281 tests passed before this checklist was created. Must rerun after final changes. |
| 2026-06-24 | `npm run build` | PASS | TypeScript and Vite build passed before this checklist was created. Vite emitted chunk-size warning only. Must rerun after final changes. |
| 2026-06-24 | Docker compose build/start | PASS | Current service recreated and exposed `0.0.0.0:7930->7930/tcp`. Must recheck after final changes. |
| 2026-06-24 | `Invoke-WebRequest http://127.0.0.1:7930/` | PASS | HTTP 200 before this checklist was created. Must recheck after final changes. |
| 2026-06-24 | `npm run browser:smoke -- --reporter=line` | PASS | Asset-first browser smoke passed after replacing old smoke spec. Must rerun after final changes. |
| 2026-06-24 | `npm test -- src/components/canvas/CanvasContextMenus.test.tsx src/components/canvas/CanvasWorkspace.test.tsx -t "filters asset node\|unsupported\|fail to read"` | PASS | Verified A08 full type filtering and A17 unsupported/failed drop feedback. |
| 2026-06-24 | `npm test -- src/components/canvas/CanvasWorkspace.test.tsx -t "dragged asset node"` | PASS | Verified A59 unit path: drag-end updates position and records one history entry. |
| 2026-06-24 | `npm test -- src/components/canvas/CanvasWorkspace.test.tsx src/store/projectStore.test.ts -t "dragged asset node\|native asset node moves"` | PASS | Verified A59 store path: drag-end history plus native asset lineage preservation. |
| 2026-06-24 | `npm run browser:smoke -- --reporter=line` | PASS | Verified A59 browser path: real asset drag updates position and survives reload. |
| 2026-06-24 | `npm test -- src/components/canvas/CanvasWorkspace.test.tsx src/components/canvas/AssetNodeView.test.tsx -t "generated asset\|duration"` | PASS | Verified A32-A34: generated asset status, source function, live duration, final duration, and failed error details. |
| 2026-06-24 | `npm test -- src/store/projectStore.test.ts` | PASS | Verified A46 data model: text/number resources are asset-backed, cloning/template/history restore preserve primitive asset content by key. |
| 2026-06-24 | `npm test -- src/components/ResourcePreview.test.tsx src/components/ResourcePreviewModal.tsx src/components/WorkbenchPanels.test.tsx src/components/functions/InputTray.test.tsx` | PASS | Verified A46 UI read paths resolve primitive asset content from the asset library. |
| 2026-06-24 | `npm test -- src/components/functions/FunctionCommandModal.test.tsx` | PASS | Verified A25 input gallery preview, remove, and reorder behavior. |
| 2026-06-24 | `npm test -- src/components/canvas/CanvasWorkspace.test.tsx src/components/canvas/AssetNodeView.test.tsx` | PASS | Verified A28 generated asset edit/run entry and A56 minimap drag behavior, plus asset card status regressions. |
| 2026-06-24 | `npm test -- src/components/ResourcePreview.test.tsx src/components/WorkbenchPanels.test.tsx src/domain/resourceFiles.test.ts src/store/projectStore.test.ts` | PASS | Verified A09-A14, A19, A35, and A38 with 4 files / 115 tests. |
| 2026-06-24 | `npm test -- src/domain/assetGraphProjection.test.ts src/domain/commands/assetCommands.test.ts src/domain/commands/groupCommands.test.ts src/domain/commands/templateCommands.test.ts` | PASS | Verified A20-A22, A42, and A49-A51 with 4 files / 12 tests. |
| 2026-06-24 | `npm test -- src/components/canvas/CanvasWorkspace.test.tsx src/components/functions/FunctionCommandModal.test.tsx` | PASS | Verified A23-A24, A27, and A40 with 2 files / 27 tests. |
| 2026-06-24 | `npm test -- src/components/canvas/AssetNodeView.test.tsx src/components/canvas/CanvasWorkspace.test.tsx` | PASS | Verified A39 and A41 with 2 files / 22 tests. |
| 2026-06-24 | `npm test -- src/components/functions/FunctionCommandModal.test.tsx src/components/canvas/AssetNodeView.test.tsx src/components/ResourcePreview.test.tsx` | PASS | Rechecked A35, A39, and A40 with 3 files / 15 tests after output-gallery preview wiring. |
| 2026-06-24 | `npm test` | PASS | Final full unit suite: 47 files, 298 tests. |
| 2026-06-24 | `npm run build` | PASS | Final TypeScript/Vite production build passed; Vite chunk-size warning only. |
| 2026-06-24 | `npm run browser:smoke -- --reporter=line` | PASS | Final browser smoke passed against the running local service. |
| 2026-06-24 | `docker compose build` | PASS | Docker image `infinity-comfyui:local` rebuilt successfully and ran production build inside the image. |
| 2026-06-24 | `docker compose up -d` | PASS | Docker service recreated and started. |
| 2026-06-24 | `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7930/` | PASS | Docker-served app returned HTTP 200. |
| 2026-06-24 | `npm run browser:smoke -- --reporter=line` | PASS | Browser smoke passed again against the Docker service on port 7930. |
| 2026-06-24 | `npm test -- src/store/projectPersistence.test.ts -t "saves edits made before startup loading finishes"` | PASS | Regression for startup persistence race: edits before storage load now save after load completes. |
| 2026-06-24 | `npm test -- src/store/projectPersistence.test.ts src/domain/persistence/projectPersistence.test.ts src/domain/persistence/projectSerializer.test.ts` | PASS | Rechecked persistence controller/serializer behavior after the startup-race fix. |
| 2026-06-24 | `npm run browser:smoke -- --reporter=line` | PASS | Rechecked Docker-served browser flow with explicit drag-in-progress assertions: main canvas nodes stay visible and minimap asset nodes remain present. |
| 2026-06-24 | `npm test` | PASS | Final regression pass after startup persistence fix: 47 files, 299 tests. |
| 2026-06-24 | `npm run build` | PASS | Final TypeScript/Vite build passed; Vite chunk-size warning only. |
| 2026-06-24 | `docker compose build && docker compose up -d` | PASS | Runtime image rebuilt from the main project directory and service restarted on port 7930. |
| 2026-06-24 | `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7930/` | PASS | Final Docker-served app returned HTTP 200. |
| 2026-06-24 | `npm run browser:smoke -- --reporter=line` | PASS | Final Docker-served browser smoke passed with persistence reload and drag/minimap assertions. |
| 2026-06-24 | `npm run browser:smoke -- --reporter=line` | FAIL -> PASS | Added a regression for edge dragging: while dragging an asset node near the viewport edge, at least one main-canvas asset node must remain visible and minimap asset count must match React Flow asset nodes. |
| 2026-06-24 | `npm test` | PASS | Full suite after drag-visibility fix: 47 files, 299 tests. |
| 2026-06-24 | `npm run build` | PASS | Final TypeScript/Vite build passed after disabling node-drag auto-pan and adding dragging visibility override. |
| 2026-06-24 | `docker compose build && docker compose up -d` | PASS | Runtime image rebuilt and restarted with the drag-visibility fix. |
| 2026-06-24 | `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7930/` | PASS | Docker-served app returned HTTP 200 after the drag-visibility fix. |
| 2026-06-24 | `npm run browser:smoke -- --reporter=line` | PASS | Final Docker-served browser smoke passed with edge-drag visible-node, minimap count, persistence reload, preview, batch drop, and replacement assertions. |
