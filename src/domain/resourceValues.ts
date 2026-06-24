import type {
  AssetBackedPrimitiveResourceValue,
  AssetRecord,
  MediaResourceValue,
  PrimitiveInputValue,
  ProjectState,
  Resource,
  ResourceType,
} from './types'

export const isAssetBackedResourceValue = (
  value: Resource['value'] | undefined,
): value is MediaResourceValue | AssetBackedPrimitiveResourceValue =>
  typeof value === 'object' && value !== null && 'assetId' in value && typeof value.assetId === 'string'

export const isMediaResourceValue = (value: Resource['value'] | undefined): value is MediaResourceValue =>
  isAssetBackedResourceValue(value) && 'url' in value

export const isAssetBackedPrimitiveResourceValue = (
  value: Resource['value'] | undefined,
): value is AssetBackedPrimitiveResourceValue =>
  isAssetBackedResourceValue(value) && 'kind' in value && (value.kind === 'text' || value.kind === 'number')

export const resourceAssetId = (resource: Resource | undefined) =>
  isAssetBackedResourceValue(resource?.value) ? resource.value.assetId : undefined

const primitiveMimeType = (type: Extract<ResourceType, 'text' | 'number'>) =>
  type === 'number' ? 'application/x.infinity-number' : 'text/plain'

const primitiveSizeBytes = (value: string | number) => new TextEncoder().encode(String(value)).length

export const primitiveResourceValueWithAsset = (
  assetId: string,
  type: Extract<ResourceType, 'text' | 'number'>,
  value: string | number,
): AssetBackedPrimitiveResourceValue => ({
  assetId,
  kind: type,
  mimeType: primitiveMimeType(type),
  sizeBytes: primitiveSizeBytes(value),
})

export const primitiveAssetRecord = (
  assetId: string,
  name: string,
  type: Extract<ResourceType, 'text' | 'number'>,
  value: string | number,
  createdAt: string,
): AssetRecord => ({
  id: assetId,
  name,
  mimeType: primitiveMimeType(type),
  sizeBytes: primitiveSizeBytes(value),
  primitiveValue: type === 'number' ? Number(value) : String(value),
  createdAt,
})

export const resolvedPrimitiveResourceValue = (
  resource: Resource | undefined,
  assets: Record<string, AssetRecord>,
  fallback: PrimitiveInputValue = null,
): PrimitiveInputValue => {
  if (!resource) return fallback
  if (typeof resource.value === 'string' || typeof resource.value === 'number') return resource.value
  if (isMediaResourceValue(resource.value)) return resource.value.url
  if (!isAssetBackedPrimitiveResourceValue(resource.value)) return fallback

  const primitiveValue = assets[resource.value.assetId]?.primitiveValue
  if (resource.value.kind === 'number') {
    const numericValue = Number(primitiveValue)
    return Number.isFinite(numericValue) ? numericValue : fallback
  }
  return primitiveValue === undefined || primitiveValue === null ? fallback : String(primitiveValue)
}

export const resolvedResourceDisplayValue = (
  resource: Resource,
  assets: Record<string, AssetRecord>,
): string | number | MediaResourceValue => {
  if (typeof resource.value === 'string' || typeof resource.value === 'number') return resource.value
  if (isMediaResourceValue(resource.value)) return resource.value
  return resolvedPrimitiveResourceValue(resource, assets, '') ?? ''
}

export const resolveResourceForDisplay = (project: ProjectState, resource: Resource): Resource => {
  if (!isAssetBackedPrimitiveResourceValue(resource.value)) return resource
  return {
    ...resource,
    value: resolvedPrimitiveResourceValue(resource, project.assets, resource.value.kind === 'number' ? 0 : '') ?? '',
  }
}
