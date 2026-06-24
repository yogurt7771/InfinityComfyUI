import { useEffect, useState } from 'react'
import type { Resource } from '../domain/types'
import { resolvedResourceDisplayValue } from '../domain/resourceValues'
import { projectStore, useProjectStore } from '../store/projectStore'

const mediaValue = (resource: Resource) =>
  typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value
    ? resource.value
    : undefined

const resourceLabel = (resource: Resource) => resource.name ?? resource.id

const shouldProxyMedia = (resource: Resource) => {
  const media = mediaValue(resource)
  if (!media?.url) return false
  return Boolean(media.comfy || resource.metadata?.endpointId)
}

const proxyMediaKey = (resource: Resource) => {
  const media = mediaValue(resource)
  if (!media?.url || !shouldProxyMedia(resource)) return undefined
  return [
    resource.id,
    media.url,
    media.comfy?.endpointId ?? resource.metadata?.endpointId ?? '',
    media.comfy?.filename ?? '',
    media.comfy?.subfolder ?? '',
    media.comfy?.type ?? '',
  ].join('|')
}

function useMediaSource(resource: Resource) {
  const media = mediaValue(resource)
  const key = proxyMediaKey(resource)
  const [objectUrl, setObjectUrl] = useState<{ key: string; url: string }>()

  useEffect(() => {
    if (!key) return undefined

    let canceled = false
    let nextObjectUrl: string | undefined
    projectStore
      .getState()
      .fetchResourceBlob(resource.id)
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
  }, [key, resource.id])

  if (!media?.url) return undefined
  return key ? (objectUrl?.key === key ? objectUrl.url : undefined) : media.url
}

export function ResourcePreview({ resource }: { resource: Resource }) {
  const assets = useProjectStore((state) => state.project.assets)
  const previewResource = { ...resource, value: resolvedResourceDisplayValue(resource, assets) }
  const media = mediaValue(previewResource)
  const label = resourceLabel(previewResource)
  const mediaSource = useMediaSource(previewResource)

  if (resource.type === 'image' && mediaSource) {
    return <img className="resource-preview-image" src={mediaSource} alt={label} />
  }

  if (resource.type === 'video' && mediaSource) {
    return <video aria-label={`${label} video`} className="resource-preview-video" src={mediaSource} controls muted />
  }

  if (resource.type === 'audio' && mediaSource) {
    return <audio aria-label={`${label} audio`} className="resource-preview-audio" src={mediaSource} controls />
  }

  if ((resource.type === 'image' || resource.type === 'video' || resource.type === 'audio') && media && !media.url) {
    return <p className="resource-preview-text resource-preview-empty">No {resource.type}</p>
  }

  if (media?.url) return <p className="resource-preview-text">Loading {resource.type}</p>
  return <p className="resource-preview-text">{String(previewResource.value)}</p>
}
