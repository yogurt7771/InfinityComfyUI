import type { FunctionOutputDef, Resource } from '../../domain/types'

type OutputPreviewStripProps = {
  outputs: FunctionOutputDef[]
  resources?: Resource[]
}

export function OutputPreviewStrip({ outputs, resources = [] }: OutputPreviewStripProps) {
  const resourcesByOutputKey = new Map(resources.map((resource) => [resource.source.outputKey, resource]))

  return (
    <section className="function-output-strip" aria-label="Output previews">
      <h3>Expected outputs</h3>
      <div className="function-output-strip-items">
        {outputs.map((output) => {
          const resource = resourcesByOutputKey.get(output.key)
          return (
            <article className="function-output-item" data-testid={`expected-output-${output.key}`} key={output.key}>
              <strong>{output.label}</strong>
              <span>{resource ? resource.name ?? resource.id : output.type}</span>
            </article>
          )
        })}
      </div>
    </section>
  )
}
