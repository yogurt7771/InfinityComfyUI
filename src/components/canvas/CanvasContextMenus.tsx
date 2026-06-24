import type { GenerationFunction, ResourceType } from '../../domain/types'

const assetTypes: ResourceType[] = ['text', 'number', 'image', 'video', 'audio']

type CanvasContextMenusProps = {
  functions: GenerationFunction[]
  position?: { x: number; y: number }
  onCreateAsset?: (type: ResourceType) => void
  onRunFunction?: (functionId: string) => void
}

export function CanvasContextMenus({ functions, position, onCreateAsset, onRunFunction }: CanvasContextMenusProps) {
  if (!position) return null

  return (
    <div className="asset-canvas-context-menu" role="menu" aria-label="Asset canvas menu" style={{ left: position.x, top: position.y }}>
      <div className="asset-canvas-context-menu-section" role="presentation">
        {assetTypes.map((type) => (
          <button key={type} onClick={() => onCreateAsset?.(type)} role="menuitem" type="button">
            Add {type} asset
          </button>
        ))}
      </div>
      {functions.map((functionDef) => (
        <button key={functionDef.id} onClick={() => onRunFunction?.(functionDef.id)} role="menuitem" type="button">
          {functionDef.name}
        </button>
      ))}
    </div>
  )
}
