import { ArrowDown, ArrowUp, Eye, X } from 'lucide-react'
import { useState } from 'react'
import { resolvedResourceDisplayValue } from '../../domain/resourceValues'
import type { AssetRecord, Resource } from '../../domain/types'
import { useProjectStore } from '../../store/projectStore'
import { FullResourcePreviewModal } from '../ResourcePreviewModal'
import { ResourcePreview } from '../ResourcePreview'

type InputTrayProps = {
  resources: Resource[]
  onRemove?: (resourceId: string) => void
  onMove?: (resourceId: string, direction: 'up' | 'down') => void
}

const resourceLabel = (resource: Resource) => resource.name ?? resource.id

const resourceValuePreview = (resource: Resource, assets: Record<string, AssetRecord>) => {
  if (typeof resource.value === 'object' && resource.value !== null && 'filename' in resource.value) {
    return resource.value.filename ?? resource.type
  }
  return String(resolvedResourceDisplayValue(resource, assets))
}

export function InputTray({ resources, onRemove, onMove }: InputTrayProps) {
  const assets = useProjectStore((state) => state.project.assets)
  const [previewResource, setPreviewResource] = useState<Resource>()
  return (
    <>
      <section className="function-input-tray" aria-label="Selected assets">
        <h3>Selected assets</h3>
        {resources.length ? (
          <div className="function-input-tray-list">
            {resources.map((resource, index) => (
              <article className="function-input-tray-item" key={resource.id}>
                <button
                  aria-label={`Preview ${resourceLabel(resource)}`}
                  className="function-input-tray-preview"
                  onClick={() => setPreviewResource(resource)}
                  type="button"
                >
                  <ResourcePreview resource={resource} />
                  <span className="function-input-tray-preview-icon">
                    <Eye size={14} />
                  </span>
                </button>
                <div className="function-input-tray-copy">
                  <strong>{resourceLabel(resource)}</strong>
                  <span>{resource.type}</span>
                  <small>{resourceValuePreview(resource, assets)}</small>
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
      <FullResourcePreviewModal
        resource={previewResource}
        resources={resources}
        onClose={() => setPreviewResource(undefined)}
      />
    </>
  )
}
