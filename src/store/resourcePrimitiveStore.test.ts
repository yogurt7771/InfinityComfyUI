import { describe, expect, it } from 'vitest'
import { createProjectSlice } from './projectStore'

type TextDisplayMode =
  | 'plaintext'
  | 'markdown'
  | 'html'
  | 'json'
  | 'yaml'
  | 'render markdown'
  | 'render html'

type PrimitiveResourceActions = {
  updateTextResourceDisplayMode: (resourceId: string, displayMode: TextDisplayMode) => void
  updateBooleanResourceValue: (resourceId: string, value: boolean) => void
}

const actions = (slice: ReturnType<typeof createProjectSlice>) =>
  slice.getState() as ReturnType<typeof slice.getState> & PrimitiveResourceActions

describe('primitive resource state', () => {
  it('creates text resources in plaintext mode and persists mode across project export and import', () => {
    const source = createProjectSlice({
      idFactory: () => 'res_text',
      now: () => '2026-07-13T00:00:00.000Z',
      randomInt: () => 1,
    })
    source.getState().addEmptyResourceAtPosition('text', { x: 80, y: 120 }, '{"ready":true}')

    expect(source.getState().project.resources.res_text).toMatchObject({ displayMode: 'plaintext' })

    actions(source).updateTextResourceDisplayMode('res_text', 'json')
    const exported = source.getState().exportProject()
    expect(exported.project.resources.res_text).toMatchObject({ displayMode: 'json' })

    const destination = createProjectSlice({
      idFactory: () => 'unused',
      now: () => '2026-07-13T00:01:00.000Z',
      randomInt: () => 1,
    })
    destination.getState().importProject(exported)

    expect(destination.getState().project.resources.res_text).toMatchObject({ displayMode: 'json' })
  })

  it('normalizes imported legacy text resources without a mode to plaintext', () => {
    const source = createProjectSlice({
      idFactory: () => 'res_legacy',
      now: () => '2026-07-13T00:00:00.000Z',
      randomInt: () => 1,
    })
    source.getState().addTextResourceAtPosition('Legacy', 'plain value', { x: 20, y: 40 })
    const exported = source.getState().exportProject()
    delete (exported.project.resources.res_legacy as unknown as { displayMode?: TextDisplayMode }).displayMode

    const destination = createProjectSlice({
      idFactory: () => 'unused',
      now: () => '2026-07-13T00:01:00.000Z',
      randomInt: () => 1,
    })
    destination.getState().importProject(exported)

    expect(destination.getState().project.resources.res_legacy).toMatchObject({ displayMode: 'plaintext' })
  })

  it('undoes and redoes text source edits and display-mode changes', () => {
    const slice = createProjectSlice({
      idFactory: () => 'res_text',
      now: () => '2026-07-13T00:00:00.000Z',
      randomInt: () => 1,
    })
    slice.getState().addTextResourceAtPosition('Prompt', 'before', { x: 20, y: 40 })

    actions(slice).updateTextResourceDisplayMode('res_text', 'markdown')
    slice.getState().updateTextResourceValue('res_text', '# after')
    expect(slice.getState().project.resources.res_text).toMatchObject({ value: '# after', displayMode: 'markdown' })

    slice.getState().undoLastProjectChange()
    expect(slice.getState().project.resources.res_text).toMatchObject({ value: 'before', displayMode: 'markdown' })
    slice.getState().undoLastProjectChange()
    expect(slice.getState().project.resources.res_text).toMatchObject({ value: 'before', displayMode: 'plaintext' })

    slice.getState().redoProjectChange()
    slice.getState().redoProjectChange()
    expect(slice.getState().project.resources.res_text).toMatchObject({ value: '# after', displayMode: 'markdown' })
  })

  it('updates boolean values and supports undo and redo', () => {
    const slice = createProjectSlice({
      idFactory: () => 'res_boolean',
      now: () => '2026-07-13T00:00:00.000Z',
      randomInt: () => 1,
    })
    slice.getState().addEmptyResourceAtPosition('boolean', { x: 20, y: 40 }, false)

    actions(slice).updateBooleanResourceValue('res_boolean', true)
    expect(slice.getState().project.resources.res_boolean.value).toBe(true)

    slice.getState().undoLastProjectChange()
    expect(slice.getState().project.resources.res_boolean.value).toBe(false)
    slice.getState().redoProjectChange()
    expect(slice.getState().project.resources.res_boolean.value).toBe(true)
  })
})
