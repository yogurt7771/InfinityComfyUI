import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Resource } from '../domain/types'
import { projectStore } from '../store/projectStore'
import { ModalFrame } from './ModalFrame'

const mediaValue = (resource: Resource) =>
  typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value ? resource.value : undefined

export const resourceDownloadName = (resource: Resource) => {
  const media = mediaValue(resource)
  if (media?.filename) return media.filename
  if (resource.type === 'text' || resource.type === 'number' || resource.type === 'boolean') {
    const name = resource.name ?? resource.id
    return name.toLowerCase().endsWith('.txt') ? name : `${name}.txt`
  }
  return resource.name ?? resource.id
}

const fetchResourceBlob = async (resource: Resource) => {
  if (projectStore.getState().project.resources[resource.id]) {
    return projectStore.getState().fetchResourceBlob(resource.id)
  }
  const media = mediaValue(resource)
  if (!media?.url) throw new Error(`Resource is missing a URL: ${resource.id}`)
  const response = await fetch(media.url)
  if (!response.ok) throw new Error(`Failed to fetch resource: ${response.status}`)
  return response.blob()
}

function usePreviewMediaSource(resource: Resource) {
  const media = mediaValue(resource)
  const key =
    media?.url && media.comfy
      ? [
          resource.id,
          media.url,
          media.comfy.endpointId,
          media.comfy.filename,
          media.comfy.subfolder,
          media.comfy.type,
        ].join('|')
      : undefined
  const [objectUrl, setObjectUrl] = useState<{ key: string; url: string }>()

  useEffect(() => {
    if (!key) return undefined

    let canceled = false
    let nextObjectUrl: string | undefined
    fetchResourceBlob(resource)
      .then((blob) => {
        if (canceled) return
        nextObjectUrl = URL.createObjectURL(blob)
        setObjectUrl({ key, url: nextObjectUrl })
      })
      .catch(() => {
        if (!canceled) setObjectUrl((current) => (current?.key === key ? undefined : current))
      })

    return () => {
      canceled = true
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
    }
  }, [key, resource])

  if (!media?.url) return undefined
  return key ? (objectUrl?.key === key ? objectUrl.url : undefined) : media.url
}

function FullResourcePreview({ resource }: { resource: Resource }) {
  const mediaSource = usePreviewMediaSource(resource)
  const label = resourceDownloadName(resource)

  if (resource.type === 'image' && mediaSource) {
    return <img className="full-preview-image" src={String(mediaSource)} alt={label} />
  }

  if (resource.type === 'video' && mediaSource) {
    return <video className="full-preview-video" src={String(mediaSource)} controls aria-label={`${label} full preview`} />
  }

  if (resource.type === 'audio' && mediaSource) {
    return <audio className="full-preview-audio" src={String(mediaSource)} controls aria-label={`${label} full preview`} />
  }

  const textValue = typeof resource.value === 'string' ? resource.value : JSON.stringify(resource.value, null, 2)
  return <pre className="full-preview-text">{textValue}</pre>
}

export function sameTypePreviewResources(
  resourcesById: Record<string, Resource>,
  resource: Resource,
  fallbackFunctionNodeId?: string,
  fallbackWorkflowFunctionId?: string,
) {
  const functionNodeId = resource.source.functionNodeId ?? fallbackFunctionNodeId
  const workflowFunctionId = resource.metadata?.workflowFunctionId ?? fallbackWorkflowFunctionId
  const candidates = Object.values(resourcesById).filter(
    (candidate) =>
      candidate.source.kind === 'function_output' &&
      candidate.type === resource.type &&
      ((Boolean(functionNodeId) && candidate.source.functionNodeId === functionNodeId) ||
        (Boolean(workflowFunctionId) && candidate.metadata?.workflowFunctionId === workflowFunctionId)),
  )

  if (candidates.some((candidate) => candidate.id === resource.id)) return candidates
  return [resource, ...candidates]
}

export function FullResourcePreviewModal({
  resource,
  resources = [],
  onClose,
}: {
  resource?: Resource
  resources?: Resource[]
  onClose: () => void
}) {
  const [previewState, setPreviewState] = useState<{
    initialResourceId?: string
    currentResourceId?: string
  }>({})

  const initialResourceId = resource?.id
  const currentResourceId =
    previewState.initialResourceId === initialResourceId ? previewState.currentResourceId : initialResourceId
  const currentIndex = Math.max(
    0,
    resources.findIndex((item) => item.id === currentResourceId),
  )
  const currentResource = resources[currentIndex] ?? resource
  const canNavigate = resources.length > 1
  const setCurrentResourceId = (id: string | undefined) => {
    setPreviewState({ initialResourceId, currentResourceId: id })
  }
  const goToPrevious = () => {
    if (!canNavigate) return
    setCurrentResourceId(resources[(currentIndex - 1 + resources.length) % resources.length]?.id)
  }
  const goToNext = () => {
    if (!canNavigate) return
    setCurrentResourceId(resources[(currentIndex + 1) % resources.length]?.id)
  }

  if (!resource || !currentResource) return null

  const label = resourceDownloadName(currentResource)
  return (
    <ModalFrame
      label={`Preview ${label}`}
      onClose={onClose}
      backdropClassName="full-preview-backdrop nodrag nopan"
      dialogClassName="full-preview-modal"
      onGlobalKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          if (!canNavigate) return
          event.preventDefault()
          goToPrevious()
        }
        if (event.key === 'ArrowRight') {
          if (!canNavigate) return
          event.preventDefault()
          goToNext()
        }
      }}
    >
        <div className="full-preview-header">
          <div>
            <h2>{label}</h2>
            <span>{currentResource.type}</span>
          </div>
          <div className="full-preview-header-actions">
            {canNavigate ? (
              <div className="full-preview-nav" aria-label="Preview navigation">
                <button type="button" aria-label="Previous result" onClick={goToPrevious}>
                  <ChevronLeft size={16} />
                </button>
                <span className="full-preview-counter">
                  {currentIndex + 1} / {resources.length}
                </span>
                <button type="button" aria-label="Next result" onClick={goToNext}>
                  <ChevronRight size={16} />
                </button>
              </div>
            ) : null}
            <button type="button" aria-label="Close full preview" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="full-preview-body">
          <FullResourcePreview resource={currentResource} />
        </div>
    </ModalFrame>
  )
}
