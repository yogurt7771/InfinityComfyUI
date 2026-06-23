import { ArrowDown, ArrowUp, X } from 'lucide-react'
import type { Resource } from '../../domain/types'

type InputTrayProps = {
  resources: Resource[]
  onRemove?: (resourceId: string) => void
  onMove?: (resourceId: string, direction: 'up' | 'down') => void
}

const resourceLabel = (resource: Resource) => resource.name ?? resource.id

const resourceValuePreview = (resource: Resource) => {
  if (typeof resource.value === 'object' && resource.value !== null && 'filename' in resource.value) {
    return resource.value.filename ?? resource.type
  }
  return String(resource.value)
}

export function InputTray({ resources, onRemove, onMove }: InputTrayProps) {
  return (
    <section className="function-input-tray" aria-label="Selected assets">
      <h3>Selected assets</h3>
      {resources.length ? (
        <div className="function-input-tray-list">
          {resources.map((resource, index) => (
            <article className="function-input-tray-item" key={resource.id}>
              <div>
                <strong>{resourceLabel(resource)}</strong>
                <span>{resource.type}</span>
                <small>{resourceValuePreview(resource)}</small>
              </div>
              <div className="function-input-tray-actions">
                <button
                  aria-label={`Move ${resourceLabel(resource)} up`}
                  disabled={index === 0}
                  onClick={() => onMove?.(resource.id, 'up')}
                  type="button"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  aria-label={`Move ${resourceLabel(resource)} down`}
                  disabled={index === resources.length - 1}
                  onClick={() => onMove?.(resource.id, 'down')}
                  type="button"
                >
                  <ArrowDown size={16} />
                </button>
                <button aria-label={`Remove ${resourceLabel(resource)}`} onClick={() => onRemove?.(resource.id)} type="button">
                  <X size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p>No selected assets</p>
      )}
    </section>
  )
}
