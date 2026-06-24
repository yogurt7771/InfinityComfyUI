import type { FunctionOutputDef, Resource } from '../../domain/types'
import { FullResourcePreviewModal } from '../ResourcePreviewModal'
import { ResourcePreview } from '../ResourcePreview'
import { useState } from 'react'

type OutputPreviewStripProps = {
  outputs: FunctionOutputDef[]
  resources?: Resource[]
}

export function OutputPreviewStrip({ outputs, resources = [] }: OutputPreviewStripProps) {
  const resourcesByOutputKey = new Map(resources.map((resource) => [resource.source.outputKey, resource]))
  const [previewResource, setPreviewResource] = useState<Resource>()

  return (
    <section className="function-output-strip" aria-label="Output previews">
      <h3>Expected outputs</h3>
      <div className="function-output-strip-items">
        {outputs.map((output) => {
          const resource = resourcesByOutputKey.get(output.key)
          return (
            <article className="function-output-item" data-testid={`expected-output-${output.key}`} key={output.key}>
              <strong>{output.label}</strong>
              {resource ? (
                <button
                  type="button"
                  className="function-output-preview-button"
                  aria-label={`Preview ${resource.name ?? resource.id}`}
                  onClick={() => setPreviewResource(resource)}
                >
                  <ResourcePreview resource={resource} />
                </button>
              ) : (
                <span>{output.type}</span>
              )}
            </article>
          )
        })}
      </div>
      <FullResourcePreviewModal
        resource={previewResource}
        resources={previewResource ? [previewResource] : []}
        onClose={() => setPreviewResource(undefined)}
      />
    </section>
  )
}
