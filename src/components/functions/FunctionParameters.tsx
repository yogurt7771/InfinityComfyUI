import type { FunctionInputDef, PrimitiveInputValue, ResourceRef } from '../../domain/types'

type FunctionParametersProps = {
  inputs: FunctionInputDef[]
  assignments: Record<string, ResourceRef>
  values: Record<string, PrimitiveInputValue>
  onChange: (inputKey: string, value: PrimitiveInputValue) => void
}

const primitiveValue = (value: PrimitiveInputValue, fallback: PrimitiveInputValue) => value ?? fallback ?? ''

export function FunctionParameters({ inputs, assignments, values, onChange }: FunctionParametersProps) {
  const primitiveInputs = inputs.filter((input) => !assignments[input.key] && (input.type === 'text' || input.type === 'number'))

  return (
    <section className="function-parameters" aria-label="Function parameters">
      <h3>Parameters</h3>
      {primitiveInputs.length ? (
        primitiveInputs.map((input) => (
          <label className="function-parameter-row" key={input.key}>
            <span>{input.label}</span>
            <input
              aria-label={`${input.key} input`}
              type={input.type === 'number' ? 'number' : 'text'}
              value={String(primitiveValue(values[input.key], input.defaultValue ?? ''))}
              onChange={(event) =>
                onChange(input.key, input.type === 'number' ? Number(event.target.value) : event.target.value)
              }
            />
          </label>
        ))
      ) : (
        <p>No inline parameters</p>
      )}
    </section>
  )
}
