import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Boxes,
  Database,
  Download,
  Moon,
  Pencil,
  Sun,
  Upload,
} from 'lucide-react'
import { CanvasWorkspace } from './components/CanvasWorkspace'
import { LeftPanel, ProjectInfoDialog } from './components/WorkbenchPanels'
import { downloadConfigPackage, downloadProjectPackage, readPackageFile } from './domain/projectTransfer'
import { useProjectStore } from './store/projectStore'
import './styles.css'

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [projectInfoOpen, setProjectInfoOpen] = useState(false)
  const [packageError, setPackageError] = useState<string>()
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const project = useProjectStore((state) => state.project)
  const projectLibrary = useProjectStore((state) => state.projectLibrary)
  const switchProject = useProjectStore((state) => state.switchProject)
  const updateProjectMetadata = useProjectStore((state) => state.updateProjectMetadata)
  const checkComfyEndpointStatuses = useProjectStore((state) => state.checkComfyEndpointStatuses)
  const exportProject = useProjectStore((state) => state.exportProject)
  const exportConfig = useProjectStore((state) => state.exportConfig)
  const importProject = useProjectStore((state) => state.importProject)
  const importConfig = useProjectStore((state) => state.importConfig)
  const nextTheme = theme === 'light' ? 'dark' : 'light'
  const projectOptions = useMemo(() => {
    const projects = {
      ...projectLibrary,
      [project.project.id]: project,
    }
    return Object.values(projects).sort((left, right) => left.project.name.localeCompare(right.project.name))
  }, [project, projectLibrary])

  useEffect(() => {
    void checkComfyEndpointStatuses()
    const intervalId = window.setInterval(() => {
      void checkComfyEndpointStatuses()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [checkComfyEndpointStatuses])

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

  return (
    <div className="app-shell" data-theme={theme} aria-label="Infinity ComfyUI workbench">
      <header className="topbar">
        <div className="brand">
          <Boxes size={24} />
          <div className="brand-copy">
            <h1>Infinity ComfyUI</h1>
            <div className="project-switcher-row">
              <select
                className="project-switcher"
                aria-label="Current project"
                value={project.project.id}
                onChange={(event) => switchProject(event.target.value)}
              >
                {projectOptions.map((item) => (
                  <option key={item.project.id} value={item.project.id}>
                    {item.project.name || 'Untitled Project'}
                  </option>
                ))}
              </select>
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
              {Object.keys(project.tasks).length} tasks
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
          project={project.project}
          onUpdate={updateProjectMetadata}
          onClose={() => setProjectInfoOpen(false)}
        />
      ) : null}
      {packageError ? <div className="toast-error app-toast-error">{packageError}</div> : null}
    </div>
  )
}
