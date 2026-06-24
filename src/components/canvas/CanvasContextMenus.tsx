import type { GenerationFunction, ResourceType } from '../../domain/types'

const assetTypes: ResourceType[] = ['text', 'number', 'image', 'video', 'audio']

type CanvasContextMenusProps = {
  functions: GenerationFunction[]
  mode?: 'canvas' | 'asset'
  position?: { x: number; y: number }
  resourceTypes?: ResourceType[]
  onCreateAsset?: (type: ResourceType) => void
  onRunFunction?: (functionId: string) => void
}

const functionSupportsResourceTypes = (functionDef: GenerationFunction, resourceTypes: ResourceType[]) =>
  functionDef.inputs.some((input) => resourceTypes.includes(input.type))

export function CanvasContextMenus({
  functions,
  mode = 'canvas',
  position,
  resourceTypes = [],
  onCreateAsset,
  onRunFunction,
}: CanvasContextMenusProps) {
  if (!position) return null

  const visibleFunctions =
    mode === 'asset' && resourceTypes.length > 0
      ? functions.filter((functionDef) => functionSupportsResourceTypes(functionDef, resourceTypes))
      : functions

  return (
    <div className="asset-canvas-context-menu" role="menu" aria-label="Asset canvas menu" style={{ left: position.x, top: position.y }}>
      {mode === 'canvas' ? (
        <div className="asset-canvas-context-menu-section" role="presentation">
          {assetTypes.map((type) => (
            <button key={type} onClick={() => onCreateAsset?.(type)} role="menuitem" type="button">
              Add {type} asset
            </button>
          ))}
        </div>
      ) : null}
      {visibleFunctions.map((functionDef) => (
        <button key={functionDef.id} onClick={() => onRunFunction?.(functionDef.id)} role="menuitem" type="button">
          {functionDef.name}
        </button>
      ))}
      {mode === 'asset' && visibleFunctions.length === 0 ? <div className="add-node-empty">No compatible functions</div> : null}
    </div>
  )
}
