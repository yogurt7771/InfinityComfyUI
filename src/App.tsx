import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Boxes,
  Database,
  Moon,
  Settings,
  Sun,
} from 'lucide-react'
import { CanvasWorkspace } from './components/CanvasWorkspace'
import { LeftPanel, SettingsPage } from './components/WorkbenchPanels'
import { useProjectStore } from './store/projectStore'
import './styles.css'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const project = useProjectStore((state) => state.project)
  const projectLibrary = useProjectStore((state) => state.projectLibrary)
  const switchProject = useProjectStore((state) => state.switchProject)
  const checkComfyEndpointStatuses = useProjectStore((state) => state.checkComfyEndpointStatuses)
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

  return (
    <div className="app-shell" data-theme={theme} aria-label="Infinity ComfyUI workbench">
      <header className="topbar">
        <div className="brand">
          <Boxes size={24} />
          <div className="brand-copy">
            <h1>Infinity ComfyUI</h1>
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
          </div>
        </div>
        <nav className="topbar-metrics" aria-label="Project metrics">
          <span>
            <Database size={15} />
            {Object.keys(project.resources).length} assets
          </span>
          <span>
            <Activity size={15} />
            {Object.keys(project.tasks).length} tasks
          </span>
          <button
            type="button"
            className="theme-toggle-button"
            aria-label={`Switch to ${nextTheme} theme`}
            onClick={() => setTheme(nextTheme)}
          >
            {theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
            {theme === 'light' ? 'Light' : 'Dark'}
          </button>
          <button type="button" className="topbar-settings-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={15} />
            Settings
          </button>
        </nav>
      </header>
      <main className="workbench">
        <div className="panel-shell left-panel-shell">
          <LeftPanel />
        </div>
        <CanvasWorkspace />
      </main>
      {settingsOpen ? <SettingsPage onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  )
}
