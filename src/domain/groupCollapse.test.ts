import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { collapseGroupEdges, isCollapsedGroupNode } from './groupCollapse'
import type { CollapsedGroupView } from './groupCollapse'
import type { CanvasNode } from './types'

const resource = (id: string, x = 0, y = 0): CanvasNode => ({
  id,
  type: 'resource',
  position: { x, y },
  data: { resourceId: `res_${id}` },
})

const fnNode = (id: string, x = 0, y = 0): CanvasNode => ({
  id,
  type: 'function',
  position: { x, y },
  data: { functionId: `fn_${id}` },
})

const group = (id: string, childNodeIds: string[], collapsed: boolean, x = 0, y = 0): CanvasNode => ({
  id,
  type: 'group',
  position: { x, y },
  data: { childNodeIds, collapsed },
})

const edge = (
  id: string,
  source: string,
  target: string,
  extra: Partial<Omit<Edge, 'id' | 'source' | 'target'>> = {},
): Edge => ({ id, source, target, ...extra })

const ports = (view: CollapsedGroupView, groupId: string) => {
  const entry = view.portsByGroupId.get(groupId)
  expect(entry).toBeDefined()
  return entry as NonNullable<typeof entry>
}

const allHandles = (view: CollapsedGroupView, groupId: string, direction: 'inputs' | 'outputs') =>
  (view.portsByGroupId.get(groupId)?.[direction] ?? []).map((port) => port.handleId)

describe('isCollapsedGroupNode', () => {
  it('is true only for group nodes whose data.collapsed is exactly true', () => {
    expect(isCollapsedGroupNode({ type: 'group', data: { childNodeIds: [], collapsed: true } })).toBe(true)
    expect(isCollapsedGroupNode({ type: 'group', data: { childNodeIds: [], collapsed: false } })).toBe(false)
    expect(isCollapsedGroupNode({ type: 'group', data: { childNodeIds: [] } })).toBe(false)
    expect(isCollapsedGroupNode({ type: 'group', data: { collapsed: 'true' } })).toBe(false)
    expect(isCollapsedGroupNode({ type: 'group', data: { collapsed: 1 } })).toBe(false)
    expect(isCollapsedGroupNode({ type: 'resource', data: { resourceId: 'r', collapsed: true } })).toBe(false)
    expect(isCollapsedGroupNode({ type: 'function', data: { collapsed: true } })).toBe(false)
  })
})

describe('collapseGroupEdges', () => {
  it('returns the same edges array and no ports when no group is collapsed', () => {
    const nodes = [resource('a'), fnNode('f')]
    const edges = [edge('e1', 'a', 'f', { sourceHandle: 'resource:res_a', targetHandle: 'input:prompt' })]
    const view = collapseGroupEdges(edges, nodes)
    expect(view.edges).toBe(edges)
    expect(view.hiddenBy.size).toBe(0)
    expect(view.portsByGroupId.size).toBe(0)
  })

  it('treats expanded groups as transparent', () => {
    const nodes = [resource('m1'), resource('m2'), fnNode('f', 400), group('g', ['m1', 'm2'], false)]
    const edges = [
      edge('e1', 'm1', 'm2'),
      edge('e2', 'm1', 'f', { sourceHandle: 'resource:res_m1', targetHandle: 'input:prompt', label: 'prompt' }),
    ]
    const view = collapseGroupEdges(edges, nodes)
    expect(view.hiddenBy.size).toBe(0)
    expect(view.edges).toBe(edges)
    expect(view.portsByGroupId.size).toBe(0)
  })

  it('does not hide members of an expanded group while another group is collapsed', () => {
    const nodes = [
      resource('m1'),
      resource('x1', 0, 300),
      fnNode('x2', 400, 300),
      fnNode('f', 400),
      group('g', ['m1'], true),
      group('open', ['x1', 'x2'], false),
    ]
    const passthrough = edge('e_open', 'x1', 'x2', { sourceHandle: 'resource:res_x1', targetHandle: 'input:a' })
    const edges = [edge('e1', 'm1', 'f', { sourceHandle: 'resource:res_m1', targetHandle: 'input:prompt' }), passthrough]
    const view = collapseGroupEdges(edges, nodes)
    expect([...view.hiddenBy.entries()]).toEqual([['m1', 'g']])
    expect(view.edges).toContain(passthrough)
    expect(view.portsByGroupId.has('open')).toBe(false)
  })

  it('maps every existing member of a collapsed group to the group and ignores ids missing from nodes', () => {
    const nodes = [resource('m1'), resource('m2'), group('g', ['m1', 'm2', 'ghost'], true)]
    const view = collapseGroupEdges([], nodes)
    expect(view.hiddenBy.get('m1')).toBe('g')
    expect(view.hiddenBy.get('m2')).toBe('g')
    expect(view.hiddenBy.has('ghost')).toBe(false)
    expect(view.hiddenBy.size).toBe(2)
  })

  it('maps a node in two collapsed groups to the first group in nodes order', () => {
    const nodes = [
      resource('m1'),
      resource('shared'),
      resource('m2'),
      group('g_b', ['shared', 'm2'], true),
      group('g_a', ['m1', 'shared'], true),
    ]
    const view = collapseGroupEdges([], nodes)
    expect(view.hiddenBy.get('shared')).toBe('g_b')
    expect(view.hiddenBy.get('m1')).toBe('g_a')
    expect(view.hiddenBy.get('m2')).toBe('g_b')
  })

  it('drops edges whose ends are both hidden by the same group', () => {
    const nodes = [resource('m1'), fnNode('m2', 300), resource('m3', 0, 200), group('g', ['m1', 'm2', 'm3'], true)]
    const edges = [
      edge('e1', 'm1', 'm2', { sourceHandle: 'resource:res_m1', targetHandle: 'input:prompt' }),
      edge('e2', 'm3', 'm2', { sourceHandle: 'resource:res_m3', targetHandle: 'input:image' }),
    ]
    const view = collapseGroupEdges(edges, nodes)
    expect(view.edges).toEqual([])
    const groupPorts = view.portsByGroupId.get('g')
    expect(groupPorts?.inputs ?? []).toEqual([])
    expect(groupPorts?.outputs ?? []).toEqual([])
  })

  it('merges one outside source feeding three members into one input port and one edge', () => {
    const nodes = [
      resource('out', -400, 0),
      fnNode('m1', 0, 0),
      fnNode('m2', 0, 200),
      fnNode('m3', 0, 400),
      group('g', ['m1', 'm2', 'm3'], true),
    ]
    const edges = [
      edge('e1', 'out', 'm1', { sourceHandle: 'resource:res_out', targetHandle: 'input:prompt', label: 'prompt' }),
      edge('e2', 'out', 'm2', { sourceHandle: 'resource:res_out', targetHandle: 'input:text', label: 'text' }),
      edge('e3', 'out', 'm3', { sourceHandle: 'resource:res_out', targetHandle: 'input:caption', label: 'caption' }),
    ]
    const view = collapseGroupEdges(edges, nodes)
    const handle = 'group-in:out:resource:res_out'

    expect(view.edges).toHaveLength(1)
    const [reattached] = view.edges
    expect(reattached).toMatchObject({
      id: 'collapsed:e1',
      source: 'out',
      sourceHandle: 'resource:res_out',
      target: 'g',
      targetHandle: handle,
    })
    expect(reattached.label).toBeUndefined()

    const { inputs, outputs } = ports(view, 'g')
    expect(outputs).toEqual([])
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      handleId: handle,
      direction: 'input',
      sourceNodeId: 'out',
      resourceId: 'res_out',
    })
    expect(inputs[0].members).toHaveLength(3)
    expect(inputs[0].members).toEqual(
      expect.arrayContaining([
        { nodeId: 'm1', label: 'prompt' },
        { nodeId: 'm2', label: 'text' },
        { nodeId: 'm3', label: 'caption' },
      ]),
    )
    expect(inputs[0].outside).toEqual([{ nodeId: 'out' }])
  })

  it('creates one input port per distinct outside source', () => {
    const nodes = [
      resource('src_a', -400, 0),
      resource('src_b', -400, 200),
      fnNode('m1', 0, 0),
      group('g', ['m1'], true),
    ]
    const edges = [
      edge('e1', 'src_a', 'm1', { sourceHandle: 'resource:res_src_a', targetHandle: 'input:prompt', label: 'prompt' }),
      edge('e2', 'src_b', 'm1', { sourceHandle: 'resource:res_src_b', targetHandle: 'input:image', label: 'image' }),
    ]
    const view = collapseGroupEdges(edges, nodes)
    const { inputs } = ports(view, 'g')
    expect(inputs).toHaveLength(2)
    expect(inputs.map((port) => port.sourceNodeId)).toEqual(['src_a', 'src_b'])
    expect(inputs.map((port) => port.handleId)).toEqual([
      'group-in:src_a:resource:res_src_a',
      'group-in:src_b:resource:res_src_b',
    ])
    expect(inputs.map((port) => port.resourceId)).toEqual(['res_src_a', 'res_src_b'])
    expect(inputs[0].members).toEqual([{ nodeId: 'm1', label: 'prompt' }])
    expect(inputs[1].members).toEqual([{ nodeId: 'm1', label: 'image' }])

    expect(view.edges).toHaveLength(2)
    expect(view.edges.map((item) => item.id).sort()).toEqual(['collapsed:e1', 'collapsed:e2'])
    for (const item of view.edges) {
      expect(item.target).toBe('g')
      expect(item.label).toBeUndefined()
    }
  })

  it('uses an empty source-handle segment for input handles when the outside edge has no sourceHandle', () => {
    const nodes = [fnNode('src', -400, 0), fnNode('m1', 0, 0), group('g', ['m1'], true)]
    const edges = [edge('e1', 'src', 'm1', { targetHandle: 'input:prompt' })]
    const view = collapseGroupEdges(edges, nodes)
    const { inputs } = ports(view, 'g')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ handleId: 'group-in:src:', direction: 'input', sourceNodeId: 'src' })
    expect(inputs[0].resourceId).toBeUndefined()
    expect(view.edges).toHaveLength(1)
    expect(view.edges[0]).toMatchObject({ id: 'collapsed:e1', source: 'src', target: 'g', targetHandle: 'group-in:src:' })
  })

  it('creates one output port with two outside links when one member output feeds two outside nodes', () => {
    const nodes = [resource('m1', 0, 0), fnNode('f1', 400, 0), fnNode('f2', 400, 200), group('g', ['m1'], true)]
    const edges = [
      edge('e1', 'm1', 'f1', { sourceHandle: 'resource:res_m1', targetHandle: 'input:prompt', label: 'prompt' }),
      edge('e2', 'm1', 'f2', { sourceHandle: 'resource:res_m1', targetHandle: 'input:image', label: 'image' }),
    ]
    const view = collapseGroupEdges(edges, nodes)
    const { inputs, outputs } = ports(view, 'g')
    expect(inputs).toEqual([])
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({
      handleId: 'resource:res_m1',
      direction: 'output',
      sourceNodeId: 'm1',
      sourceHandle: 'resource:res_m1',
      resourceId: 'res_m1',
      members: [{ nodeId: 'm1' }],
    })
    expect(outputs[0].outside).toHaveLength(2)
    expect(outputs[0].outside).toEqual(
      expect.arrayContaining([
        { nodeId: 'f1', label: 'prompt' },
        { nodeId: 'f2', label: 'image' },
      ]),
    )

    expect(view.edges).toHaveLength(2)
    const byTarget = new Map(view.edges.map((item) => [item.target, item]))
    expect(byTarget.get('f1')).toMatchObject({
      id: 'collapsed:e1',
      source: 'g',
      sourceHandle: 'resource:res_m1',
      target: 'f1',
      targetHandle: 'input:prompt',
      label: 'prompt',
    })
    expect(byTarget.get('f2')).toMatchObject({
      id: 'collapsed:e2',
      source: 'g',
      sourceHandle: 'resource:res_m1',
      target: 'f2',
      targetHandle: 'input:image',
      label: 'image',
    })
  })

  it('uses a group-out handle for a member edge without sourceHandle', () => {
    const nodes = [fnNode('m1', 0, 0), fnNode('f1', 400, 0), group('g', ['m1'], true)]
    const edges = [edge('e1', 'm1', 'f1', { targetHandle: 'input:prompt', label: 'prompt' })]
    const view = collapseGroupEdges(edges, nodes)
    const { outputs } = ports(view, 'g')
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({
      handleId: 'group-out:m1',
      direction: 'output',
      sourceNodeId: 'm1',
      members: [{ nodeId: 'm1' }],
      outside: [{ nodeId: 'f1', label: 'prompt' }],
    })
    expect(outputs[0].sourceHandle).toBeUndefined()
    expect(outputs[0].resourceId).toBeUndefined()
    expect(view.edges).toHaveLength(1)
    expect(view.edges[0]).toMatchObject({
      id: 'collapsed:e1',
      source: 'g',
      sourceHandle: 'group-out:m1',
      target: 'f1',
      targetHandle: 'input:prompt',
      label: 'prompt',
    })
  })

  it('leaves resourceId undefined for output handles that are not resource handles', () => {
    const nodes = [fnNode('m1', 0, 0), fnNode('f1', 400, 0), group('g', ['m1'], true)]
    const edges = [edge('e1', 'm1', 'f1', { sourceHandle: 'output:image', targetHandle: 'input:image' })]
    const view = collapseGroupEdges(edges, nodes)
    const { outputs } = ports(view, 'g')
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({ handleId: 'output:image', sourceHandle: 'output:image' })
    expect(outputs[0].resourceId).toBeUndefined()
  })

  it('turns a member-to-member edge between two collapsed groups into one group-to-group edge', () => {
    const nodes = [
      resource('a1', 0, 0),
      fnNode('b1', 600, 0),
      group('g_a', ['a1'], true),
      group('g_b', ['b1'], true),
    ]
    const edges = [edge('e1', 'a1', 'b1', { sourceHandle: 'resource:res_a1', targetHandle: 'input:prompt', label: 'prompt' })]
    const view = collapseGroupEdges(edges, nodes)
    const inHandle = 'group-in:a1:resource:res_a1'

    expect(view.edges).toHaveLength(1)
    expect(view.edges[0]).toMatchObject({
      id: 'collapsed:e1',
      source: 'g_a',
      sourceHandle: 'resource:res_a1',
      target: 'g_b',
      targetHandle: inHandle,
    })
    expect(view.edges[0].label).toBeUndefined()

    const a = ports(view, 'g_a')
    expect(a.inputs).toEqual([])
    expect(a.outputs).toHaveLength(1)
    expect(a.outputs[0]).toMatchObject({
      handleId: 'resource:res_a1',
      direction: 'output',
      sourceNodeId: 'a1',
      resourceId: 'res_a1',
      members: [{ nodeId: 'a1' }],
    })
    expect(a.outputs[0].outside).toEqual([{ nodeId: 'g_b' }])
    expect(a.outputs[0].outside[0].label).toBeUndefined()

    const b = ports(view, 'g_b')
    expect(b.outputs).toEqual([])
    expect(b.inputs).toHaveLength(1)
    expect(b.inputs[0]).toMatchObject({
      handleId: inHandle,
      direction: 'input',
      sourceNodeId: 'a1',
      resourceId: 'res_a1',
      members: [{ nodeId: 'b1', label: 'prompt' }],
    })
    expect(b.inputs[0].outside).toEqual([{ nodeId: 'g_a' }])
  })

  it('sorts input ports by source position and output ports by member position (y, then x)', () => {
    const nodes = [
      resource('s1', -400, 200),
      resource('s2', -300, 0),
      resource('s3', -500, 0),
      resource('m1', 0, 300),
      resource('m2', 50, 100),
      resource('m3', 10, 100),
      fnNode('f', 600, 0),
      group('g', ['m1', 'm2', 'm3'], true),
    ]
    const edges = [
      edge('in1', 's1', 'm1', { sourceHandle: 'resource:res_s1', targetHandle: 'input:a' }),
      edge('in2', 's2', 'm2', { sourceHandle: 'resource:res_s2', targetHandle: 'input:a' }),
      edge('in3', 's3', 'm3', { sourceHandle: 'resource:res_s3', targetHandle: 'input:a' }),
      edge('out1', 'm1', 'f', { sourceHandle: 'resource:res_m1', targetHandle: 'input:x' }),
      edge('out2', 'm2', 'f', { sourceHandle: 'resource:res_m2', targetHandle: 'input:y' }),
      edge('out3', 'm3', 'f', { sourceHandle: 'resource:res_m3', targetHandle: 'input:z' }),
    ]
    const view = collapseGroupEdges(edges, nodes)
    const { inputs, outputs } = ports(view, 'g')
    expect(inputs.map((port) => port.sourceNodeId)).toEqual(['s3', 's2', 's1'])
    expect(outputs.map((port) => port.sourceNodeId)).toEqual(['m3', 'm2', 'm1'])
  })

  it('passes untouched edges through by reference and keeps their relative order', () => {
    const nodes = [
      resource('x', -400, 0),
      fnNode('y', -200, 0),
      resource('z', -400, 300),
      fnNode('w', -200, 300),
      resource('m1', 0, 0),
      fnNode('f', 400, 0),
      group('g', ['m1'], true),
    ]
    const first = edge('e1', 'x', 'y', { sourceHandle: 'resource:res_x', targetHandle: 'input:a', label: 'a' })
    const boundary = edge('e2', 'm1', 'f', { sourceHandle: 'resource:res_m1', targetHandle: 'input:b' })
    const second = edge('e3', 'z', 'w', { sourceHandle: 'resource:res_z', targetHandle: 'input:c' })
    const view = collapseGroupEdges([first, boundary, second], nodes)
    expect(view.edges).toHaveLength(3)
    const firstIndex = view.edges.indexOf(first)
    const secondIndex = view.edges.indexOf(second)
    expect(firstIndex).toBeGreaterThanOrEqual(0)
    expect(secondIndex).toBeGreaterThan(firstIndex)
    expect(view.edges[firstIndex]).toBe(first)
    expect(view.edges[secondIndex]).toBe(second)
    expect(view.edges).not.toContain(boundary)
  })

  it('never leaves an edge pointing at a hidden node and attaches every boundary edge to a port', () => {
    const nodes = [
      resource('src', -600, 0),
      fnNode('ext', 900, 0),
      resource('a1', 0, 0),
      fnNode('a2', 200, 0),
      fnNode('b1', 500, 0),
      resource('b2', 500, 200),
      resource('free', -600, 400),
      group('g_a', ['a1', 'a2'], true),
      group('g_b', ['b1', 'b2'], true),
    ]
    const edges = [
      edge('e_in', 'src', 'a2', { sourceHandle: 'resource:res_src', targetHandle: 'input:prompt', label: 'prompt' }),
      edge('e_internal', 'a1', 'a2', { sourceHandle: 'resource:res_a1', targetHandle: 'input:image' }),
      edge('e_cross', 'a1', 'b1', { sourceHandle: 'resource:res_a1', targetHandle: 'input:image', label: 'image' }),
      edge('e_out', 'b2', 'ext', { sourceHandle: 'resource:res_b2', targetHandle: 'input:x', label: 'x' }),
      edge('e_free', 'free', 'b1', { sourceHandle: 'resource:res_free', targetHandle: 'input:y' }),
      edge('e_nohandle', 'a2', 'ext', { targetHandle: 'input:z' }),
    ]
    const view = collapseGroupEdges(edges, nodes)

    expect(view.edges.length).toBeGreaterThan(0)
    for (const item of view.edges) {
      expect(view.hiddenBy.has(item.source)).toBe(false)
      expect(view.hiddenBy.has(item.target)).toBe(false)
      if (item.source === 'g_a' || item.source === 'g_b') {
        expect(allHandles(view, item.source, 'outputs')).toContain(item.sourceHandle)
      }
      if (item.target === 'g_a' || item.target === 'g_b') {
        expect(allHandles(view, item.target, 'inputs')).toContain(item.targetHandle)
      }
    }
    expect(view.edges.some((item) => item.id === 'collapsed:e_internal')).toBe(false)
    expect(view.edges.some((item) => item.id === 'e_internal')).toBe(false)

    const keys = view.edges.map((item) => `${item.source}|${item.sourceHandle ?? ''}|${item.target}|${item.targetHandle ?? ''}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not mutate its inputs', () => {
    const nodes = [
      resource('out', -400, 0),
      fnNode('m1', 0, 0),
      resource('m2', 0, 200),
      fnNode('f', 400, 0),
      group('g', ['m1', 'm2'], true),
    ]
    const edges = [
      edge('e1', 'out', 'm1', { sourceHandle: 'resource:res_out', targetHandle: 'input:prompt', label: 'prompt' }),
      edge('e2', 'm2', 'm1', { sourceHandle: 'resource:res_m2', targetHandle: 'input:image' }),
      edge('e3', 'm2', 'f', { sourceHandle: 'resource:res_m2', targetHandle: 'input:image', label: 'image' }),
    ]
    const nodesBefore = structuredClone(nodes)
    const edgesBefore = structuredClone(edges)
    const edgeRefs = [...edges]
    const nodeRefs = [...nodes]
    collapseGroupEdges(edges, nodes)
    expect(nodes).toEqual(nodesBefore)
    expect(edges).toEqual(edgesBefore)
    expect(edges).toHaveLength(edgeRefs.length)
    edges.forEach((item, index) => expect(item).toBe(edgeRefs[index]))
    nodes.forEach((item, index) => expect(item).toBe(nodeRefs[index]))
  })
})
