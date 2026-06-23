# Canvas Groups, Templates, and Persistent History Design

## Goal

Build a canvas editing model where assets remain the primary visible elements, groups organize arbitrary canvas selections, templates capture reusable subgraphs, and every project-changing action is visible and undoable after refresh.

## Confirmed Rules

- Groups and templates are independent features.
- A user can select nodes on the canvas and group them without creating a template.
- A user can save a selected subgraph as a template without requiring an existing group.
- Creating a template instance on the canvas automatically creates a group for that instance.
- Ungroup removes only the visual/organizational group container. It does not keep a template-origin marker on the ungrouped nodes.
- Undo/redo history is persisted with the project and survives refresh.
- A history dock sits below the assets dock. It opens as a popover and visualizes commands with affected assets when available.

## Domain Model

### Group

A group is a canvas organization container:

- Has its own canvas node with title, color, size, collapsed state, and child node ids.
- Can be created from a selection.
- Can be moved as a whole.
- Can be deleted as a whole.
- Can be ungrouped at any time.
- Does not imply template membership.

### Template

A template is a reusable subgraph recipe:

- Stores a snapshot of selected canvas nodes, edges, assets, function/run metadata, input/output exposure, and relative layout.
- Can be created from a group or any valid selected subgraph.
- Can be instantiated on the canvas.
- Does not require a live group.

### Template Instance

A template instance is the result of creating a template on the canvas:

- Creates cloned assets/nodes.
- Creates a group around the cloned nodes.
- Does not create permanent origin coupling after ungroup.

## Persistent History

History is part of `ProjectState`, not an in-memory-only store field.

Each history entry is a serializable transaction:

- Human-readable label.
- Transaction type.
- Timestamp.
- Affected node ids, resource ids, group ids, and template ids.
- Preview payload for the history popover.
- A full before/after project snapshot for reliable undo/redo in the first implementation phase.

Snapshot-based transactions are intentionally used first because existing store actions mutate many coupled areas at once: resources, canvas nodes, edges, tasks, and function node data. A later optimization may convert this to JSON Patch once all command boundaries are stable.

## History UX

The left dock contains:

- Assets button.
- History button below it.

The history popover:

- Lists latest commands first.
- Shows command title, time, status, affected count, and asset thumbnails where available.
- Lets users click an asset thumbnail to preview it.
- Lets users double-click a history row to focus the first affected canvas node.
- Provides Undo and Redo actions.
- Closes on mouse leave like the assets popover.

## First Implementation Slice

The first code slice should deliver:

1. Project-persisted transaction history fields.
2. Undo/redo methods backed by project snapshots.
3. History recording for representative high-value commands:
   - add text asset
   - add empty asset
   - add media asset
   - connect/disconnect
   - delete nodes
   - move nodes
   - create group
   - ungroup
4. Left history dock with visual command rows and asset previews.
5. Basic group/ungroup actions from canvas selection and node context menu.

Template storage and full template instantiation can build on this transaction layer in a later slice if the first slice becomes too large.

## Risks

- Existing `undoStack: ProjectState[]` is store-local and not persistent. It must remain compatible during migration.
- Async run undo requires cancellation or orphaning semantics. This first slice should avoid pretending redo reruns tasks.
- Snapshot history can grow project JSON quickly. The initial implementation should cap history length conservatively.
