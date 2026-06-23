import type { GenerationFunction } from '../../domain/types'

type CanvasContextMenusProps = {
  functions: GenerationFunction[]
  position?: { x: number; y: number }
  onRunFunction?: (functionId: string) => void
}

export function CanvasContextMenus({ functions, position, onRunFunction }: CanvasContextMenusProps) {
  if (!functions.length || !position) return null

  return (
    <div className="asset-canvas-context-menu" role="menu" aria-label="Asset function menu" style={{ left: position.x, top: position.y }}>
      {functions.map((functionDef) => (
        <button key={functionDef.id} onClick={() => onRunFunction?.(functionDef.id)} role="menuitem" type="button">
          {functionDef.name}
        </button>
      ))}
    </div>
  )
}
