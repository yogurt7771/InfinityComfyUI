import type { Resource } from '../domain/types'

const mediaValue = (resource: Resource) =>
  typeof resource.value === 'object' && resource.value !== null && 'url' in resource.value
    ? resource.value
    : undefined

const resourceLabel = (resource: Resource) => resource.name ?? resource.id

export function ResourcePreview({ resource }: { resource: Resource }) {
  const media = mediaValue(resource)
  const label = resourceLabel(resource)

  if (resource.type === 'image' && media?.url) {
    return <img className="resource-preview-image" src={media.url} alt={label} />
  }

  if (resource.type === 'video' && media?.url) {
    return <video aria-label={`${label} video`} className="resource-preview-video" src={media.url} controls muted />
  }

  if (resource.type === 'audio' && media?.url) {
    return <audio aria-label={`${label} audio`} className="resource-preview-audio" src={media.url} controls />
  }

  return <p className="resource-preview-text">{String(resource.value)}</p>
}
