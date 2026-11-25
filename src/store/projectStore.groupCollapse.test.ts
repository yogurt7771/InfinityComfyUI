import { describe, expect, it } from 'vitest'
import { createProjectSlice } from './projectStore'
import type { CanvasNode, FunctionInputDef } from '../domain/types'

type Slice = ReturnType<typeof createProjectSlice>

type Frame = { x: number; y: number; width: number; height: number }

const createSlice = (ids: string[] = []) => {
  let fallback = 0
  return createProjectSlice({
    idFactory: () => ids.shift() ?? `gen_${(fallback += 1)}`,
    now: () => '2026-11-25T00:00:00.000Z',
    randomInt: () => 1,
  })
}

const nodeById = (slice: Slice, nodeId: string) =>
  slice.getState().project.canvas.nodes.find((node) => node.id === nodeId)

const undoLength = (slice: Slice) => slice.getState().project.history?.undoStack.length ?? 0

const childIdsOf = (node: CanvasNode | undefined) => (node?.data.childNodeIds ?? []) as string[]

const frameOf = (node: CanvasNode): Frame => {
  const size = node.data.size as { width: number; height: number }
  return { x: node.position.x, y: node.position.y, width: size.width, height: size.height }
}

const expectFrameContainsFrame = (outer: Frame, inner: Frame) => {
  expect(outer.x).toBeLessThanOrEqual(inner.x)
  expect(outer.y).toBeLessThanOrEqual(inner.y)
  expect(outer.x + outer.width).toBeGreaterThanOrEqual(inner.x + inner.width)
  expect(outer.y + outer.height).toBeGreaterThanOrEqual(inner.y + inner.height)
}

const expectFrameContainsPoint = (outer: Frame, point: { x: number; y: number }) => {
  expect(outer.x).toBeLessThanOrEqual(point.x)
  expect(outer.y).toBeLessThanOrEqual(point.y)
  expect(outer.x + outer.width).toBeGreaterThanOrEqual(point.x)
  expect(outer.y + outer.height).toBeGreaterThanOrEqual(point.y)
}

const testComfyWorkflow = () => ({
  '6': {
    class_type: 'CLIPTextEncode',
    _meta: { title: 'Positive Prompt' },
    inputs: { text: 'warm interior render' },
  },
  '20': {
    class_type: 'SaveImage',
    _meta: { title: 'Result_Image' },
    inputs: { filename_prefix: 'infinity-comfyui' },
  },
})

const addPromptFunction = (slice: Slice) => {
  const functionId = slice.getState().addFunctionFromWorkflow('Interior Render Workflow', testComfyWorkflow())
  const promptInput: FunctionInputDef = {
    key: 'prompt',
    label: 'Prompt',
    type: 'text',
    required: true,
    defaultValue: 'warm interior render',
    bind: { nodeId: '6', nodeTitle: 'Positive Prompt', path: 'inputs.text' },
    upload: { strategy: 'none' },
  }
  slice.setState((state) => ({
    project: {
      ...state.project,
      functions: {
        ...state.project.functions,
        [functionId]: {
          ...state.project.functions[functionId]!,
          inputs: [promptInput, ...state.project.functions[functionId]!.inputs],
        },
      },
    },
  }))
  return functionId
}

// Two grouped prompts plus one ungrouped prompt far away.
const groupedSlice = () => {
  const slice = createSlice(['res_1', 'res_2', 'res_3', 'group_1'])
  slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 100, y: 120 })
  slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 480, y: 120 })
  slice.getState().addTextResourceAtPosition('Prompt 3', 'third', { x: 2000, y: 1600 })
  const groupNodeId = slice.getState().groupSelectedNodes({ nodeIds: ['node_res_1', 'node_res_2'] })
  expect(groupNodeId).toBeDefined()
  return { slice, groupNodeId: groupNodeId! }
}

// A grouped prompt connected to a function node, so the canvas has an edge.
const groupedWithEdgeSlice = () => {
  const slice = createSlice(['res_1', 'fn_1', 'node_fn_1', 'res_2', 'group_1'])
  slice.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 100, y: 120 })
  const functionId = addPromptFunction(slice)
  slice.getState().addFunctionNodeAtPosition(functionId, { x: 500, y: 120 })
  const functionNodeId = slice.getState().project.canvas.nodes.find((node) => node.type === 'function')!.id
  slice.getState().connectNodes('node_res_1', functionNodeId)
  slice.getState().addTextResourceAtPosition('Other', 'other text', { x: 100, y: 600 })
  const groupNodeId = slice.getState().groupSelectedNodes({ nodeIds: ['node_res_1', functionNodeId] })
  expect(groupNodeId).toBeDefined()
  expect(slice.getState().project.canvas.edges.length).toBeGreaterThan(0)
  return { slice, groupNodeId: groupNodeId!, functionNodeId }
}

describe('setGroupCollapsed', () => {
  it('sets data.collapsed to true and back to false', () => {
    const { slice, groupNodeId } = groupedSlice()
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(false)

    slice.getState().setGroupCollapsed(groupNodeId, true)
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(true)

    slice.getState().setGroupCollapsed(groupNodeId, false)
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(false)
  })

  it('changes nothing but the group collapsed flag', () => {
    const { slice, groupNodeId } = groupedWithEdgeSlice()
    const before = structuredClone(slice.getState().project.canvas)
    const groupBefore = before.nodes.find((node) => node.id === groupNodeId)!

    slice.getState().setGroupCollapsed(groupNodeId, true)

    const after = slice.getState().project.canvas
    expect(after.edges).toEqual(before.edges)
    expect(after.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id))
    for (const node of before.nodes) {
      if (node.id === groupNodeId) continue
      expect(after.nodes.find((candidate) => candidate.id === node.id)).toEqual(node)
    }
    const groupAfter = nodeById(slice, groupNodeId)!
    expect(groupAfter.type).toBe('group')
    expect(groupAfter.position).toEqual(groupBefore.position)
    expect(groupAfter.data.size).toEqual(groupBefore.data.size)
    expect(groupAfter.data.childNodeIds).toEqual(groupBefore.data.childNodeIds)
    expect(groupAfter.data).toEqual({ ...groupBefore.data, collapsed: true })

    slice.getState().setGroupCollapsed(groupNodeId, false)

    const expanded = slice.getState().project.canvas
    expect(expanded.edges).toEqual(before.edges)
    expect(expanded.nodes).toEqual(before.nodes)
  })

  it('ignores resource nodes and unknown ids', () => {
    const { slice } = groupedSlice()
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)
    const resourceBefore = structuredClone(nodeById(slice, 'node_res_3'))

    slice.getState().setGroupCollapsed('node_res_3', true)
    slice.getState().setGroupCollapsed('node_missing', true)
    slice.getState().setGroupCollapsed('node_res_1', false)

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
    expect(nodeById(slice, 'node_res_3')).toEqual(resourceBefore)
    expect(slice.getState().project.canvas.nodes.some((node) => node.id === 'node_missing')).toBe(false)
  })

  it('keeps the project reference and adds no history when already expanded', () => {
    const { slice, groupNodeId } = groupedSlice()
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)

    slice.getState().setGroupCollapsed(groupNodeId, false)

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
  })

  it('keeps the project reference and adds no history when already collapsed', () => {
    const { slice, groupNodeId } = groupedSlice()
    slice.getState().setGroupCollapsed(groupNodeId, true)
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)

    slice.getState().setGroupCollapsed(groupNodeId, true)

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
  })

  it('records exactly one group history entry per real change', () => {
    const { slice, groupNodeId } = groupedSlice()
    const historyBefore = undoLength(slice)

    slice.getState().setGroupCollapsed(groupNodeId, true)

    expect(undoLength(slice)).toBe(historyBefore + 1)
    expect(slice.getState().project.history?.undoStack.at(-1)).toEqual(
      expect.objectContaining({ transactionType: 'group' }),
    )

    slice.getState().setGroupCollapsed(groupNodeId, false)

    expect(undoLength(slice)).toBe(historyBefore + 2)
    expect(slice.getState().project.history?.undoStack.at(-1)).toEqual(
      expect.objectContaining({ transactionType: 'group' }),
    )
  })

  it('undoes and redoes collapse and expand', () => {
    const { slice, groupNodeId } = groupedSlice()
    const canvasBefore = structuredClone(slice.getState().project.canvas)

    slice.getState().setGroupCollapsed(groupNodeId, true)
    const canvasCollapsed = structuredClone(slice.getState().project.canvas)

    slice.getState().undoLastProjectChange()
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(false)
    expect(slice.getState().project.canvas.nodes).toEqual(canvasBefore.nodes)

    slice.getState().redoProjectChange()
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(true)
    expect(slice.getState().project.canvas.nodes).toEqual(canvasCollapsed.nodes)

    slice.getState().setGroupCollapsed(groupNodeId, false)
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(false)

    slice.getState().undoLastProjectChange()
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(true)

    slice.getState().redoProjectChange()
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(false)
  })

  it('selects only the group when collapsing', () => {
    const { slice, groupNodeId } = groupedSlice()
    slice.getState().selectNodes(['node_res_1', 'node_res_2'])

    slice.getState().setGroupCollapsed(groupNodeId, true)

    expect(slice.getState().selectedNodeIds).toEqual([groupNodeId])
  })

  it('does not change the selection when expanding', () => {
    const { slice, groupNodeId } = groupedSlice()
    slice.getState().setGroupCollapsed(groupNodeId, true)
    slice.getState().selectNodes(['node_res_3'])

    slice.getState().setGroupCollapsed(groupNodeId, false)

    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(false)
    expect(slice.getState().selectedNodeIds).toEqual(['node_res_3'])
  })

  it('keeps the collapsed state through export and import', () => {
    const { slice: source, groupNodeId } = groupedSlice()
    source.getState().setGroupCollapsed(groupNodeId, true)

    const exported = source.getState().exportProject()
    const destination = createSlice(['unused'])
    destination.getState().importProject(exported)

    const groups = destination.getState().project.canvas.nodes.filter((node) => node.type === 'group')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.data.collapsed).toBe(true)
    expect(childIdsOf(groups[0])).toHaveLength(2)
  })

  it('keeps an expanded group expanded through export and import', () => {
    const { slice: source } = groupedSlice()

    const exported = source.getState().exportProject()
    const destination = createSlice(['unused'])
    destination.getState().importProject(exported)

    const groups = destination.getState().project.canvas.nodes.filter((node) => node.type === 'group')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.data.collapsed).not.toBe(true)
  })

  it('moves members with a collapsed group and keeps their relative positions after expanding', () => {
    const { slice, groupNodeId } = groupedSlice()
    const group = nodeById(slice, groupNodeId)!
    const relative = (nodeId: string, origin: { x: number; y: number }) => {
      const position = nodeById(slice, nodeId)!.position
      return { x: position.x - origin.x, y: position.y - origin.y }
    }
    const relative1 = relative('node_res_1', group.position)
    const relative2 = relative('node_res_2', group.position)
    const outsiderBefore = structuredClone(nodeById(slice, 'node_res_3')!.position)
    slice.getState().setGroupCollapsed(groupNodeId, true)

    const nextPosition = { x: group.position.x + 300, y: group.position.y + 150 }
    slice.getState().updateNodePositions({ [groupNodeId]: nextPosition })

    expect(nodeById(slice, groupNodeId)?.position).toEqual(nextPosition)
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(true)
    expect(relative('node_res_1', nextPosition)).toEqual(relative1)
    expect(relative('node_res_2', nextPosition)).toEqual(relative2)

    slice.getState().setGroupCollapsed(groupNodeId, false)

    const groupAfter = nodeById(slice, groupNodeId)!
    expect(groupAfter.position).toEqual(nextPosition)
    expect(relative('node_res_1', groupAfter.position)).toEqual(relative1)
    expect(relative('node_res_2', groupAfter.position)).toEqual(relative2)
    expect(nodeById(slice, 'node_res_3')?.position).toEqual(outsiderBefore)
  })

  it('ungrouping a collapsed group removes the group and keeps members in place', () => {
    const { slice, groupNodeId } = groupedSlice()
    slice.getState().setGroupCollapsed(groupNodeId, true)
    const member1 = structuredClone(nodeById(slice, 'node_res_1')!)
    const member2 = structuredClone(nodeById(slice, 'node_res_2')!)

    slice.getState().ungroupNode(groupNodeId)

    expect(nodeById(slice, groupNodeId)).toBeUndefined()
    expect(nodeById(slice, 'node_res_1')?.position).toEqual(member1.position)
    expect(nodeById(slice, 'node_res_2')?.position).toEqual(member2.position)
    expect(nodeById(slice, 'node_res_1')).toEqual(member1)
    expect(nodeById(slice, 'node_res_2')).toEqual(member2)
  })
})

describe('group templates with collapsed state', () => {
  const instantiatedGroup = (slice: Slice, templateId: string) => {
    const beforeIds = new Set(slice.getState().project.canvas.nodes.map((node) => node.id))
    const newGroupId = slice.getState().instantiateTemplate(templateId, { x: 900, y: 900 })
    expect(newGroupId).toBeDefined()
    const newGroups = slice.getState().project.canvas.nodes.filter(
      (node) => !beforeIds.has(node.id) && node.type === 'group',
    )
    expect(newGroups).toHaveLength(1)
    expect(newGroups[0]!.id).toBe(newGroupId)
    return newGroups[0]!
  }

  it('saves collapsed: true from a single selected collapsed group and instantiates it collapsed', () => {
    const { slice, groupNodeId } = groupedSlice()
    slice.getState().setGroupCollapsed(groupNodeId, true)
    slice.getState().selectNodes([groupNodeId])

    const templateId = slice.getState().saveTemplateFromSelection('Collapsed Pair')
    expect(templateId).toBeDefined()
    expect(slice.getState().project.templates?.[templateId!]?.collapsed).toBe(true)

    const group = instantiatedGroup(slice, templateId!)
    expect(group.data.collapsed).toBe(true)
    expect(nodeById(slice, groupNodeId)?.data.collapsed).toBe(true)
  })

  it('does not store collapsed: true from an expanded group and instantiates it expanded', () => {
    const { slice, groupNodeId } = groupedSlice()
    slice.getState().selectNodes([groupNodeId])

    const templateId = slice.getState().saveTemplateFromSelection('Expanded Pair')
    expect(templateId).toBeDefined()
    expect(slice.getState().project.templates?.[templateId!]?.collapsed).not.toBe(true)

    const group = instantiatedGroup(slice, templateId!)
    expect(group.data.collapsed).toBe(false)
  })

  it('does not store collapsed: true from plain nodes and instantiates the group expanded', () => {
    const slice = createSlice(['res_1', 'res_2'])
    slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 100, y: 120 })
    slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 480, y: 120 })
    slice.getState().selectNodes(['node_res_1', 'node_res_2'])

    const templateId = slice.getState().saveTemplateFromSelection('Plain Pair')
    expect(templateId).toBeDefined()
    expect(slice.getState().project.templates?.[templateId!]?.collapsed).not.toBe(true)

    const group = instantiatedGroup(slice, templateId!)
    expect(group.data.collapsed).toBe(false)
  })
})

describe('addNodesToGroup', () => {
  it('appends new member ids after existing ones', () => {
    const { slice, groupNodeId } = groupedSlice()

    slice.getState().addNodesToGroup(groupNodeId, ['node_res_3'])

    expect(childIdsOf(nodeById(slice, groupNodeId))).toEqual(['node_res_1', 'node_res_2', 'node_res_3'])
  })

  it('ignores unknown ids, group ids and existing members, without duplicates', () => {
    const slice = createSlice(['res_1', 'res_2', 'res_3', 'res_4', 'res_5', 'group_1', 'group_2'])
    slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 100, y: 120 })
    slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 480, y: 120 })
    slice.getState().addTextResourceAtPosition('Prompt 3', 'third', { x: 100, y: 500 })
    slice.getState().addTextResourceAtPosition('Prompt 4', 'fourth', { x: 3000, y: 3000 })
    slice.getState().addTextResourceAtPosition('Prompt 5', 'fifth', { x: 3400, y: 3000 })
    const groupNodeId = slice.getState().groupSelectedNodes({ nodeIds: ['node_res_1', 'node_res_2'] })!
    const otherGroupId = slice.getState().groupSelectedNodes({ nodeIds: ['node_res_4', 'node_res_5'] })!
    expect(groupNodeId).toBeDefined()
    expect(otherGroupId).toBeDefined()

    slice.getState().addNodesToGroup(groupNodeId, [
      'node_missing',
      otherGroupId,
      groupNodeId,
      'node_res_2',
      'node_res_3',
      'node_res_3',
    ])

    expect(childIdsOf(nodeById(slice, groupNodeId))).toEqual(['node_res_1', 'node_res_2', 'node_res_3'])
    expect(childIdsOf(nodeById(slice, otherGroupId))).toEqual(['node_res_4', 'node_res_5'])
  })

  it('keeps the project reference and adds no history when nothing is added', () => {
    const { slice, groupNodeId } = groupedSlice()
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)

    slice.getState().addNodesToGroup(groupNodeId, ['node_res_1', 'node_missing', groupNodeId])
    slice.getState().addNodesToGroup(groupNodeId, [])

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
  })

  it('ignores a target that is not a group', () => {
    const { slice } = groupedSlice()
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)

    slice.getState().addNodesToGroup('node_res_3', ['node_res_1'])
    slice.getState().addNodesToGroup('node_missing', ['node_res_3'])

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
  })

  it('grows the frame to cover the added node and never shrinks', () => {
    const { slice, groupNodeId } = groupedSlice()
    const frameBefore = frameOf(nodeById(slice, groupNodeId)!)
    const addedPosition = structuredClone(nodeById(slice, 'node_res_3')!.position)
    expect(addedPosition.x).toBeGreaterThan(frameBefore.x + frameBefore.width)
    expect(addedPosition.y).toBeGreaterThan(frameBefore.y + frameBefore.height)

    slice.getState().addNodesToGroup(groupNodeId, ['node_res_3'])

    const frameAfter = frameOf(nodeById(slice, groupNodeId)!)
    expectFrameContainsFrame(frameAfter, frameBefore)
    expectFrameContainsPoint(frameAfter, addedPosition)
    expect(nodeById(slice, 'node_res_3')?.position).toEqual(addedPosition)
  })

  it('grows the frame toward a node above and left of the group', () => {
    const slice = createSlice(['res_1', 'res_2', 'res_3', 'group_1'])
    slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 1000, y: 1000 })
    slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 1400, y: 1000 })
    slice.getState().addTextResourceAtPosition('Prompt 3', 'third', { x: -400, y: -300 })
    const groupNodeId = slice.getState().groupSelectedNodes({ nodeIds: ['node_res_1', 'node_res_2'] })!
    const frameBefore = frameOf(nodeById(slice, groupNodeId)!)
    const addedPosition = structuredClone(nodeById(slice, 'node_res_3')!.position)

    slice.getState().addNodesToGroup(groupNodeId, ['node_res_3'], { node_res_3: { width: 360, height: 240 } })

    const frameAfter = frameOf(nodeById(slice, groupNodeId)!)
    expectFrameContainsFrame(frameAfter, frameBefore)
    expectFrameContainsPoint(frameAfter, addedPosition)
    expect(childIdsOf(nodeById(slice, groupNodeId))).toEqual(['node_res_1', 'node_res_2', 'node_res_3'])
  })

  it('does not shrink the frame when the added node is already inside it', () => {
    const slice = createSlice(['res_1', 'res_2', 'res_3', 'group_1'])
    slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 100, y: 120 })
    slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 900, y: 900 })
    slice.getState().addTextResourceAtPosition('Prompt 3', 'third', { x: 400, y: 400 })
    const groupNodeId = slice.getState().groupSelectedNodes({ nodeIds: ['node_res_1', 'node_res_2'] })!
    const frameBefore = frameOf(nodeById(slice, groupNodeId)!)
    const addedPosition = structuredClone(nodeById(slice, 'node_res_3')!.position)
    expectFrameContainsPoint(frameBefore, addedPosition)

    slice.getState().addNodesToGroup(groupNodeId, ['node_res_3'])

    const frameAfter = frameOf(nodeById(slice, groupNodeId)!)
    expectFrameContainsFrame(frameAfter, frameBefore)
    expect(childIdsOf(nodeById(slice, groupNodeId))).toContain('node_res_3')
  })

  it('records one history entry per real change, undoable and redoable', () => {
    const { slice, groupNodeId } = groupedSlice()
    const groupBefore = structuredClone(nodeById(slice, groupNodeId)!)
    const historyBefore = undoLength(slice)

    slice.getState().addNodesToGroup(groupNodeId, ['node_res_3'])

    expect(undoLength(slice)).toBe(historyBefore + 1)
    const groupAfter = structuredClone(nodeById(slice, groupNodeId)!)

    slice.getState().undoLastProjectChange()
    expect(nodeById(slice, groupNodeId)).toEqual(groupBefore)

    slice.getState().redoProjectChange()
    expect(nodeById(slice, groupNodeId)).toEqual(groupAfter)
    expect(childIdsOf(nodeById(slice, groupNodeId))).toEqual(['node_res_1', 'node_res_2', 'node_res_3'])
  })

  it('makes the added node move with the group', () => {
    const { slice, groupNodeId } = groupedSlice()
    slice.getState().addNodesToGroup(groupNodeId, ['node_res_3'])
    const group = nodeById(slice, groupNodeId)!
    const addedBefore = structuredClone(nodeById(slice, 'node_res_3')!.position)

    slice.getState().updateNodePositions({ [groupNodeId]: { x: group.position.x + 50, y: group.position.y - 20 } })

    expect(nodeById(slice, 'node_res_3')?.position).toEqual({ x: addedBefore.x + 50, y: addedBefore.y - 20 })
  })
})
