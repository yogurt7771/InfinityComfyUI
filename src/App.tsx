import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Boxes,
  ChevronDown,
  Database,
  Download,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import { CanvasWorkspace } from './components/CanvasWorkspace'
import { LeftPanel, ProjectInfoDialog } from './components/WorkbenchPanels'
import { downloadConfigPackage, downloadProjectPackage, readPackageFile } from './domain/projectTransfer'
import type { ProjectState } from './domain/types'
import { useProjectStore } from './store/projectStore'
import './styles.css'

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const projectSwitcherRef = useRef<HTMLDivElement | null>(null)
  const [projectInfoOpen, setProjectInfoOpen] = useState(false)
  const [projectListOpen, setProjectListOpen] = useState(false)
  const [newProjectDraft, setNewProjectDraft] = useState<ProjectState['project']>()
  const [packageError, setPackageError] = useState<string>()
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const project = useProjectStore((state) => state.project)
  const projectLibrary = useProjectStore((state) => state.projectLibrary)
  const createProject = useProjectStore((state) => state.createProject)
  const switchProject = useProjectStore((state) => state.switchProject)
  const updateProjectMetadata = useProjectStore((state) => state.updateProjectMetadata)
  const checkComfyEndpointStatuses = useProjectStore((state) => state.checkComfyEndpointStatuses)
  const projectPersistenceReady = useProjectStore((state) => state.projectPersistenceReady)
  const exportProject = useProjectStore((state) => state.exportProject)
  const exportConfig = useProjectStore((state) => state.exportConfig)
  const importProject = useProjectStore((state) => state.importProject)
  const importConfig = useProjectStore((state) => state.importConfig)
  const deleteProject = useProjectStore((state) => state.deleteProject)
  const nextTheme = theme === 'light' ? 'dark' : 'light'
  const projectOptions = useMemo(() => {
    const projects = {
      ...projectLibrary,
      [project.project.id]: project,
    }
    return Object.values(projects).sort((left, right) => left.project.name.localeCompare(right.project.name))
  }, [project, projectLibrary])

  useEffect(() => {
    if (!projectPersistenceReady) return undefined
    void checkComfyEndpointStatuses()
    const intervalId = window.setInterval(() => {
      void checkComfyEndpointStatuses()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [checkComfyEndpointStatuses, projectPersistenceReady])

  useEffect(() => {
    document.body.dataset.theme = theme
    return () => {
      delete document.body.dataset.theme
    }
  }, [theme])

  useEffect(() => {
    if (!projectListOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && projectSwitcherRef.current?.contains(event.target)) return
      setProjectListOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProjectListOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [projectListOpen])

  const handleExportProject = async () => {
    try {
      await downloadProjectPackage(exportProject())
      setPackageError(undefined)
    } catch (err) {
      setPackageError(err instanceof Error ? err.message : 'Project export failed')
    }
  }

  const handleExportConfig = async () => {
    try {
      await downloadConfigPackage(exportConfig())
      setPackageError(undefined)
    } catch (err) {
      setPackageError(err instanceof Error ? err.message : 'Config export failed')
    }
  }

  const handleImport = async (file?: File) => {
    if (!file) return
    try {
      const payload = await readPackageFile(file)
      if (payload.project) importProject({ project: payload.project })
      if (payload.config) importConfig({ config: payload.config })
      setPackageError(undefined)
    } catch (err) {
      setPackageError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const handleCreateProject = () => {
    const now = new Date().toISOString()
    setNewProjectDraft({
      id: 'new_project_draft',
      name: 'Untitled Project',
      description: '',
      createdAt: now,
      updatedAt: now,
    })
    setProjectInfoOpen(true)
  }

  const selectProject = (projectId: string) => {
    switchProject(projectId)
    setProjectListOpen(false)
  }

  const editProject = (projectId: string) => {
    switchProject(projectId)
    setProjectListOpen(false)
    setProjectInfoOpen(true)
  }

  const removeProject = (projectId: string, projectName: string) => {
    if (!window.confirm(`Delete project "${projectName || 'Untitled Project'}"?`)) return
    deleteProject(projectId)
    setProjectListOpen(false)
  }

  const closeProjectInfo = () => {
    setNewProjectDraft(undefined)
    setProjectInfoOpen(false)
  }

  const saveProjectInfo = (patch: { name?: string; description?: string }) => {
    if (newProjectDraft) {
      createProject({ name: patch.name, description: patch.description })
      return
    }
    updateProjectMetadata(patch)
  }

  return (
    <div className="app-shell" data-theme={theme} aria-label="Infinity ComfyUI workbench">
      <header className="topbar">
        <div className="brand">
          <Boxes size={24} />
          <div className="brand-copy">
            <h1>Infinity ComfyUI</h1>
            <div className="project-switcher-row" ref={projectSwitcherRef}>
              <button
                type="button"
                className="project-switcher"
                aria-label="Current project"
                aria-haspopup="listbox"
                aria-expanded={projectListOpen}
                onClick={() => setProjectListOpen((open) => !open)}
              >
                <span>{project.project.name || 'Untitled Project'}</span>
                <ChevronDown size={15} />
              </button>
              {projectListOpen ? (
                <div className="project-switcher-menu" role="listbox" aria-label="Project list">
                  {projectOptions.map((item) => {
                    const name = item.project.name || 'Untitled Project'
                    const selected = item.project.id === project.project.id
                    return (
                      <div
                        key={item.project.id}
                        className={`project-switcher-option${selected ? ' is-selected' : ''}`}
                        role="option"
                        aria-selected={selected}
                        tabIndex={0}
                        onClick={() => selectProject(item.project.id)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            selectProject(item.project.id)
                          }
                        }}
                      >
                        <span className="project-switcher-option-name">{name}</span>
                        <span className="project-switcher-option-actions">
                          <button
                            type="button"
                            aria-label={`Edit project ${name}`}
                            title="Edit project"
                            onClick={(event) => {
                              event.stopPropagation()
                              editProject(item.project.id)
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="project-switcher-delete"
                            aria-label={`Delete project ${name}`}
                            title="Delete project"
                            onClick={(event) => {
                              event.stopPropagation()
                              removeProject(item.project.id, name)
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
              <button
                type="button"
                className="project-new-button"
                aria-label="New project"
                title="New project"
                onClick={handleCreateProject}
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                className="project-info-button"
                aria-label="Edit project information"
                onClick={() => setProjectInfoOpen(true)}
              >
                <Pencil size={13} />
              </button>
            </div>
          </div>
        </div>
        <nav className="topbar-metrics" aria-label="Project metrics">
          <div className="topbar-group topbar-status-group" aria-label="Project status">
            <span className="topbar-stat-pill">
              <Database size={15} />
              {Object.keys(project.resources).length} assets
            </span>
            <span className="topbar-stat-pill">
              <Activity size={15} />
              {Object.keys(project.tasks).length} runs
            </span>
          </div>
          <div className="topbar-group topbar-project-actions" aria-label="Project package actions">
            <button type="button" className="topbar-action-button" onClick={handleExportProject}>
              <Download size={15} />
              Export Project
            </button>
            <button type="button" className="topbar-action-button" onClick={handleExportConfig}>
              <Download size={15} />
              Export Config
            </button>
            <button type="button" className="topbar-action-button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={15} />
              Import Project
            </button>
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept=".aicanvas,.aicanvas-config,.json"
              onChange={(event) => {
                void handleImport(event.target.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </div>
          <div className="topbar-group topbar-view-actions" aria-label="View controls">
            <button
              type="button"
              className="theme-toggle-button"
              aria-label={`Switch to ${nextTheme} theme`}
              onClick={() => setTheme(nextTheme)}
            >
              {theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
              {theme === 'light' ? 'Light' : 'Dark'}
            </button>
          </div>
        </nav>
      </header>
      <main className="workbench">
        <div className="panel-shell left-panel-shell">
          <LeftPanel />
        </div>
        <CanvasWorkspace />
      </main>
      {projectInfoOpen ? (
        <ProjectInfoDialog
          project={newProjectDraft ?? project.project}
          onUpdate={saveProjectInfo}
          onClose={closeProjectInfo}
        />
      ) : null}
      {packageError ? <div className="toast-error app-toast-error">{packageError}</div> : null}
    </div>
  )
}
