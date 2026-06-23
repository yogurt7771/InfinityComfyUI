import { Play, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GenerationFunction, PrimitiveInputValue, Resource, ResourceRef } from '../../domain/types'
import { FunctionParameters } from './FunctionParameters'
import { InputTray } from './InputTray'
import { OutputPreviewStrip } from './OutputPreviewStrip'
import { SlotMapping, autoAssignFunctionInputs, type SlotAssignments } from './SlotMapping'

export type FunctionCommandRunRequest = {
  functionId: string
  functionName: string
  inputValues: Record<string, PrimitiveInputValue | ResourceRef>
  outputKeys: string[]
}

type FunctionCommandModalProps = {
  functionDef: GenerationFunction
  candidateResources: Resource[]
  pendingOutputs?: Resource[]
  onClose: () => void
  onPickSlot?: (inputKey: string) => void
  onRun: (request: FunctionCommandRunRequest) => void
}

const initialPrimitiveValues = (functionDef: GenerationFunction, assignments: SlotAssignments) =>
  Object.fromEntries(
    functionDef.inputs
      .filter((input) => !assignments[input.key] && (input.type === 'text' || input.type === 'number'))
      .map((input) => [input.key, input.defaultValue ?? (input.type === 'number' ? 0 : '')]),
  ) as Record<string, PrimitiveInputValue>

const moveResource = (resources: Resource[], resourceId: string, direction: 'up' | 'down') => {
  const index = resources.findIndex((resource) => resource.id === resourceId)
  const nextIndex = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || nextIndex < 0 || nextIndex >= resources.length) return resources
  const next = [...resources]
  const [resource] = next.splice(index, 1)
  next.splice(nextIndex, 0, resource!)
  return next
}

export function FunctionCommandModal({
  functionDef,
  candidateResources,
  pendingOutputs,
  onClose,
  onPickSlot,
  onRun,
}: FunctionCommandModalProps) {
  const [resources, setResources] = useState(candidateResources)
  const initialAssignments = useMemo(() => autoAssignFunctionInputs(functionDef.inputs, candidateResources), [functionDef, candidateResources])
  const [assignments, setAssignments] = useState<SlotAssignments>(initialAssignments)
  const [primitiveValues, setPrimitiveValues] = useState<Record<string, PrimitiveInputValue>>(() =>
    initialPrimitiveValues(functionDef, initialAssignments),
  )

  const setAssignment = (inputKey: string, ref: ResourceRef | undefined) => {
    setAssignments((current) => {
      const next = { ...current }
      if (ref) next[inputKey] = ref
      else delete next[inputKey]
      return next
    })
  }

  const run = () => {
    const inputValues: Record<string, PrimitiveInputValue | ResourceRef> = {}
    for (const input of functionDef.inputs) {
      inputValues[input.key] =
        assignments[input.key] ?? primitiveValues[input.key] ?? input.defaultValue ?? (input.type === 'number' ? 0 : '')
    }
    onRun({
      functionId: functionDef.id,
      functionName: functionDef.name,
      inputValues,
      outputKeys: functionDef.outputs.map((output) => output.key),
    })
  }

  return (
    <div className="function-command-modal" role="dialog" aria-modal="true" aria-label={`${functionDef.name} function command`}>
      <header className="function-command-modal-header">
        <div>
          <h2>{functionDef.name}</h2>
          <p>{functionDef.category ?? functionDef.workflow.format}</p>
        </div>
        <button aria-label="Close function command" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </header>

      <InputTray
        resources={resources}
        onMove={(resourceId, direction) => setResources((current) => moveResource(current, resourceId, direction))}
        onRemove={(resourceId) => setResources((current) => current.filter((resource) => resource.id !== resourceId))}
      />
      <SlotMapping
        inputs={functionDef.inputs}
        resources={resources}
        assignments={assignments}
        onAssign={setAssignment}
        onPickSlot={onPickSlot}
      />
      <FunctionParameters
        inputs={functionDef.inputs}
        assignments={assignments}
        values={primitiveValues}
        onChange={(inputKey, value) => setPrimitiveValues((current) => ({ ...current, [inputKey]: value }))}
      />
      <OutputPreviewStrip outputs={functionDef.outputs} resources={pendingOutputs} />

      <footer className="function-command-modal-actions">
        <button aria-label="Run function" className="primary-run-button" onClick={run} type="button">
          <Play size={16} />
          Run
        </button>
      </footer>
    </div>
  )
}
