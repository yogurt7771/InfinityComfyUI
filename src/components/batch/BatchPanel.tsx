import { useState } from 'react'
import { ImagePlus, RefreshCcw, XCircle } from 'lucide-react'
import type { BatchRun, ExecutionTask, Resource } from '../../domain/types'
import { useProjectStore } from '../../store/projectStore'
import { ResourcePreview } from '../ResourcePreview'
import { FullResourcePreviewModal } from '../ResourcePreviewModal'

const terminalItemStatuses = new Set<ExecutionTask['status']>(['succeeded', 'failed', 'canceled'])

const batchStatusLabel = (batch: BatchRun) => {
  if (batch.status === 'canceled') return '已取消'
  if (batch.status === 'completed') return '已完成'
  return '运行中'
}

const itemStatusLabel = (status: ExecutionTask['status']) => {
  if (status === 'succeeded') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'canceled') return '已取消'
  if (status === 'running') return '运行中'
  return '排队中'
}

function BatchItemCard({ batch, item }: { batch: BatchRun; item: BatchRun['items'][number] }) {
  const project = useProjectStore((state) => state.project)
  const retryBatchItem = useProjectStore((state) => state.retryBatchItem)
  const revealBatchItemOnCanvas = useProjectStore((state) => state.revealBatchItemOnCanvas)
  const [previewResource, setPreviewResource] = useState<Resource | undefined>()

  const task = project.tasks[item.taskId]
  const outputResources = Object.values(task?.outputRefs ?? {})
    .flat()
    .map((ref) => project.resources[ref.resourceId])
    .filter((resource): resource is Resource => Boolean(resource))
  const terminal = terminalItemStatuses.has(item.status)

  return (
    <article className={`batch-item-card batch-item-${item.status}`}>
      <div className="batch-item-header">
        <strong title={item.stem}>{item.stem}</strong>
        <span className={`job-status job-status-${item.status}`}>{itemStatusLabel(item.status)}</span>
      </div>
      <small className="batch-item-files">{Object.values(item.files).join(' + ')}</small>
      {item.error ? <p className="job-error">{item.error}</p> : null}
      {outputResources.length > 0 ? (
        <div className="run-output-strip" aria-label={`批量项 ${item.stem} 输出预览`}>
          {outputResources.slice(0, 4).map((resource) => (
            <button
              key={resource.id}
              type="button"
              className="run-output-preview"
              aria-label={`预览 ${resource.name ?? resource.id}`}
              onClick={() => setPreviewResource(resource)}
            >
              <ResourcePreview resource={resource} />
            </button>
          ))}
          {outputResources.length > 4 ? <span className="run-output-more">+{outputResources.length - 4}</span> : null}
        </div>
      ) : null}
      <div className="batch-item-actions">
        {terminal && item.status !== 'succeeded' ? (
          <button
            type="button"
            aria-label={`重跑 ${item.stem}`}
            onClick={() => void retryBatchItem(batch.id, item.taskId)}
          >
            <RefreshCcw size={13} />
            重跑
          </button>
        ) : null}
        {item.status === 'succeeded' && outputResources.length > 0 ? (
          <button
            type="button"
            aria-label={`应用 ${item.stem} 到画布`}
            onClick={() => revealBatchItemOnCanvas(batch.id, item.taskId)}
          >
            <ImagePlus size={13} />
            应用到画布
          </button>
        ) : null}
      </div>
      <FullResourcePreviewModal
        resource={previewResource}
        resources={previewResource ? [previewResource] : []}
        onClose={() => setPreviewResource(undefined)}
      />
    </article>
  )
}

function BatchRunCard({ batch }: { batch: BatchRun }) {
  const project = useProjectStore((state) => state.project)
  const cancelBatchRun = useProjectStore((state) => state.cancelBatchRun)
  const retryFailedBatchItems = useProjectStore((state) => state.retryFailedBatchItems)
  const [expanded, setExpanded] = useState(batch.status === 'running')

  const doneCount = batch.items.filter((item) => terminalItemStatuses.has(item.status)).length
  const failedCount = batch.items.filter((item) => item.status === 'failed' || item.status === 'canceled').length
  const sourceTask = project.tasks[batch.sourceTaskId]
  const functionName = sourceTask
    ? (sourceTask.functionSnapshot?.name ?? project.functions[sourceTask.functionId]?.name ?? sourceTask.functionId)
    : batch.sourceTaskId

  return (
    <article className={`batch-card batch-card-${batch.status}`}>
      <button
        type="button"
        className="job-card-button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="job-card-title-row">
          <span className="job-card-title">
            <strong>{functionName}</strong>
            <small>
              {doneCount}/{batch.items.length} 项 · seed {batch.seedMode === 'fixed' ? '固定' : '随机'}
            </small>
          </span>
          <span className={`job-status job-status-${batch.status === 'running' ? 'running' : batch.status === 'canceled' ? 'canceled' : 'succeeded'}`}>
            {batchStatusLabel(batch)}
          </span>
        </span>
      </button>
      <div className="batch-card-actions">
        {batch.status === 'running' ? (
          <button type="button" aria-label="取消批量" onClick={() => cancelBatchRun(batch.id)}>
            <XCircle size={13} />
            取消
          </button>
        ) : null}
        {batch.status !== 'running' && failedCount > 0 ? (
          <button type="button" aria-label="重跑失败项" onClick={() => void retryFailedBatchItems(batch.id)}>
            <RefreshCcw size={13} />
            重跑失败项（{failedCount}）
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="batch-item-grid" aria-label="批量项列表">
          {batch.items.map((item) => (
            <BatchItemCard key={item.taskId} batch={batch} item={item} />
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function BatchPanel() {
  const batches = useProjectStore((state) => state.project.batches)
  const batchList = Object.values(batches ?? {}).sort((left, right) => right.createdAt - left.createdAt)

  if (batchList.length === 0) return <div className="empty-list">暂无批量运行</div>

  return (
    <div className="batch-list" aria-label="批量运行列表">
      {batchList.map((batch) => (
        <BatchRunCard key={batch.id} batch={batch} />
      ))}
    </div>
  )
}
