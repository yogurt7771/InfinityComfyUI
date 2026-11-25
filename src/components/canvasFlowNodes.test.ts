import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { NodeReferenceSummary } from '../domain/nodeReferences'
import type { CanvasNode, ExecutionTask, GenerationFunction, ProjectState, Resource } from '../domain/types'
import {
  buildFlowNodeRenderIndex,
  flowNodeRenderDependencies,
  sameFlowNodeData,
  stabilizeFlowNodes,
} from './canvasFlowNodes'

type DepsProject = Pick<ProjectState, 'resources' | 'tasks' | 'functions'>

const resource = (
  id: string,
  source: Resource['source'] = { kind: 'user_upload' },
  metadata: Partial<NonNullable<Resource['metadata']>> = {},
): Resource =>
  ({
    id,
    type: 'image',
    value: '',
    source,
    metadata: { createdAt: '', ...metadata },
  }) as Resource

const task = (id: string, functionId?: string): ExecutionTask =>
  ({ id, ...(functionId ? { functionId } : {}) }) as unknown as ExecutionTask

const fn = (id: string): GenerationFunction => ({ id, name: id }) as unknown as GenerationFunction

const byId = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]))

const project = (resources: Resource[], tasks: ExecutionTask[] = [], functions: GenerationFunction[] = []): DepsProject => ({
  resources: byId(resources),
  tasks: byId(tasks as unknown as { id: string }[]) as unknown as DepsProject['tasks'],
  functions: byId(functions as unknown as { id: string }[]) as unknown as DepsProject['functions'],
})

const deps = (node: CanvasNode, p: DepsProject, references: NodeReferenceSummary[] = []) =>
  flowNodeRenderDependencies(node, p, references, buildFlowNodeRenderIndex(p.resources))

const sameDeps = (left: unknown[], right: unknown[]) =>
  left.length === right.length && left.every((value, index) => Object.is(value, right[index]))

const withResource = (p: DepsProject, r: Resource): DepsProject => ({ ...p, resources: { ...p.resources, [r.id]: r } })
const withTask = (p: DepsProject, t: ExecutionTask): DepsProject => ({
  ...p,
  tasks: { ...p.tasks, [(t as unknown as { id: string }).id]: t },
})
const withFunction = (p: DepsProject, f: GenerationFunction): DepsProject => ({
  ...p,
  functions: { ...p.functions, [(f as unknown as { id: string }).id]: f },
})
const clone = <T extends object>(value: T): T => ({ ...value })

describe('buildFlowNodeRenderIndex', () => {
  it('groups function_output resources by functionNodeId and workflowFunctionId', () => {
    const a = resource('a', { kind: 'function_output', functionNodeId: 'fn1' }, { workflowFunctionId: 'wf1' })
    const b = resource('b', { kind: 'function_output', functionNodeId: 'fn1' }, { workflowFunctionId: 'wf2' })
    const c = resource('c', { kind: 'function_output', functionNodeId: 'fn2' }, { workflowFunctionId: 'wf1' })
    const index = buildFlowNodeRenderIndex(byId([a, b, c]))

    const fn1 = index.outputsByFunctionNodeId.get('fn1') ?? []
    expect(fn1).toHaveLength(2)
    expect(fn1).toContain(a)
    expect(fn1).toContain(b)
    expect(index.outputsByFunctionNodeId.get('fn2')).toEqual([c])
    expect(index.outputsByFunctionNodeId.get('fn2')?.[0]).toBe(c)

    const wf1 = index.outputsByWorkflowFunctionId.get('wf1') ?? []
    expect(wf1).toHaveLength(2)
    expect(wf1).toContain(a)
    expect(wf1).toContain(c)
    expect(index.outputsByWorkflowFunctionId.get('wf2')).toEqual([b])
  })

  it('skips resources lacking the key for that map only', () => {
    const noNode = resource('noNode', { kind: 'function_output' }, { workflowFunctionId: 'wf1' })
    const noWorkflow = resource('noWorkflow', { kind: 'function_output', functionNodeId: 'fn1' })
    const index = buildFlowNodeRenderIndex(byId([noNode, noWorkflow]))

    expect([...index.outputsByFunctionNodeId.keys()]).toEqual(['fn1'])
    expect(index.outputsByFunctionNodeId.get('fn1')).toEqual([noWorkflow])
    expect([...index.outputsByWorkflowFunctionId.keys()]).toEqual(['wf1'])
    expect(index.outputsByWorkflowFunctionId.get('wf1')).toEqual([noNode])
  })

  it('excludes non-function-output resources from both maps', () => {
    const upload = resource('upload', { kind: 'user_upload', functionNodeId: 'fn1' }, { workflowFunctionId: 'wf1' })
    const manual = resource('manual', { kind: 'manual_input', functionNodeId: 'fn1' }, { workflowFunctionId: 'wf1' })
    const index = buildFlowNodeRenderIndex(byId([upload, manual]))

    expect(index.outputsByFunctionNodeId.get('fn1') ?? []).toHaveLength(0)
    expect(index.outputsByWorkflowFunctionId.get('wf1') ?? []).toHaveLength(0)
  })

  it('returns empty maps for no resources', () => {
    const index = buildFlowNodeRenderIndex({})
    expect(index.outputsByFunctionNodeId.size).toBe(0)
    expect(index.outputsByWorkflowFunctionId.size).toBe(0)
  })
})

describe('flowNodeRenderDependencies', () => {
  describe('resource node', () => {
    const node: CanvasNode = { id: 'node_r', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'r1' } }
    const base = () =>
      project(
        [
          resource('r1', { kind: 'function_output', functionNodeId: 'fnNode', taskId: 't1' }, { workflowFunctionId: 'wfX' }),
          resource('other'),
        ],
        [task('t1', 'f1'), task('t2', 'f2')],
        [fn('f1'), fn('f2'), fn('wfX')],
      )

    it('is stable for the same project', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, p))).toBe(true)
    })

    it('changes when its resource is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withResource(p, clone(p.resources.r1))))).toBe(false)
    })

    it('changes when the task from resource.source.taskId is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withTask(p, clone(p.tasks.t1))))).toBe(false)
    })

    it('falls back to data.taskId when the resource has no source.taskId', () => {
      const n: CanvasNode = { ...node, data: { resourceId: 'r1', taskId: 't2' } }
      const p = withResource(base(), resource('r1', { kind: 'user_upload' }))
      expect(sameDeps(deps(n, p), deps(n, withTask(p, clone(p.tasks.t2))))).toBe(false)
      expect(sameDeps(deps(n, p), deps(n, withTask(p, clone(p.tasks.t1))))).toBe(true)
    })

    it('changes when the function task.functionId is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withFunction(p, clone(p.functions.f1))))).toBe(false)
    })

    it('uses resource.metadata.workflowFunctionId when the task has no functionId', () => {
      const p = withTask(base(), task('t1'))
      expect(sameDeps(deps(node, p), deps(node, withFunction(p, clone(p.functions.wfX))))).toBe(false)
      expect(sameDeps(deps(node, p), deps(node, withFunction(p, clone(p.functions.f1))))).toBe(true)
    })

    it('is unchanged when an unrelated resource, task or function is replaced or added', () => {
      const p = base()
      const before = deps(node, p)
      expect(sameDeps(before, deps(node, withResource(p, clone(p.resources.other))))).toBe(true)
      expect(sameDeps(before, deps(node, withResource(p, resource('added'))))).toBe(true)
      expect(sameDeps(before, deps(node, withTask(p, clone(p.tasks.t2))))).toBe(true)
      expect(sameDeps(before, deps(node, withTask(p, task('t3', 'f1'))))).toBe(true)
      expect(sameDeps(before, deps(node, withFunction(p, clone(p.functions.f2))))).toBe(true)
      expect(sameDeps(before, deps(node, withFunction(p, fn('f3'))))).toBe(true)
    })
  })

  describe('function node', () => {
    const node: CanvasNode = {
      id: 'fnNode',
      type: 'function',
      position: { x: 0, y: 0 },
      data: {
        functionId: 'f1',
        inputValues: { image: { resourceId: 'in1', type: 'image' }, prompt: 'hello', steps: 20, enabled: true, none: null },
      },
    }
    const base = () =>
      project(
        [
          resource('in1'),
          resource('out1', { kind: 'function_output', functionNodeId: 'fnNode' }, { workflowFunctionId: 'f1' }),
          resource('otherOut', { kind: 'function_output', functionNodeId: 'otherNode' }, { workflowFunctionId: 'f2' }),
          resource('unrelated'),
        ],
        [task('t1', 'f1')],
        [fn('f1'), fn('f2')],
      )

    it('is stable for the same project', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, p))).toBe(true)
    })

    it('changes when its function is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withFunction(p, clone(p.functions.f1))))).toBe(false)
    })

    it('changes when a resource referenced by an input value is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withResource(p, clone(p.resources.in1))))).toBe(false)
    })

    it('changes when one of its function_output resources is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withResource(p, clone(p.resources.out1))))).toBe(false)
    })

    it('changes when a function_output resource for this node is added', () => {
      const p = base()
      const added = resource('out2', { kind: 'function_output', functionNodeId: 'fnNode' })
      expect(sameDeps(deps(node, p), deps(node, withResource(p, added)))).toBe(false)
    })

    it('is unchanged when an unrelated resource is replaced', () => {
      const p = base()
      const before = deps(node, p)
      expect(sameDeps(before, deps(node, withResource(p, clone(p.resources.unrelated))))).toBe(true)
      expect(sameDeps(before, deps(node, withResource(p, clone(p.resources.otherOut))))).toBe(true)
    })
  })

  describe('result_group node', () => {
    const node: CanvasNode = {
      id: 'rg',
      type: 'result_group',
      position: { x: 0, y: 0 },
      data: {
        resources: [
          { resourceId: 'a', type: 'image' },
          { resourceId: 'b', type: 'image' },
        ],
        functionId: 'f1',
        taskId: 't1',
        sourceFunctionNodeId: 'fnNode',
      },
    }
    const base = () =>
      project(
        [
          resource('a', { kind: 'function_output', functionNodeId: 'fnNode', taskId: 't1' }),
          resource('b', { kind: 'function_output', functionNodeId: 'fnNode', taskId: 't1' }),
          resource('unrelated'),
        ],
        [task('t1', 'f1'), task('t2', 'f2')],
        [fn('f1'), fn('f2')],
      )

    it('is stable for the same project', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, p))).toBe(true)
    })

    it('changes when any listed resource is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withResource(p, clone(p.resources.a))))).toBe(false)
      expect(sameDeps(deps(node, p), deps(node, withResource(p, clone(p.resources.b))))).toBe(false)
    })

    it('changes when its task is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withTask(p, clone(p.tasks.t1))))).toBe(false)
    })

    it('changes when its function is replaced', () => {
      const p = base()
      expect(sameDeps(deps(node, p), deps(node, withFunction(p, clone(p.functions.f1))))).toBe(false)
    })

    it('is unchanged when unrelated resource/task/function is replaced (iff clause)', () => {
      const p = base()
      const before = deps(node, p)
      expect(sameDeps(before, deps(node, withResource(p, clone(p.resources.unrelated))))).toBe(true)
      expect(sameDeps(before, deps(node, withTask(p, clone(p.tasks.t2))))).toBe(true)
      expect(sameDeps(before, deps(node, withFunction(p, clone(p.functions.f2))))).toBe(true)
    })
  })

  describe('group node', () => {
    const node: CanvasNode = { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { title: 'G' } }

    it('does not depend on resources, tasks or functions', () => {
      const p = project([resource('a')], [task('t1', 'f1')], [fn('f1')])
      const p2 = project([clone(p.resources.a), resource('b')], [clone(p.tasks.t1)], [clone(p.functions.f1)])
      expect(sameDeps(deps(node, p), deps(node, p2))).toBe(true)
    })

    it('depends on references', () => {
      const p = project([])
      const refs: NodeReferenceSummary[] = [{ nodeId: 'x', title: 'X', type: 'resource', direction: 'incoming' }]
      expect(sameDeps(deps(node, p, []), deps(node, p, refs))).toBe(false)
    })
  })

  describe('references (any node type)', () => {
    const p = project([resource('r1'), resource('rRef')], [], [fn('f1')])
    const nodes: CanvasNode[] = [
      { id: 'node_r', type: 'resource', position: { x: 0, y: 0 }, data: { resourceId: 'r1' } },
      { id: 'fnNode', type: 'function', position: { x: 0, y: 0 }, data: { functionId: 'f1', inputValues: {} } },
      { id: 'rg', type: 'result_group', position: { x: 0, y: 0 }, data: { resources: [] } },
      { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: {} },
    ]
    const ref = (): NodeReferenceSummary => ({
      nodeId: 'other',
      title: 'Other',
      type: 'resource',
      direction: 'incoming',
      resourceId: 'rRef',
    })

    it.each(nodes.map((n) => [n.type, n] as const))('%s: new array with identical content does not change', (_, node) => {
      const shared = ref()
      expect(sameDeps(deps(node, p, [shared]), deps(node, p, [shared]))).toBe(true)
      expect(sameDeps(deps(node, p, [ref()]), deps(node, p, [ref()]))).toBe(true)
    })

    const variants: [string, NodeReferenceSummary][] = [
      ['title', { ...ref(), title: 'Renamed' }],
      ['nodeId', { ...ref(), nodeId: 'another' }],
      ['type', { ...ref(), type: 'function' }],
      ['direction', { ...ref(), direction: 'outgoing' }],
      ['resourceId', { ...ref(), resourceId: 'r1' }],
    ]
    for (const node of nodes) {
      it.each(variants)(`${node.type}: changes when reference %s differs`, (_, changed) => {
        expect(sameDeps(deps(node, p, [ref()]), deps(node, p, [changed]))).toBe(false)
      })

      it(`${node.type}: changes when the referenced resource is replaced`, () => {
        expect(sameDeps(deps(node, p, [ref()]), deps(node, withResource(p, clone(p.resources.rRef)), [ref()]))).toBe(false)
      })

      it(`${node.type}: changes when references are added or removed`, () => {
        expect(sameDeps(deps(node, p, [ref()]), deps(node, p, [ref(), { ...ref(), nodeId: 'x2' }]))).toBe(false)
        expect(sameDeps(deps(node, p, [ref()]), deps(node, p, []))).toBe(false)
      })
    }
  })
})

describe('sameFlowNodeData', () => {
  const base = () => {
    const shared = { label: 'x' }
    const depA = {}
    return {
      shared,
      depA,
      left: {
        title: 'T',
        shared,
        resourcesById: { a: 1 },
        tasksById: { t: 1 },
        functionsById: { f: 1 },
        nodeReferences: [1],
        renderDependencies: [depA, 1, 'x'],
      } as Node['data'],
    }
  }

  it('is true when ignored maps differ but renderDependencies match element-wise', () => {
    const { left, shared, depA } = base()
    const right = {
      title: 'T',
      shared,
      resourcesById: { a: 1 },
      tasksById: { t: 1 },
      functionsById: { f: 1 },
      nodeReferences: [1],
      renderDependencies: [depA, 1, 'x'],
    }
    expect(sameFlowNodeData(left, right)).toBe(true)
  })

  it('is true when renderDependencies is the same reference', () => {
    const { left } = base()
    expect(sameFlowNodeData(left, { ...left })).toBe(true)
  })

  it('is false when a non-ignored key is a different object with equal content', () => {
    const { left } = base()
    expect(sameFlowNodeData(left, { ...left, shared: { label: 'x' } })).toBe(false)
  })

  it('is false when a primitive non-ignored key differs', () => {
    const { left } = base()
    expect(sameFlowNodeData(left, { ...left, title: 'U' })).toBe(false)
  })

  it('uses Object.is for non-ignored keys (NaN equals NaN)', () => {
    const { left } = base()
    expect(sameFlowNodeData({ ...left, n: NaN }, { ...left, n: NaN })).toBe(true)
  })

  it('is false when key sets differ', () => {
    const { left } = base()
    expect(sameFlowNodeData(left, { ...left, extra: undefined })).toBe(false)
    const withoutTitle = { ...left }
    delete withoutTitle.title
    expect(sameFlowNodeData(left, withoutTitle)).toBe(false)
  })

  it('is false when an ignored key is missing on one side (key set differs)', () => {
    const { left } = base()
    const withoutTasks = { ...left }
    delete withoutTasks.tasksById
    expect(sameFlowNodeData(left, withoutTasks)).toBe(false)
  })

  it('is false when a renderDependencies element differs by identity', () => {
    const { left } = base()
    expect(sameFlowNodeData(left, { ...left, renderDependencies: [{}, 1, 'x'] })).toBe(false)
  })

  it('is false when renderDependencies lengths differ', () => {
    const { left, depA } = base()
    expect(sameFlowNodeData(left, { ...left, renderDependencies: [depA, 1] })).toBe(false)
    expect(sameFlowNodeData(left, { ...left, renderDependencies: [depA, 1, 'x', undefined] })).toBe(false)
  })

  it('is true for two data objects without ignored keys that are shallow equal', () => {
    expect(sameFlowNodeData({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true)
  })
})

describe('stabilizeFlowNodes', () => {
  const dep = {}
  const makeData = () => ({ title: 'N', renderDependencies: [dep], resourcesById: {} }) as Node['data']
  const prevNode = (id: string, extra: Partial<Node> = {}): Node => ({
    id,
    type: 'resource',
    position: { x: 10, y: 20 },
    data: makeData(),
    measured: { width: 100, height: 50 },
    zIndex: 1,
    className: 'cls',
    style: { width: 100 },
    ...extra,
  })
  const nextNode = (id: string, extra: Partial<Node> = {}): Node => ({
    id,
    type: 'resource',
    position: { x: 10, y: 20 },
    data: makeData(),
    zIndex: 1,
    className: 'cls',
    style: { width: 100 },
    ...extra,
  })

  it('returns next when previous is empty', () => {
    const next = [nextNode('a')]
    expect(stabilizeFlowNodes([], next)).toBe(next)
  })

  it('returns next when next is empty', () => {
    const next: Node[] = []
    expect(stabilizeFlowNodes([prevNode('a')], next)).toBe(next)
  })

  it('returns the previous array itself when nothing changed', () => {
    const previous = [prevNode('a'), prevNode('b')]
    const result = stabilizeFlowNodes(previous, [nextNode('a'), nextNode('b')])
    expect(result).toBe(previous)
  })

  it('returns the previous node object (with measured) when equal', () => {
    const previous = [prevNode('a'), prevNode('b')]
    const result = stabilizeFlowNodes(previous, [nextNode('a'), nextNode('b'), nextNode('c')])
    expect(result).not.toBe(previous)
    expect(result[0]).toBe(previous[0])
    expect(result[1]).toBe(previous[1])
    expect(result[0].measured).toEqual({ width: 100, height: 50 })
  })

  it('returns new nodes as-is', () => {
    const previous = [prevNode('a')]
    const next = [nextNode('a'), nextNode('c')]
    const result = stabilizeFlowNodes(previous, next)
    expect(result).toHaveLength(2)
    expect(result[1]).toBe(next[1])
  })

  it('follows next for order and membership', () => {
    const previous = [prevNode('a'), prevNode('b'), prevNode('c')]
    const result = stabilizeFlowNodes(previous, [nextNode('c'), nextNode('a')])
    expect(result.map((n) => n.id)).toEqual(['c', 'a'])
    expect(result[0]).toBe(previous[2])
    expect(result[1]).toBe(previous[0])
    expect(result).not.toBe(previous)
  })

  it('returns a new array when a node was removed even if the rest are unchanged', () => {
    const previous = [prevNode('a'), prevNode('b')]
    const result = stabilizeFlowNodes(previous, [nextNode('a')])
    expect(result).not.toBe(previous)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(previous[0])
  })

  it('treats undefined and false selected as equal', () => {
    const previous = [prevNode('a', { selected: undefined })]
    expect(stabilizeFlowNodes(previous, [nextNode('a', { selected: false })])).toBe(previous)
  })

  it('treats shallow-equal style and domAttributes as equal', () => {
    const previous = [prevNode('a', { style: { width: 100, color: 'red' }, domAttributes: { title: 'x' } } as Partial<Node>)]
    const next = [nextNode('a', { style: { width: 100, color: 'red' }, domAttributes: { title: 'x' } } as Partial<Node>)]
    expect(stabilizeFlowNodes(previous, next)).toBe(previous)
  })

  it('treats both-undefined style as equal', () => {
    const previous = [prevNode('a', { style: undefined })]
    expect(stabilizeFlowNodes(previous, [nextNode('a', { style: undefined })])).toBe(previous)
  })

  const nonDataChanges: [string, Partial<Node>][] = [
    ['selected', { selected: true }],
    ['className', { className: 'other' }],
    ['zIndex', { zIndex: 5 }],
    ['position', { position: { x: 11, y: 20 } }],
    ['style', { style: { width: 200 } }],
    ['domAttributes', { domAttributes: { title: 'y' } } as Partial<Node>],
  ]
  it.each(nonDataChanges)('non-data change (%s) keeps previous data, measured and dragging', (_, change) => {
    const previous = [prevNode('a', { dragging: false })]
    const next = [nextNode('a', change)]
    const result = stabilizeFlowNodes(previous, next)
    expect(result).not.toBe(previous)
    expect(result[0]).not.toBe(previous[0])
    expect(result[0].data).toBe(previous[0].data)
    expect(result[0].measured).toBe(previous[0].measured)
    expect(result[0].dragging).toBe(false)
    for (const [key, value] of Object.entries(change)) {
      expect((result[0] as Record<string, unknown>)[key]).toEqual(value)
    }
  })

  it('type change produces a new object', () => {
    const previous = [prevNode('a')]
    const result = stabilizeFlowNodes(previous, [nextNode('a', { type: 'function' })])
    expect(result[0]).not.toBe(previous[0])
    expect(result[0].type).toBe('function')
  })

  it('data change returns next node content with next data and without previous measured', () => {
    const previous = [prevNode('a')]
    const changedData = { title: 'N', renderDependencies: [{}], resourcesById: {} }
    const next = [nextNode('a', { data: changedData, selected: true })]
    const result = stabilizeFlowNodes(previous, next)
    expect(result).not.toBe(previous)
    expect(result[0]).not.toBe(previous[0])
    expect(result[0].data).toBe(changedData)
    expect(result[0]).toEqual(next[0])
    expect(result[0].measured).toBeUndefined()
  })

  it('keeps previous position while dragging (data same)', () => {
    const previous = [prevNode('a', { dragging: true, position: { x: 50, y: 60 } })]
    const result = stabilizeFlowNodes(previous, [nextNode('a', { position: { x: 0, y: 0 } })])
    expect(result[0].position).toEqual({ x: 50, y: 60 })
  })

  it('keeps previous position while dragging (non-data change)', () => {
    const previous = [prevNode('a', { dragging: true, position: { x: 50, y: 60 } })]
    const result = stabilizeFlowNodes(previous, [nextNode('a', { position: { x: 0, y: 0 }, selected: true })])
    expect(result[0].position).toEqual({ x: 50, y: 60 })
    expect(result[0].selected).toBe(true)
  })

  it('keeps previous position while dragging (data change)', () => {
    const previous = [prevNode('a', { dragging: true, position: { x: 50, y: 60 } })]
    const changedData = { title: 'Changed', renderDependencies: [dep], resourcesById: {} }
    const result = stabilizeFlowNodes(previous, [nextNode('a', { position: { x: 0, y: 0 }, data: changedData })])
    expect(result[0].position).toEqual({ x: 50, y: 60 })
    expect(result[0].data).toBe(changedData)
  })

  it('is a no-op for setNodes(current => stabilizeFlowNodes(current, next))', () => {
    let current = [prevNode('a'), prevNode('b')]
    const setNodes = (updater: (nodes: Node[]) => Node[]) => {
      current = updater(current)
    }
    const before = current
    setNodes((nodes) => stabilizeFlowNodes(nodes, [nextNode('a'), nextNode('b')]))
    expect(current).toBe(before)
  })
})
