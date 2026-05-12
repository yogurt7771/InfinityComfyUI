import '@xyflow/react/dist/style.css'
import { useEffect, useState } from 'react'
import {
  Activity,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Database,
  PanelLeftClose,
  PanelRightClose,
  Settings,
} from 'lucide-react'
import { CanvasWorkspace } from './components/CanvasWorkspace'
import { LeftPanel, RightPanel, SettingsPage } from './components/WorkbenchPanels'
import { useProjectStore } from './store/projectStore'
import './styles.css'

export default function App() {
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const project = useProjectStore((state) => state.project)
  const checkComfyEndpointStatuses = useProjectStore((state) => state.checkComfyEndpointStatuses)

  useEffect(() => {
    void checkComfyEndpointStatuses()
    const intervalId = window.setInterval(() => {
      void checkComfyEndpointStatuses()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [checkComfyEndpointStatuses])

  return (
    <div className="app-shell">
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
          <button type="button" className="topbar-settings-button" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={15} />
            Settings
          </button>
        </nav>
      </header>
      <main
        className={[
          'workbench',
          leftPanelCollapsed ? 'left-collapsed' : '',
          rightPanelCollapsed ? 'right-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={`panel-shell left-panel-shell ${leftPanelCollapsed ? 'is-collapsed' : ''}`}>
          <button
            className="panel-collapse-button left-collapse-button"
            type="button"
            aria-label={leftPanelCollapsed ? 'Expand left panel' : 'Collapse left panel'}
            onClick={() => setLeftPanelCollapsed((value) => !value)}
          >
            {leftPanelCollapsed ? <ChevronRight size={17} /> : <PanelLeftClose size={17} />}
          </button>
          {!leftPanelCollapsed ? <LeftPanel /> : null}
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
