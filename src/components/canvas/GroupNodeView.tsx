import type { NodeProps } from '@xyflow/react'

type GroupNodeData = {
  title: string
  childNodeIds: string[]
  color?: string
  collapsed?: boolean
}

export function GroupNodeView({ data, selected }: NodeProps) {
  const nodeData = data as GroupNodeData
  return (
    <section className={`asset-canvas-group-node ${selected ? 'is-selected' : ''}`} style={{ borderColor: nodeData.color }}>
      <header>
        <strong>{nodeData.title}</strong>
        <span>{nodeData.childNodeIds.length} assets</span>
      </header>
    </section>
  )
}
