import '@xyflow/react/dist/style.css'
import { useEffect, useState } from 'react'
import {
  Activity,
  Boxes,
  ChevronLeft,
  Database,
  Moon,
  PanelRightClose,
  Settings,
  Sun,
} from 'lucide-react'
import { CanvasWorkspace } from './components/CanvasWorkspace'
import { LeftPanel, RightPanel, SettingsPage } from './components/WorkbenchPanels'
import { useProjectStore } from './store/projectStore'
import './styles.css'

export default function App() {
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const project = useProjectStore((state) => state.project)
  const checkComfyEndpointStatuses = useProjectStore((state) => state.checkComfyEndpointStatuses)
  const nextTheme = theme === 'light' ? 'dark' : 'light'

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
          <div>
            <h1>Infinity ComfyUI</h1>
            <span>{project.project.name}</span>
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
      <main
        className={[
          'workbench',
          rightPanelCollapsed ? 'right-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="panel-shell left-panel-shell">
          <LeftPanel />
        </div>
        <CanvasWorkspace />
        <div className={`panel-shell right-panel-shell ${rightPanelCollapsed ? 'is-collapsed' : ''}`}>
          <button
            className="panel-collapse-button right-collapse-button"
            type="button"
            aria-label={rightPanelCollapsed ? 'Expand right panel' : 'Collapse right panel'}
            onClick={() => setRightPanelCollapsed((value) => !value)}
          >
            {rightPanelCollapsed ? <ChevronLeft size={17} /> : <PanelRightClose size={17} />}
          </button>
          {!rightPanelCollapsed ? <RightPanel /> : null}
        </div>
      </main>
      {settingsOpen ? <SettingsPage onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  )
}
