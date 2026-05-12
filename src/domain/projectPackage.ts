import type { ComfyEndpointConfig, ProjectState } from './types'
import { withoutBuiltInProjectFunctions } from './builtInFunctions'

export type FullProjectPackage = {
  manifest: {
    kind: 'aicanvas_project'
    exportedAt: string
    schemaVersion: string
  }
  project: ProjectState
}

export type ConfigPackage = {
  manifest: {
    kind: 'aicanvas_config'
    exportedAt: string
    schemaVersion: string
  }
  config: Pick<ProjectState, 'schemaVersion' | 'functions' | 'comfy'>
}

const clone = <T>(value: T): T => structuredClone(value) as T

const sanitizeEndpoint = (endpoint: ComfyEndpointConfig): ComfyEndpointConfig => {
  const sanitized = clone(endpoint)

  if (sanitized.auth && sanitized.auth.exportSecret !== true) {
    delete sanitized.auth.token
    delete sanitized.auth.password
  }

  return sanitized
}

export function createProjectPackage(project: ProjectState, exportedAt = new Date().toISOString()): FullProjectPackage {
  const exportedProject = withoutBuiltInProjectFunctions(project)

  return {
    manifest: {
      kind: 'aicanvas_project',
      exportedAt,
      schemaVersion: project.schemaVersion,
    },
    project: clone(exportedProject),
  }
}

export function createConfigPackage(project: ProjectState, exportedAt = new Date().toISOString()): ConfigPackage {
  return {
    manifest: {
      kind: 'aicanvas_config',
      exportedAt,
      schemaVersion: project.schemaVersion,
    },
    config: {
      schemaVersion: project.schemaVersion,
      functions: clone(withoutBuiltInProjectFunctions(project).functions),
      comfy: {
        endpoints: project.comfy.endpoints.map(sanitizeEndpoint),
        scheduler: clone(project.comfy.scheduler),
      },
    },
  }
}
