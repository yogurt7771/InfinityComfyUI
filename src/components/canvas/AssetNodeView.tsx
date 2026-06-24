import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useState, type FocusEvent } from 'react'
import type { Resource } from '../../domain/types'
import { ResourcePreview } from '../ResourcePreview'

export type AssetNodeReference = {
  id: string
  title: string
  direction: 'incoming' | 'outgoing'
  inputKey: string
  resource?: Resource
}

type AssetNodeData = {
  resourceId: string
  title?: string
  resource?: Resource
  onPreview?: (resource: Resource) => void
  onEditRun?: (resource: Resource) => void
  runStatus?: string
  runDurationLabel?: string
  runError?: string
  sourceFunctionName?: string
  references?: AssetNodeReference[]
  handles?: {
    source: string
    target: string
  }
}

function AssetReferencePopover({
  references,
  onPreview,
}: {
  references: AssetNodeReference[]
  onPreview?: (resource: Resource) => void
}) {
  if (references.length === 0) return null

  return (
    <div className="node-reference-popover" role="listbox" aria-label="Asset references">
      {references.map((reference) => (
        <button
          key={reference.id}
          type="button"
          className="node-reference-item"
          onClick={(event) => {
            event.stopPropagation()
            if (reference.resource) onPreview?.(reference.resource)
          }}
        >
          <span className="node-reference-locate">
            <span>{reference.direction === 'incoming' ? 'FROM' : 'TO'}</span>
            <strong>{reference.title}</strong>
            <small>{reference.inputKey}</small>
          </span>
          {reference.resource ? (
            <span className="node-reference-resource-preview">
              <ResourcePreview resource={reference.resource} />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

export function AssetNodeView({ data, selected }: NodeProps) {
  const nodeData = data as AssetNodeData
  const resource = nodeData.resource
  const title = nodeData.title ?? resource?.name ?? nodeData.resourceId
  const references = nodeData.references ?? []
  const [referencesOpen, setReferencesOpen] = useState(false)
  const closeReferencesOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setReferencesOpen(false)
  }

  return (
    <article className={`asset-canvas-node ${selected ? 'is-selected' : ''}`} data-resource-id={nodeData.resourceId}>
      <Handle
        className="asset-hidden-handle"
        id={nodeData.handles?.target}
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1 }}
        type="target"
      />
      <header>
        <strong>{title}</strong>
        <div className="node-reference" onBlur={closeReferencesOnBlur}>
          <button
            type="button"
            className="node-reference-button"
            aria-expanded={referencesOpen}
            aria-haspopup="listbox"
            onClick={(event) => {
              event.stopPropagation()
              setReferencesOpen((open) => !open)
            }}
          >
            {references.length} refs
          </button>
          {referencesOpen ? (
            <AssetReferencePopover references={references} onPreview={nodeData.onPreview} />
          ) : null}
        </div>
      </header>
      <div className="asset-canvas-node-meta">
        <span>{resource?.type ?? 'asset'}</span>
        {nodeData.runStatus ? (
          <span className={`asset-run-status asset-run-status-${nodeData.runStatus.replace(/[^a-z0-9_-]/gi, '-')}`}>
            {nodeData.runStatus}
          </span>
        ) : null}
        {nodeData.runDurationLabel ? <span className="resource-run-duration">{nodeData.runDurationLabel}</span> : null}
        {nodeData.sourceFunctionName ? (
          <button
            aria-label={`Edit and run ${nodeData.sourceFunctionName}`}
            className="asset-function-chip"
            disabled={!resource || !nodeData.onEditRun}
            onClick={(event) => {
              event.stopPropagation()
              if (resource) nodeData.onEditRun?.(resource)
            }}
            type="button"
          >
            {nodeData.sourceFunctionName}
          </button>
        ) : null}
      </div>
      {nodeData.runError ? (
        <p className="asset-run-error" role="alert">
          {nodeData.runError}
        </p>
      ) : null}
      <div
        aria-label={`Preview ${title}`}
        className={`asset-canvas-node-preview ${resource && nodeData.onPreview ? 'is-clickable' : ''}`}
        onClick={() => {
          if (resource) nodeData.onPreview?.(resource)
        }}
        onKeyDown={(event) => {
          if (!resource || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          nodeData.onPreview?.(resource)
        }}
        role={resource && nodeData.onPreview ? 'button' : undefined}
        tabIndex={resource && nodeData.onPreview ? 0 : undefined}
      >
        {resource ? <ResourcePreview resource={resource} /> : <p>{nodeData.resourceId}</p>}
      </div>
      <Handle
        className="asset-hidden-handle"
        id={nodeData.handles?.source}
        position={Position.Right}
        style={{ opacity: 0, width: 1, height: 1 }}
        type="source"
      />
    </article>
  )
}
