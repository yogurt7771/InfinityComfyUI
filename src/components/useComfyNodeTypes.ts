import { useEffect, useState } from 'react'
import type { ComfyNodeTypes } from '../domain/comfyNodeTypes'
import type { ComfyWorkflow, GenerationFunction } from '../domain/types'
import { useProjectStore } from '../store/projectStore'

/**
 * The server's node types for a ComfyUI function's workflow (cached per server by the store), so output-slot
 * candidates can show real types. Undefined while loading, offline, or for non-ComfyUI functions.
 */
export function useComfyNodeTypes(functionDef: GenerationFunction | undefined): ComfyNodeTypes | undefined {
  const loadComfyNodeTypes = useProjectStore((state) => state.loadComfyNodeTypes)
  const workflow = functionDef?.workflow.format === 'comfyui_api_json' ? functionDef.workflow.rawJson : undefined
  const endpointId = functionDef?.workflow.editor?.endpointId
  const [loaded, setLoaded] = useState<{ workflow: ComfyWorkflow; nodeTypes?: ComfyNodeTypes }>()

  useEffect(() => {
    if (!workflow) return
    let active = true
    void loadComfyNodeTypes(endpointId, workflow).then((nodeTypes) => {
      if (active) setLoaded({ workflow, nodeTypes })
    })
    return () => {
      active = false
    }
  }, [endpointId, loadComfyNodeTypes, workflow])

  return loaded && loaded.workflow === workflow ? loaded.nodeTypes : undefined
}
