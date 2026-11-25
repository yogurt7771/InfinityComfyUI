import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { SelectionFunctionMatch } from './selectionFunctionMatches'

export type SelectionRibbonAction = {
  id: string
  label: string
  title?: string
  icon: ReactNode
  tone?: 'primary' | 'danger'
  /** Render the icon only; the label stays as tooltip and accessible name. */
  iconOnly?: boolean
  /** Set for matching-function actions. */
  match?: SelectionFunctionMatch
}

type SelectionRibbonProps = {
  summary: string
  functionActions: SelectionRibbonAction[]
  overflowFunctionActions: SelectionRibbonAction[]
  assetActions: SelectionRibbonAction[]
  selectionActions: SelectionRibbonAction[]
  onAction: (action: SelectionRibbonAction) => void
}

function RibbonButton({ action, onAction }: { action: SelectionRibbonAction; onAction: (action: SelectionRibbonAction) => void }) {
  return (
    <button
      type="button"
      className={action.tone ? `selection-ribbon-button ${action.tone}` : 'selection-ribbon-button'}
      aria-label={action.label}
      title={action.title ?? action.label}
      onClick={() => onAction(action)}
    >
      {action.icon}
      {action.iconOnly ? null : <span>{action.label}</span>}
    </button>
  )
}

export function SelectionRibbon({
  summary,
  functionActions,
  overflowFunctionActions,
  assetActions,
  selectionActions,
  onAction,
}: SelectionRibbonProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const sections = [
    functionActions.length > 0 ? (
      <div key="functions" className="selection-ribbon-section" aria-label="Matching functions">
        {functionActions.map((action) => (
          <RibbonButton action={action} key={action.id} onAction={onAction} />
        ))}
        {overflowFunctionActions.length > 0 ? (
          <div className="selection-ribbon-more">
            <button
              type="button"
              className="selection-ribbon-button"
              aria-expanded={overflowOpen}
              aria-haspopup="menu"
              aria-label={`More functions (${overflowFunctionActions.length})`}
              onClick={() => setOverflowOpen((open) => !open)}
            >
              <span>More {overflowFunctionActions.length}</span>
              <ChevronDown size={14} />
            </button>
            {overflowOpen ? (
              <div className="selection-ribbon-menu" role="menu" aria-label="More matching functions">
                {overflowFunctionActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    title={action.title ?? action.label}
                    onClick={() => {
                      setOverflowOpen(false)
                      onAction(action)
                    }}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null,
    assetActions.length > 0 ? (
      <div key="asset" className="selection-ribbon-section" aria-label="Asset actions">
        {assetActions.map((action) => (
          <RibbonButton action={action} key={action.id} onAction={onAction} />
        ))}
      </div>
    ) : null,
    selectionActions.length > 0 ? (
      <div key="selection" className="selection-ribbon-section" aria-label="Selection actions">
        {selectionActions.map((action) => (
          <RibbonButton action={action} key={action.id} onAction={onAction} />
        ))}
      </div>
    ) : null,
  ].filter(Boolean)

  return (
    <div
      className="selection-ribbon nodrag nopan"
      role="toolbar"
      aria-label="Selection quick actions"
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="selection-ribbon-summary">{summary}</span>
      {sections}
    </div>
  )
}
