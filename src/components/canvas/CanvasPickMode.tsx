import type { ResourceType } from '../../domain/types'

type CanvasPickModeProps = {
  inputKey?: string
  inputType?: ResourceType
  onCancel?: () => void
}

export function CanvasPickMode({ inputKey, inputType, onCancel }: CanvasPickModeProps) {
  if (!inputKey || !inputType) return null

  return (
    <div className="asset-canvas-pick-mode" role="status">
      <span>
        Pick {inputType} for {inputKey}
      </span>
      <button onClick={onCancel} type="button">
        Cancel
      </button>
    </div>
  )
}
