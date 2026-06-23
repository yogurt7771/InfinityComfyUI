import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Resource } from '../../domain/types'
import { ResourcePreview } from '../ResourcePreview'

type AssetNodeData = {
  resourceId: string
  title?: string
  resource?: Resource
  handles?: {
    source: string
    target: string
  }
}

export function AssetNodeView({ data, selected }: NodeProps) {
  const nodeData = data as AssetNodeData
  const resource = nodeData.resource
  const title = nodeData.title ?? resource?.name ?? nodeData.resourceId

  return (
    <article className={`asset-canvas-node ${selected ? 'is-selected' : ''}`}>
      <Handle
        className="asset-hidden-handle"
        id={nodeData.handles?.target}
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1 }}
        type="target"
      />
      <header>
        <strong>{title}</strong>
        <span>{resource?.type ?? 'asset'}</span>
      </header>
      <div className="asset-canvas-node-preview">
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
