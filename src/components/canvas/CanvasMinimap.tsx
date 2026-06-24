import { useReactFlow, useViewport, type Edge, type Node, type Viewport } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'

type Size = {
  width: number
  height: number
}

type Rect = {
  x: number
  y: number
  width: number
  height: number
}

type MinimapNodeRect = Rect & {
  id: string
  type?: string
}

type MinimapEdgeLine = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export type MinimapLayout = {
  bounds: Rect
  scale: number
  offsetX: number
  offsetY: number
  nodes: MinimapNodeRect[]
  edges: MinimapEdgeLine[]
  viewport: Rect
}

const minimapSize = { width: 280, height: 190 }
const minimapPadding = 30
const fallbackPaneSize = { width: 1200, height: 760 }

const numberFromUnknown = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const nodeSize = (node: Node): Size => {
  const style = node.style as { width?: unknown; height?: unknown } | undefined
  const data = node.data as { size?: { width?: unknown; height?: unknown } } | undefined
  const measured = node.measured as { width?: unknown; height?: unknown } | undefined
  const fallback = node.type === 'group' ? { width: 320, height: 220 } : { width: 260, height: 220 }
  return {
    width: numberFromUnknown(style?.width ?? measured?.width ?? data?.size?.width, fallback.width),
    height: numberFromUnknown(style?.height ?? measured?.height ?? data?.size?.height, fallback.height),
  }
}

const rectBounds = (rects: Rect[]): Rect => {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

const expandBounds = (bounds: Rect, padding: number): Rect => ({
  x: bounds.x - padding,
  y: bounds.y - padding,
  width: bounds.width + padding * 2,
  height: bounds.height + padding * 2,
})

const viewportRect = (viewport: Viewport, paneSize: Size): Rect => {
  const zoom = viewport.zoom || 1
  return {
    x: -viewport.x / zoom,
    y: -viewport.y / zoom,
    width: paneSize.width / zoom,
    height: paneSize.height / zoom,
  }
}

export function createMinimapLayout(nodes: Node[], edges: Edge[], viewport: Viewport, paneSize: Size): MinimapLayout | undefined {
  if (nodes.length === 0) return undefined

  const nodeRects = nodes.map((node) => {
    const size = nodeSize(node)
    return {
      id: node.id,
      type: node.type,
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
    }
  })
  const nodeById = new Map(nodeRects.map((node) => [node.id, node]))
  const viewportFlowRect = viewportRect(viewport, paneSize)
  const bounds = expandBounds(rectBounds([...nodeRects, viewportFlowRect]), 80)
  const scale = Math.min(
    (minimapSize.width - minimapPadding * 2) / bounds.width,
    (minimapSize.height - minimapPadding * 2) / bounds.height,
  )
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const contentWidth = bounds.width * safeScale
  const contentHeight = bounds.height * safeScale
  const offsetX = (minimapSize.width - contentWidth) / 2
  const offsetY = (minimapSize.height - contentHeight) / 2
  const toMiniRect = (rect: Rect): Rect => ({
    x: offsetX + (rect.x - bounds.x) * safeScale,
    y: offsetY + (rect.y - bounds.y) * safeScale,
    width: Math.max(2, rect.width * safeScale),
    height: Math.max(2, rect.height * safeScale),
  })
  const center = (rect: Rect) => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  })
  const toMiniPoint = (point: { x: number; y: number }) => ({
    x: offsetX + (point.x - bounds.x) * safeScale,
    y: offsetY + (point.y - bounds.y) * safeScale,
  })

  return {
    bounds,
    scale: safeScale,
    offsetX,
    offsetY,
    nodes: nodeRects.map((node) => ({ ...node, ...toMiniRect(node) })),
    edges: edges.flatMap((edge) => {
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) return []
      const sourceCenter = toMiniPoint(center(source))
      const targetCenter = toMiniPoint(center(target))
      return [{
        id: edge.id,
        x1: sourceCenter.x,
        y1: sourceCenter.y,
        x2: targetCenter.x,
        y2: targetCenter.y,
      }]
    }),
    viewport: toMiniRect(viewportFlowRect),
  }
}

const flowPointFromPointer = (event: PointerEvent<SVGSVGElement>, layout: MinimapLayout) => {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left - layout.offsetX) / layout.scale + layout.bounds.x,
    y: (event.clientY - rect.top - layout.offsetY) / layout.scale + layout.bounds.y,
  }
}

export function CanvasMinimap({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const viewport = useViewport()
  const { setViewport } = useReactFlow()
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ offsetX: number; offsetY: number } | undefined>(undefined)
  const [paneSize, setPaneSize] = useState<Size>(fallbackPaneSize)
  const layout = useMemo(() => createMinimapLayout(nodes, edges, viewport, paneSize), [edges, nodes, paneSize, viewport])

  useEffect(() => {
    const root = rootRef.current
    const pane = root?.closest('.react-flow') ?? root?.parentElement
    if (!pane) return undefined
    const update = () => {
      const rect = pane.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setPaneSize({ width: rect.width, height: rect.height })
    }
    update()
    if (!('ResizeObserver' in window)) return undefined
    const observer = new ResizeObserver(update)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [])

  if (!layout) return null

  const moveViewport = (flowPoint: { x: number; y: number }) => {
    const zoom = viewport.zoom || 1
    const nextLeft = flowPoint.x - (dragRef.current?.offsetX ?? layout.viewport.width / layout.scale / 2)
    const nextTop = flowPoint.y - (dragRef.current?.offsetY ?? layout.viewport.height / layout.scale / 2)
    void setViewport({ x: -nextLeft * zoom, y: -nextTop * zoom, zoom }, { duration: 0 })
  }

  return (
    <div className="comfy-minimap" ref={rootRef} aria-label="Canvas minimap">
      <div className="comfy-minimap-header" aria-hidden="true">
        <span />
        <span />
      </div>
      <svg
        aria-label="Canvas minimap viewport"
        className="comfy-minimap-map"
        height={minimapSize.height}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          const point = flowPointFromPointer(event, layout)
          const viewportFlow = viewportRect(viewport, paneSize)
          dragRef.current = {
            offsetX: point.x - viewportFlow.x,
            offsetY: point.y - viewportFlow.y,
          }
          moveViewport(point)
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return
          moveViewport(flowPointFromPointer(event, layout))
        }}
        onPointerUp={(event) => {
          dragRef.current = undefined
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        }}
        role="img"
        viewBox={`0 0 ${minimapSize.width} ${minimapSize.height}`}
        width={minimapSize.width}
      >
        <rect className="comfy-minimap-bg" x={0} y={0} width={minimapSize.width} height={minimapSize.height} />
        {layout.edges.map((edge) => (
          <line className="comfy-minimap-edge" key={edge.id} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
        ))}
        {layout.nodes.map((node) => (
          <rect
            className={`comfy-minimap-node comfy-minimap-node-${node.type ?? 'default'}`}
            key={node.id}
            rx={2}
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
          />
        ))}
        <rect
          className="comfy-minimap-viewport"
          x={layout.viewport.x}
          y={layout.viewport.y}
          width={layout.viewport.width}
          height={layout.viewport.height}
        />
      </svg>
    </div>
  )
}
