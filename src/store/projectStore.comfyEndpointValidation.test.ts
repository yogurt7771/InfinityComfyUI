import { describe, expect, it } from 'vitest'
import { createProjectSlice } from './projectStore'

describe('ComfyUI endpoint validation during project imports', () => {
  it.each([
    ['project', 'javascript:alert(1)', /https?|protocol/i],
    ['project', 'data:text/html,fixture', /https?|protocol/i],
    ['project', 'file:///C:/fixture/comfyui.html', /https?|protocol/i],
    ['project', 'https://user:secret@comfyui.example.test:8443/', /credentials|username|password|userinfo/i],
    ['config', 'javascript:alert(1)', /https?|protocol/i],
    ['config', 'data:text/html,fixture', /https?|protocol/i],
    ['config', 'file:///C:/fixture/comfyui.html', /https?|protocol/i],
    ['config', 'https://user:secret@comfyui.example.test:8443/', /credentials|username|password|userinfo/i],
  ] as const)('rejects %s imports containing unsafe ComfyUI URL %s', (kind, baseUrl, message) => {
    const slice = createProjectSlice({ now: () => '2026-07-15T00:00:00.000Z' })
    const originalProject = structuredClone(slice.getState().project)

    const importUnsafePackage = () => {
      if (kind === 'project') {
        const importedProject = structuredClone(slice.getState().project)
        importedProject.project.id = 'unsafe_imported_project'
        importedProject.comfy.endpoints[0]!.baseUrl = baseUrl
        slice.getState().importProject({ project: importedProject })
        return
      }

      const importedConfig = structuredClone(slice.getState().exportConfig().config)
      importedConfig.comfy.endpoints[0]!.baseUrl = baseUrl
      slice.getState().importConfig({ config: importedConfig })
    }

    expect(importUnsafePackage).toThrow(message)
    expect(slice.getState().project).toEqual(originalProject)
  })

  it.each(['http://127.0.0.1:8188', 'https://comfyui.example.test:8443/ui']) (
    'accepts imported ComfyUI URL %s',
    (baseUrl) => {
      const slice = createProjectSlice({ now: () => '2026-07-15T00:00:00.000Z' })
      const importedProject = structuredClone(slice.getState().project)
      importedProject.project.id = `accepted_${new URL(baseUrl).protocol.replace(':', '')}`
      importedProject.comfy.endpoints[0]!.baseUrl = baseUrl

      expect(() => slice.getState().importProject({ project: importedProject })).not.toThrow()
      expect(slice.getState().project.comfy.endpoints[0]?.baseUrl).toBe(baseUrl)
    },
  )
})
