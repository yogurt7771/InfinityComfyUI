# Asset-First Canvas and Function Command Modal Design

## Status

This document is the source of truth for the asset-first canvas refactor.
It supersedes any implementation that keeps function nodes or result-group nodes as visible canvas workflow objects.

## Goal

Infinity ComfyUI should make assets the primary visible objects. Users build and reuse generation flows by selecting assets, running functions through command modals, grouping asset subgraphs, and saving reusable templates. Function runs are stored as reproducible asset history, not as visible canvas nodes.

## Design Principles

- The canvas shows assets and groups. Functions are commands, not visible workflow nodes.
- Output assets are reproducible run snapshots, not just files or primitive values.
- Visible edges are asset-to-asset lineage. They explain which assets generated which outputs.
- Pending outputs are first-class assets. Runs should create pending assets immediately.
- Template and group are independent features. A template instance creates a group, but a group does not imply a template.
- Rerun and edit-and-run are one action: open the same function modal prefilled from a saved run snapshot.
- Reproduce graph is template/subgraph based. It should not depend on temporary visible function nodes.
- The implementation should be clean. Do not preserve old function/result-group nodes as user-facing compatibility surfaces.

## Visible Canvas Model

### Asset

An asset is any visible resource on the canvas:

- user upload
- manual text or number
- pending function output
- succeeded function output
- failed function output

Each asset can be previewed, selected, connected by lineage, used as a function input, grouped, duplicated, and exported.

### Pending Asset

A pending asset is a visible asset placeholder created before a task finishes.

It displays:

- target type, such as image, video, audio, text, or number
- status: pending, queued, running, fetching outputs, succeeded, failed, or canceled
- source function chip
- error state if the task fails

When the task succeeds, the same visible asset becomes the final asset by attaching the generated resource value.

### Group

A group is a canvas organization container around assets.

It can:

- contain any selected assets
- move its contained assets as a unit
- run its internal recipe when created from a template
- be duplicated
- be deleted
- be ungrouped without preserving a template-origin marker

### Template

A template is a reusable subgraph recipe. It is not a canvas object until instantiated.

It stores:

- root input asset definitions
- intermediate asset definitions
- output asset definitions
- per-step function run snapshots
- asset lineage DAG
- relative positions of assets inside the template
- exposed inputs and outputs
- default group size, title, color, and collapsed state

Creating a template instance on the canvas creates a group containing a fresh asset subgraph.

## Function Command Modal

Functions are run through a modal, not through visible function nodes.

### Entry Points

- Select one or more assets, right-click, then choose a function.
- Double-click or click the function chip on an output asset to edit and run from its snapshot.
- Use a template or group run action, which internally opens or executes the same function-run model.

### Modal Layout

The modal should use a data-dense, restrained tool style:

- clear labels
- compact rows
- visible focus states
- Lucide icons for icon buttons
- no emoji icons
- no decorative hero/card layout

Sections:

1. Input Tray
   - Horizontal asset cards.
   - Shows selected candidate assets.
   - Supports preview, remove, and drag reorder.
   - Extra selected assets stay here instead of being discarded.

2. Slot Mapping
   - One row per function asset input.
   - Uses function input names, such as Image, First Frame, Last Frame, Mask.
   - Shows mapped asset thumbnail and type.
   - Supports assigning from Input Tray.
   - Supports "pick from canvas" for Excel-style selection.

3. Parameters
   - Text, number, seed, run count, and provider-specific parameters.
   - Keeps function-node editing capability, but inside the modal.

4. Outputs
   - Shows output definitions before run.
   - Shows pending or generated output assets after run.

5. Actions
   - Run
   - Cancel
   - Save preset when useful later

### Automatic Input Fill

When assets are selected before opening a function:

1. Sort required asset inputs by function definition order.
2. Fill only compatible slots.
3. If multiple slots share a type, use user selection order.
4. If selection order is unavailable, use canvas order: left-to-right, then top-to-bottom.
5. Leave extra assets in Input Tray.
6. Mark missing required slots clearly.

### Excel-Style Pick Mode

When choosing a slot from canvas:

1. User clicks the slot pick icon.
2. Modal collapses to a small floating picker strip.
3. Canvas enters Pick Mode.
4. Picker strip shows `Selecting: <slot label> · <type>`.
5. Compatible assets are highlighted.
6. Incompatible assets are dimmed.
7. Clicking an asset fills the slot.
8. Enter confirms.
9. Escape cancels.
10. The modal expands again after selection.

## Run Snapshot

Every function-generated output asset must store a reproducible run snapshot.

The snapshot must include:

- function id
- function name
- function version or workflow snapshot
- input asset refs
- slot mapping
- primitive parameters
- run count
- seed policy and actual seed patches when available
- ComfyUI endpoint
- compiled workflow snapshot
- task id
- prompt id or provider request id when available
- history/output metadata
- createdAt
- status
- error

Important rule: rerun should not depend on the latest function definition.

When opening a generated asset:

- `Use saved snapshot` should be the default for reproducibility.
- `Use latest function` may be offered later as an advanced migration path.

## Asset Menus

All output assets should support:

- Preview
- Edit and run from snapshot
- Show source assets
- Open run details
- Reproduce graph or run containing template/group when applicable

The previous split between rerun and edit-and-run should not exist.

## Asset Lineage

Visible edges should connect assets directly.

Example:

```text
Prompt Asset + Input Image Asset -> Edited Image Asset
Edited Image Asset + Prompt Asset -> Video Asset
```

Lineage edges should:

- be derived from task input refs and output refs
- not require visible function nodes
- be dim by default if visual noise is high
- become emphasized when selecting a related asset or group

## Reproduce Graph

Reproduce graph is the operation of replaying an asset DAG with replacement root inputs.

Preferred product model:

```text
Template = reusable asset generation recipe
Group Instance = template copy on canvas
Run = execution of a group instance
```

Reproduce should therefore be implemented through template/group recipes instead of temporary visible function nodes.

## Group and Template Workflow

### Save as Template

User selects an asset subgraph and chooses Save as Template.

The system should:

1. Detect root inputs:
   - assets without upstream source
   - assets whose upstream source is outside the selection
2. Detect outputs:
   - assets without downstream consumers
   - assets explicitly marked by the user
3. Preview a compact DAG.
4. Let the user name inputs, outputs, and template.
5. Store relative layout and run snapshots.

### Create from Template

User creates a template instance on the canvas.

The system should:

1. Open Create from Template.
2. Auto-fill inputs from selected assets.
3. Support Pick Mode for missing slots.
4. Create a group containing assets.
5. Keep internal asset layout relative to the group.
6. Mark the group Unbound or Ready.

### Run Group

Running a group:

1. Reads current bound input assets.
2. Clones a fresh pending asset tree.
3. Creates tasks following the template DAG.
4. Uses existing pending dependency logic.
5. Queues a task when its dependencies are ready.
6. Fails dependent assets immediately when upstream fails.
7. Never overwrites previous assets.

## Persistent History

Every project-changing command must be undoable and visible after refresh.

History should include:

- create asset
- update asset
- delete asset
- run function
- task status changes that create or finalize assets
- connect lineage
- group
- ungroup
- save template
- instantiate template
- run group
- pick-mode assignment

The history list belongs near the assets dock and should show asset thumbnails when affected assets exist.

## First Implementation Slice

The first clean implementation should deliver:

1. A documented asset-first model.
2. React Flow visible nodes limited to resource assets and groups.
3. Function menu opens Function Command Modal instead of creating visible function nodes.
4. Function run creates pending resource nodes immediately.
5. Successful or failed tasks update those same resource nodes.
6. Asset-to-asset lineage edges are derived from task snapshots.
7. Generated assets can open the same function modal from their run snapshot.
8. Function slots can enter Pick Mode to select compatible assets directly from the canvas.
9. Tests prove no visible function or result_group nodes are created by function runs.

Template run and full group run can build on this after the first slice is stable.

## Non-Goals for the First Slice

- No legacy project compatibility layer.
- No visible function nodes.
- No visible result_group nodes.
- No duplicate rerun and edit-and-run actions.
- No full template graph executor until the asset-first run model is stable.
