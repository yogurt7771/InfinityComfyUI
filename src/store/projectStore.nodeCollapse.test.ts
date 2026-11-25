import { describe, expect, it } from 'vitest'
import { createProjectSlice } from './projectStore'
import { flowNodeStyle } from '../components/CanvasWorkspace'
import { isCollapsedCanvasNode, RESOURCE_NODE_COLLAPSED_HEIGHT } from '../domain/resourceNodeLayout'
import type { CanvasNode, FunctionInputDef } from '../domain/types'

type Slice = ReturnType<typeof createProjectSlice>

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

const twoPromptsSlice = () => {
  const slice = createSlice(['res_1', 'res_2'])
  slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 100, y: 120 })
  slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 480, y: 120 })
  return slice
}

describe('setNodesCollapsed', () => {
  it('collapses resource nodes by setting data.collapsed to true', () => {
    const slice = twoPromptsSlice()

    slice.getState().setNodesCollapsed(['node_res_1'], true)

    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')
  })

  it('collapses every listed resource node in one call', () => {
    const slice = twoPromptsSlice()

    slice.getState().setNodesCollapsed(['node_res_1', 'node_res_2'], true)

    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_2')?.data.collapsed).toBe(true)
  })

  it('expands by removing the collapsed key instead of setting it to false', () => {
    const slice = twoPromptsSlice()

    slice.getState().setNodesCollapsed(['node_res_1', 'node_res_2'], true)
    slice.getState().setNodesCollapsed(['node_res_1', 'node_res_2'], false)

    expect(nodeById(slice, 'node_res_1')?.data).not.toHaveProperty('collapsed')
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')
  })

  it('ignores unknown ids and still collapses the known resource nodes', () => {
    const slice = twoPromptsSlice()

    slice.getState().setNodesCollapsed(['node_missing', 'node_res_2'], true)

    expect(nodeById(slice, 'node_res_2')?.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_1')?.data).not.toHaveProperty('collapsed')
    expect(slice.getState().project.canvas.nodes.some((node) => node.id === 'node_missing')).toBe(false)
  })

  it('leaves non-resource nodes untouched even when listed', () => {
    const slice = createSlice(['res_1', 'fn_1', 'node_fn_1'])
    slice.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 100, y: 120 })
    const functionId = addPromptFunction(slice)
    slice.getState().addFunctionNodeAtPosition(functionId, { x: 500, y: 120 })
    const functionNode = slice.getState().project.canvas.nodes.find((node) => node.type === 'function')
    expect(functionNode).toBeDefined()
    const functionNodeBefore = structuredClone(functionNode!)

    slice.getState().setNodesCollapsed([functionNode!.id, 'node_res_1'], true)

    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
    expect(nodeById(slice, functionNode!.id)).toEqual(functionNodeBefore)
    expect(nodeById(slice, functionNode!.id)?.data).not.toHaveProperty('collapsed')
  })

  it('leaves group nodes untouched and records nothing when only a group is listed', () => {
    const slice = createSlice(['res_1', 'res_2', 'group_1'])
    slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 100, y: 120 })
    slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 480, y: 120 })
    slice.getState().selectNodes(['node_res_1', 'node_res_2'])
    const groupNodeId = slice.getState().groupSelectedNodes()
    expect(groupNodeId).toBeDefined()
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)
    const groupBefore = structuredClone(nodeById(slice, groupNodeId!))

    slice.getState().setNodesCollapsed([groupNodeId!], true)

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
    expect(nodeById(slice, groupNodeId!)).toEqual(groupBefore)
    expect(nodeById(slice, 'node_res_1')?.data).not.toHaveProperty('collapsed')
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')
  })

  it('changes no other node, position, data key, or edge', () => {
    const slice = createSlice(['res_1', 'fn_1', 'node_fn_1', 'res_2'])
    slice.getState().addTextResourceAtPosition('Prompt', 'warm kitchen', { x: 100, y: 120 })
    const functionId = addPromptFunction(slice)
    slice.getState().addFunctionNodeAtPosition(functionId, { x: 500, y: 120 })
    const functionNodeId = slice.getState().project.canvas.nodes.find((node) => node.type === 'function')!.id
    slice.getState().connectNodes('node_res_1', functionNodeId)
    slice.getState().addTextResourceAtPosition('Other', 'other text', { x: 100, y: 600 })
    slice.getState().updateNodeSize('node_res_1', { width: 520, height: 420 })

    const before = structuredClone(slice.getState().project.canvas)
    expect(before.edges.length).toBeGreaterThan(0)
    const targetBefore = before.nodes.find((node) => node.id === 'node_res_1')!

    slice.getState().setNodesCollapsed(['node_res_1'], true)

    const after = slice.getState().project.canvas
    expect(after.edges).toEqual(before.edges)
    expect(after.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id))
    for (const node of before.nodes) {
      if (node.id === 'node_res_1') continue
      expect(after.nodes.find((candidate) => candidate.id === node.id)).toEqual(node)
    }
    const targetAfter = nodeById(slice, 'node_res_1')!
    expect(targetAfter.type).toBe(targetBefore.type)
    expect(targetAfter.position).toEqual(targetBefore.position)
    expect(targetAfter.data).toEqual({ ...targetBefore.data, collapsed: true })

    slice.getState().setNodesCollapsed(['node_res_1'], false)

    expect(slice.getState().project.canvas.edges).toEqual(before.edges)
    expect(nodeById(slice, 'node_res_1')).toEqual(targetBefore)
  })

  it('does not replace project state or add history when nodes are already collapsed', () => {
    const slice = twoPromptsSlice()
    slice.getState().setNodesCollapsed(['node_res_1'], true)
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)

    slice.getState().setNodesCollapsed(['node_res_1'], true)

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
  })

  it('does not replace project state or add history when expanding already-expanded nodes', () => {
    const slice = twoPromptsSlice()
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)

    slice.getState().setNodesCollapsed(['node_res_1', 'node_res_2'], false)

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
  })

  it('does not replace project state or add history for unknown ids or an empty list', () => {
    const slice = twoPromptsSlice()
    const projectBefore = slice.getState().project
    const historyBefore = undoLength(slice)

    slice.getState().setNodesCollapsed(['node_missing'], true)
    slice.getState().setNodesCollapsed([], true)

    expect(slice.getState().project).toBe(projectBefore)
    expect(undoLength(slice)).toBe(historyBefore)
  })

  it('records exactly one canvas history entry for a real change', () => {
    const slice = twoPromptsSlice()
    const historyBefore = undoLength(slice)

    slice.getState().setNodesCollapsed(['node_res_1', 'node_res_2'], true)

    expect(undoLength(slice)).toBe(historyBefore + 1)
    expect(slice.getState().project.history?.undoStack.at(-1)).toEqual(
      expect.objectContaining({ transactionType: 'canvas' }),
    )
  })

  it('undoes and redoes the collapse of all affected nodes in one step', () => {
    const slice = twoPromptsSlice()
    slice.getState().setNodesCollapsed(['node_res_1'], true)
    const historyBefore = undoLength(slice)

    slice.getState().setNodesCollapsed(['node_res_1', 'node_res_2'], false)
    expect(undoLength(slice)).toBe(historyBefore + 1)
    expect(nodeById(slice, 'node_res_1')?.data).not.toHaveProperty('collapsed')

    slice.getState().setNodesCollapsed(['node_res_1', 'node_res_2'], true)
    expect(undoLength(slice)).toBe(historyBefore + 2)
    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_2')?.data.collapsed).toBe(true)

    slice.getState().undoLastProjectChange()

    expect(nodeById(slice, 'node_res_1')?.data).not.toHaveProperty('collapsed')
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')

    slice.getState().redoProjectChange()

    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_2')?.data.collapsed).toBe(true)
  })

  it('undo restores mixed previous states of the affected nodes', () => {
    const slice = twoPromptsSlice()
    slice.getState().setNodesCollapsed(['node_res_1'], true)

    slice.getState().setNodesCollapsed(['node_res_1', 'node_res_2'], false)
    expect(nodeById(slice, 'node_res_1')?.data).not.toHaveProperty('collapsed')
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')

    slice.getState().undoLastProjectChange()

    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')

    slice.getState().redoProjectChange()

    expect(nodeById(slice, 'node_res_1')?.data).not.toHaveProperty('collapsed')
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')
  })
})

describe('isCollapsedCanvasNode', () => {
  it('is true only for resource nodes with data.collapsed === true', () => {
    expect(isCollapsedCanvasNode({ type: 'resource', data: { resourceId: 'res_1', collapsed: true } })).toBe(true)
    expect(isCollapsedCanvasNode({ type: 'resource', data: { resourceId: 'res_1' } })).toBe(false)
    expect(isCollapsedCanvasNode({ type: 'resource', data: { resourceId: 'res_1', collapsed: false } })).toBe(false)
    expect(isCollapsedCanvasNode({ type: 'resource', data: { resourceId: 'res_1', collapsed: 'yes' } })).toBe(false)
    expect(isCollapsedCanvasNode({ type: 'resource', data: { resourceId: 'res_1', collapsed: 1 } })).toBe(false)
    expect(isCollapsedCanvasNode({ type: 'group', data: { childNodeIds: [], collapsed: true } })).toBe(false)
    expect(isCollapsedCanvasNode({ type: 'function', data: { functionId: 'fn_1', collapsed: true } })).toBe(false)
  })
})

describe('flowNodeStyle for collapsed resource nodes', () => {
  const context = { resourcesById: {}, functionsById: {}, tasksById: {} }

  const resourceNode = (data: Record<string, unknown>): CanvasNode => ({
    id: 'asset_1',
    type: 'resource',
    position: { x: 0, y: 0 },
    data,
  })

  it('exposes a collapsed height of 58', () => {
    expect(RESOURCE_NODE_COLLAPSED_HEIGHT).toBe(58)
  })

  it.each([
    ['image', { resourceId: 'res_1', resourceType: 'image', title: 'Image' }],
    ['text', { resourceId: 'res_1', resourceType: 'text', title: 'Prompt' }],
    ['image with stored size', { resourceId: 'res_1', resourceType: 'image', title: 'Image', size: { width: 520, height: 460 } }],
    ['text with stored size', { resourceId: 'res_1', resourceType: 'text', title: 'Prompt', size: { width: 610, height: 380 } }],
  ])('keeps the expanded width and uses the collapsed height for a %s node', (_label, data) => {
    const expanded = flowNodeStyle(resourceNode(data), context)
    const collapsed = flowNodeStyle(resourceNode({ ...data, collapsed: true }), context)

    expect(collapsed.height).toBe(RESOURCE_NODE_COLLAPSED_HEIGHT)
    expect(collapsed.width).toBe(expanded.width)
    expect(expanded.height).toBeDefined()
    expect(expanded.height!).toBeGreaterThan(RESOURCE_NODE_COLLAPSED_HEIGHT)
  })

  it('keeps the stored width when a sized node is collapsed', () => {
    const data = { resourceId: 'res_1', resourceType: 'image', title: 'Image', size: { width: 520, height: 460 } }
    const expanded = flowNodeStyle(resourceNode(data), context)
    const collapsed = flowNodeStyle(resourceNode({ ...data, collapsed: true }), context)

    expect(expanded.width).toBe(520)
    expect(collapsed.width).toBe(520)
  })
})

describe('collapsed state through existing operations', () => {
  it('duplicates a collapsed node as collapsed and keeps the original collapsed', () => {
    const slice = twoPromptsSlice()
    slice.getState().setNodesCollapsed(['node_res_1'], true)
    const beforeIds = new Set(slice.getState().project.canvas.nodes.map((node) => node.id))

    slice.getState().duplicateNodes(['node_res_1'])

    const newNodes = slice.getState().project.canvas.nodes.filter((node) => !beforeIds.has(node.id))
    expect(newNodes).toHaveLength(1)
    expect(newNodes[0]!.type).toBe('resource')
    expect(newNodes[0]!.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')
  })

  it('keeps a node collapsed after grouping and ungrouping', () => {
    const slice = createSlice(['res_1', 'res_2', 'group_1'])
    slice.getState().addTextResourceAtPosition('Prompt 1', 'first', { x: 100, y: 120 })
    slice.getState().addTextResourceAtPosition('Prompt 2', 'second', { x: 480, y: 120 })
    slice.getState().setNodesCollapsed(['node_res_1'], true)
    slice.getState().selectNodes(['node_res_1', 'node_res_2'])

    const groupNodeId = slice.getState().groupSelectedNodes()
    expect(groupNodeId).toBeDefined()
    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)

    slice.getState().ungroupNode(groupNodeId!)

    expect(nodeById(slice, groupNodeId!)).toBeUndefined()
    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
    expect(nodeById(slice, 'node_res_2')?.data).not.toHaveProperty('collapsed')
  })

  it('instantiates a collapsed node from a template as collapsed', () => {
    const slice = twoPromptsSlice()
    slice.getState().setNodesCollapsed(['node_res_1'], true)
    slice.getState().selectNodes(['node_res_1', 'node_res_2'])

    const templateId = slice.getState().saveTemplateFromSelection('Prompt Pair')
    expect(templateId).toBeDefined()
    const beforeIds = new Set(slice.getState().project.canvas.nodes.map((node) => node.id))

    const groupNodeId = slice.getState().instantiateTemplate(templateId!, { x: 600, y: 300 })
    expect(groupNodeId).toBeDefined()

    const state = slice.getState()
    const newResourceNodes = state.project.canvas.nodes.filter(
      (node) => !beforeIds.has(node.id) && node.type === 'resource',
    )
    expect(newResourceNodes).toHaveLength(2)
    const parentOf = (node: CanvasNode) => {
      const resource = state.project.resources[String(node.data.resourceId)]
      const source = resource?.source as { parentResourceId?: string } | undefined
      return source?.parentResourceId
    }
    const copyOfFirst = newResourceNodes.find((node) => parentOf(node) === 'res_1')
    const copyOfSecond = newResourceNodes.find((node) => parentOf(node) === 'res_2')
    expect(copyOfFirst).toBeDefined()
    expect(copyOfSecond).toBeDefined()
    expect(copyOfFirst!.data.collapsed).toBe(true)
    expect(copyOfSecond!.data).not.toHaveProperty('collapsed')
    expect(nodeById(slice, 'node_res_1')?.data.collapsed).toBe(true)
  })

  it('keeps a node collapsed through project export and import', () => {
    const source = twoPromptsSlice()
    source.getState().setNodesCollapsed(['node_res_1'], true)

    const exported = source.getState().exportProject()

    const destination = createSlice(['unused'])
    destination.getState().importProject(exported)

    const project = destination.getState().project
    const nodeForResourceNamed = (name: string) => {
      const resource = Object.values(project.resources).find((candidate) => candidate.name === name)
      expect(resource).toBeDefined()
      return project.canvas.nodes.find((node) => node.type === 'resource' && node.data.resourceId === resource!.id)
    }
    const first = nodeForResourceNamed('Prompt 1')
    const second = nodeForResourceNamed('Prompt 2')
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first!.data.collapsed).toBe(true)
    expect(second!.data).not.toHaveProperty('collapsed')
  })
})
