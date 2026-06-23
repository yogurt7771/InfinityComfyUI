import { Crosshair, X } from 'lucide-react'
import type { FunctionInputDef, Resource, ResourceRef } from '../../domain/types'

export type SlotAssignments = Record<string, ResourceRef>

type SlotMappingProps = {
  inputs: FunctionInputDef[]
  resources: Resource[]
  assignments: SlotAssignments
  onAssign: (inputKey: string, ref: ResourceRef | undefined) => void
  onPickSlot?: (inputKey: string) => void
}

const resourceLabel = (resource: Resource | undefined) => resource?.name ?? resource?.id ?? 'Missing asset'

export function autoAssignFunctionInputs(inputs: FunctionInputDef[], resources: Resource[]): SlotAssignments {
  const assignments: SlotAssignments = {}
  const usedResourceIds = new Set<string>()

  for (const input of inputs) {
    const resource = resources.find((candidate) => candidate.type === input.type && !usedResourceIds.has(candidate.id))
    if (!resource) continue
    assignments[input.key] = { resourceId: resource.id, type: resource.type }
    usedResourceIds.add(resource.id)
  }

  return assignments
}

export function SlotMapping({ inputs, resources, assignments, onAssign, onPickSlot }: SlotMappingProps) {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))

  return (
    <section className="function-slot-mapping" aria-label="Slot mapping">
      <h3>Inputs</h3>
      {inputs.map((input) => {
        const assignment = assignments[input.key]
        const resource = assignment ? resourcesById.get(assignment.resourceId) : undefined
        return (
          <div className="function-slot-row" data-testid={`slot-row-${input.key}`} key={input.key}>
            <div>
              <strong>{input.label}</strong>
              <span>{input.type}</span>
            </div>
            <div className="function-slot-value">
              {assignment ? (
                <>
                  <span>{resourceLabel(resource)}</span>
                  <button aria-label={`Clear ${input.key}`} onClick={() => onAssign(input.key, undefined)} type="button">
                    <X size={14} />
                  </button>
                </>
              ) : (
                <span>{input.required ? 'Required' : 'Optional'}</span>
              )}
              <button aria-label={`Pick ${input.key} from canvas`} onClick={() => onPickSlot?.(input.key)} type="button">
                <Crosshair size={14} />
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
