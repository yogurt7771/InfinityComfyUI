import { useMemo, useRef, useState } from 'react'
import { FolderOpen, Play } from 'lucide-react'
import type { BatchSeedMode, FunctionInputDef, GenerationFunction } from '../../domain/types'
import { useProjectStore } from '../../store/projectStore'
import { ModalFrame } from '../ModalFrame'

const BATCH_FILE_EXTENSIONS: Record<string, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'],
  text: ['txt'],
}

const fileStem = (filename: string) => {
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename
}

const fileExtension = (filename: string) => {
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex > 0 ? filename.slice(dotIndex + 1).toLowerCase() : ''
}

const filterFilesForInput = (files: File[], input: FunctionInputDef) => {
  const extensions = BATCH_FILE_EXTENSIONS[input.type] ?? []
  return files.filter((file) => extensions.includes(fileExtension(file.name)))
}

type InputSelection = {
  enabled: boolean
  files: File[]
}

type PreviewGroup = {
  stem: string
  files: Record<string, File>
  missing: string[]
}

export function BatchRunDialog({ sourceTaskId, onClose }: { sourceTaskId: string; onClose: () => void }) {
  const project = useProjectStore((state) => state.project)
  const startBatchRunFromResult = useProjectStore((state) => state.startBatchRunFromResult)
  const [selections, setSelections] = useState<Record<string, InputSelection>>({})
  const [seedMode, setSeedMode] = useState<BatchSeedMode>('random')
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const folderInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const task = project.tasks[sourceTaskId]
  const functionDef: GenerationFunction | undefined = task
    ? (task.functionSnapshot ?? project.functions[task.functionId])
    : undefined
  const batchableInputs = useMemo(
    () =>
      (functionDef?.inputs ?? []).filter(
        (input) =>
          input.type === 'image' || input.type === 'video' || input.type === 'audio' || input.type === 'text',
      ),
    [functionDef],
  )

  const participatingInputs = batchableInputs.filter(
    (input) => (selections[input.key]?.enabled ?? false) && (selections[input.key]?.files.length ?? 0) > 0,
  )

  const { completeGroups, skippedGroups } = useMemo(() => {
    const stems = new Set<string>()
    const filesByStem = new Map<string, Record<string, File>>()
    for (const input of participatingInputs) {
      for (const file of selections[input.key]?.files ?? []) {
        const stem = fileStem(file.name)
        stems.add(stem)
        const group = filesByStem.get(stem) ?? {}
        group[input.key] = file
        filesByStem.set(stem, group)
      }
    }
    const complete: PreviewGroup[] = []
    const skipped: PreviewGroup[] = []
    for (const stem of [...stems].sort((left, right) => left.localeCompare(right))) {
      const files = filesByStem.get(stem) ?? {}
      const missing = participatingInputs.filter((input) => !files[input.key]).map((input) => input.label || input.key)
      const group: PreviewGroup = { stem, files, missing }
      if (missing.length > 0) skipped.push(group)
      else complete.push(group)
    }
    return { completeGroups: complete, skippedGroups: skipped }
  }, [participatingInputs, selections])

  const updateSelection = (inputKey: string, patch: Partial<InputSelection>) => {
    setSelections((current) => {
      const previous = current[inputKey]
      return {
        ...current,
        [inputKey]: {
          enabled: patch.enabled ?? previous?.enabled ?? false,
          files: patch.files ?? previous?.files ?? [],
        },
      }
    })
  }

  const handleFolderPicked = (input: FunctionInputDef, fileList: FileList | null) => {
    const files = filterFilesForInput([...(fileList ?? [])], input)
    updateSelection(input.key, { files })
  }

  const handleStart = async () => {
    setError(undefined)
    setStarting(true)
    try {
      await startBatchRunFromResult(sourceTaskId, {
        groups: completeGroups.map((group) => ({ stem: group.stem, files: group.files })),
        seedMode,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量运行启动失败')
    } finally {
      setStarting(false)
    }
  }

  if (!task || !functionDef) {
    return (
      <ModalFrame label="批量运行" onClose={onClose} dialogClassName="manager-modal batch-dialog">
        <div className="batch-dialog-body">
          <h2 className="batch-dialog-title">批量应用到文件</h2>
          <p className="batch-dialog-note">找不到模板运行记录，无法批量运行。</p>
          <div className="local-action-footer">
            <button type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </ModalFrame>
    )
  }

  return (
    <ModalFrame label="批量运行" onClose={onClose} dialogClassName="manager-modal batch-dialog">
      <div className="batch-dialog-body">
        <h2 className="batch-dialog-title">批量应用到文件 · {functionDef.name}</h2>
        <p className="batch-dialog-note">
          以该运行的完整配置为模板，按文件主名（不含扩展名）配对成组，每组运行一次。未勾选的输入沿用模板原值。
        </p>
      <div className="batch-input-list" aria-label="批量输入设置">
        {batchableInputs.map((input) => {
          const selection = selections[input.key] ?? { enabled: false, files: [] }
          return (
            <div key={input.key} className="batch-input-row">
              <label className="batch-input-toggle">
                <input
                  type="checkbox"
                  checked={selection.enabled}
                  onChange={(event) => updateSelection(input.key, { enabled: event.target.checked })}
                />
                <span>
                  {input.label || input.key}
                  <small>{input.type}</small>
                </span>
              </label>
              {selection.enabled ? (
                <>
                  <button
                    type="button"
                    onClick={() => folderInputRefs.current[input.key]?.click()}
                  >
                    <FolderOpen size={14} />
                    选择文件夹
                  </button>
                  <span className="batch-input-count">
                    {selection.files.length > 0 ? `已选 ${selection.files.length} 个文件` : '未选择'}
                  </span>
                  <input
                    ref={(element) => {
                      folderInputRefs.current[input.key] = element
                    }}
                    className="hidden-input"
                    type="file"
                    multiple
                    {...({ webkitdirectory: '' } as Record<string, string>)}
                    onChange={(event) => {
                      handleFolderPicked(input, event.target.files)
                      event.currentTarget.value = ''
                    }}
                  />
                </>
              ) : null}
            </div>
          )
        })}
        {batchableInputs.length === 0 ? <p>该函数没有可批量替换的输入。</p> : null}
      </div>

      {participatingInputs.length > 0 ? (
        <div className="batch-preview" aria-label="配对预览">
          <h3>配对预览</h3>
          <p>
            共 {completeGroups.length + skippedGroups.length} 组：{completeGroups.length} 组可运行，
            {skippedGroups.length} 组不完整将被跳过。
          </p>
          {skippedGroups.length > 0 ? (
            <ul className="batch-skipped-list" aria-label="跳过的组">
              {skippedGroups.map((group) => (
                <li key={group.stem} className="batch-skipped-item">
                  <strong>{group.stem}</strong>
                  <span>缺少：{group.missing.join('、')}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {completeGroups.length > 0 ? (
            <ul className="batch-group-list" aria-label="可运行的组">
              {completeGroups.slice(0, 8).map((group) => (
                <li key={group.stem}>
                  <strong>{group.stem}</strong>
                  <span>{participatingInputs.map((input) => group.files[input.key]?.name).filter(Boolean).join(' + ')}</span>
                </li>
              ))}
              {completeGroups.length > 8 ? <li>… 共 {completeGroups.length} 组</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="batch-seed-options" aria-label="Seed 策略">
        <span>Seed 策略：</span>
        <label>
          <input
            type="radio"
            name="batch-seed-mode"
            checked={seedMode === 'random'}
            onChange={() => setSeedMode('random')}
          />
          每组随机
        </label>
        <label>
          <input
            type="radio"
            name="batch-seed-mode"
            checked={seedMode === 'fixed'}
            onChange={() => setSeedMode('fixed')}
          />
          全部固定同一 seed
        </label>
      </div>

      {error ? <div className="toast-error dock-toast-error">{error}</div> : null}

      <div className="local-action-footer">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={starting || completeGroups.length === 0}
          onClick={() => void handleStart()}
        >
          <Play size={14} />
          开始批量（{completeGroups.length} 组）
        </button>
      </div>
      </div>
    </ModalFrame>
  )
}
