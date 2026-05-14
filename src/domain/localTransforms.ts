import type {
  FunctionInputDef,
  FunctionOutputDef,
  GenerationFunction,
  LocalTransformKind,
  MediaResourceValue,
  PrimitiveInputValue,
  Resource,
  ResourceRef,
  ResourceType,
} from './types'
import type { MediaResourcePayload } from './resourceFiles'

export const LOCAL_IMAGE_RESIZE_FUNCTION_ID = 'fn_local_image_resize'
export const LOCAL_IMAGE_BLUR_FUNCTION_ID = 'fn_local_image_blur'
export const LOCAL_IMAGE_GRID_SPLIT_FUNCTION_ID = 'fn_local_image_grid_split'
export const LOCAL_IMAGE_INFO_FUNCTION_ID = 'fn_local_image_info'
export const LOCAL_TEXT_TRIM_FUNCTION_ID = 'fn_local_text_trim'
export const LOCAL_TEXT_CASE_FUNCTION_ID = 'fn_local_text_case'
export const LOCAL_VIDEO_INFO_FUNCTION_ID = 'fn_local_video_info'
export const LOCAL_AUDIO_INFO_FUNCTION_ID = 'fn_local_audio_info'

type RuntimeInputValues = Record<string, PrimitiveInputValue | ResourceRef>
export type LocalTransformOutputValue = string | number | MediaResourcePayload
export type LocalTransformOutput = {
  key: string
  label: string
  type: ResourceType
  values: LocalTransformOutputValue[]
}

const input = (
  key: string,
  label: string,
  type: ResourceType,
  required: boolean,
  defaultValue?: string | number | null,
): FunctionInputDef => ({
  key,
  label,
  type,
  required,
  defaultValue,
  bind: { path: key },
})

const output = (key: string, label: string, type: ResourceType, multiple = false): FunctionOutputDef => ({
  key,
  label,
  type,
  bind: { path: key },
  extract: { source: 'node_output', multiple },
})

const localFunction = (
  id: string,
  name: string,
  category: string,
  kind: LocalTransformKind,
  inputs: FunctionInputDef[],
  outputs: FunctionOutputDef[],
  now: string,
): GenerationFunction => ({
  id,
  name,
  category,
  description: 'Local browser-side transform',
  workflow: {
    format: 'local_transform',
    version: '1',
    rawJson: {},
  },
  localTransform: { kind },
  inputs,
  outputs,
  runtimeDefaults: {
    runCount: 1,
    seedPolicy: { mode: 'randomize_all_before_submit' },
  },
  createdAt: now,
  updatedAt: now,
})

export const createLocalTransformFunctions = (now: string) => [
  localFunction(
    LOCAL_IMAGE_RESIZE_FUNCTION_ID,
    'Resize Image',
    'Local Image',
    'image_resize',
    [input('image', 'Image', 'image', true), input('scale', 'Scale', 'number', false, 0.5)],
    [output('image', 'Image', 'image')],
    now,
  ),
  localFunction(
    LOCAL_IMAGE_BLUR_FUNCTION_ID,
    'Blur Image',
    'Local Image',
    'image_blur',
    [input('image', 'Image', 'image', true), input('radius', 'Radius', 'number', false, 8)],
    [output('image', 'Image', 'image')],
    now,
  ),
  localFunction(
    LOCAL_IMAGE_GRID_SPLIT_FUNCTION_ID,
    'Split Image Grid',
    'Local Image',
    'image_grid_split',
    [
      input('image', 'Image', 'image', true),
      input('columns', 'Columns', 'number', false, 2),
      input('rows', 'Rows', 'number', false, 2),
    ],
    [output('image', 'Images', 'image', true)],
    now,
  ),
  localFunction(
    LOCAL_IMAGE_INFO_FUNCTION_ID,
    'Image Info',
    'Local Image',
    'image_info',
    [input('image', 'Image', 'image', true)],
    [output('text', 'Info', 'text')],
    now,
  ),
  localFunction(
    LOCAL_TEXT_TRIM_FUNCTION_ID,
    'Trim Text',
    'Local Text',
    'text_trim',
    [input('text', 'Text', 'text', true)],
    [output('text', 'Text', 'text')],
    now,
  ),
  localFunction(
    LOCAL_TEXT_CASE_FUNCTION_ID,
    'Text Case',
    'Local Text',
    'text_case',
    [input('text', 'Text', 'text', true), input('mode', 'Mode', 'text', false, 'uppercase')],
    [output('text', 'Text', 'text')],
    now,
  ),
  localFunction(
    LOCAL_VIDEO_INFO_FUNCTION_ID,
    'Video Info',
    'Local Video',
    'video_info',
    [input('video', 'Video', 'video', true)],
    [output('text', 'Info', 'text')],
    now,
  ),
  localFunction(
    LOCAL_AUDIO_INFO_FUNCTION_ID,
    'Audio Info',
    'Local Audio',
    'audio_info',
    [input('audio', 'Audio', 'audio', true)],
    [output('text', 'Info', 'text')],
    now,
  ),
]

export const isLocalTransformFunction = (fn: GenerationFunction) =>
  fn.workflow.format === 'local_transform' && Boolean(fn.localTransform?.kind)

const isResourceRef = (value: PrimitiveInputValue | ResourceRef | undefined): value is ResourceRef =>
  typeof value === 'object' && value !== null && 'resourceId' in value

const mediaValue = (resource: Resource | undefined): MediaResourceValue | undefined =>
  typeof resource?.value === 'object' && resource.value !== null && 'url' in resource.value
    ? resource.value
    : undefined

const requiredResource = (
  functionDef: GenerationFunction,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  inputKey: string,
) => {
  const ref = inputValues[inputKey]
  if (!isResourceRef(ref)) throw new Error(`${functionDef.name} requires ${inputKey}`)
  const resource = resources[ref.resourceId]
  if (!resource) throw new Error(`Resource not found: ${ref.resourceId}`)
  return resource
}

const primitiveInput = (
  functionDef: GenerationFunction,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  inputKey: string,
) => {
  const inputDef = functionDef.inputs.find((item) => item.key === inputKey)
  const value = inputValues[inputKey]
  if (isResourceRef(value)) return resources[value.resourceId]?.value
  if (value !== undefined && value !== null) return value
  return inputDef?.defaultValue
}

const numberInput = (
  functionDef: GenerationFunction,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  inputKey: string,
  fallback: number,
) => {
  const value = Number(primitiveInput(functionDef, inputValues, resources, inputKey))
  return Number.isFinite(value) ? value : fallback
}

const textInput = (
  functionDef: GenerationFunction,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  inputKey: string,
  fallback = '',
) => {
  const value = primitiveInput(functionDef, inputValues, resources, inputKey)
  return value === undefined || value === null ? fallback : String(value)
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Blob could not be converted to a data URL'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Blob read failed')))
    reader.readAsDataURL(blob)
  })

const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas export failed'))
    }, 'image/png')
  })

const loadImageFromBlob = async (blob: Blob) => {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Image could not be decoded'))
    })
    image.src = url
    return await loaded
  } finally {
    URL.revokeObjectURL(url)
  }
}

const mediaBaseName = (resource: Resource, fallback: string) => {
  const filename = mediaValue(resource)?.filename ?? resource.name ?? fallback
  return filename.replace(/\.[^.]+$/, '') || fallback
}

const imagePayloadFromCanvas = async (canvas: HTMLCanvasElement, filename: string): Promise<MediaResourcePayload> => {
  const blob = await canvasToPngBlob(canvas)
  return {
    url: await blobToDataUrl(blob),
    filename,
    mimeType: 'image/png',
    sizeBytes: blob.size,
    width: canvas.width,
    height: canvas.height,
  }
}

const drawImageToCanvas = (width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is not available')
  draw(context)
  return canvas
}

const loadMediaMetadata = async (blob: Blob, kind: 'audio' | 'video') => {
  const url = URL.createObjectURL(blob)
  try {
    const element = kind === 'video' ? document.createElement('video') : document.createElement('audio')
    const loaded = new Promise<HTMLMediaElement>((resolve, reject) => {
      element.onloadedmetadata = () => resolve(element)
      element.onerror = () => reject(new Error(`${kind} metadata could not be read`))
    })
    element.preload = 'metadata'
    element.src = url
    return await loaded
  } finally {
    URL.revokeObjectURL(url)
  }
}

const infoText = (data: Record<string, unknown>) => JSON.stringify(data, null, 2)

export async function executeLocalTransformFunction(
  functionDef: GenerationFunction,
  inputValues: RuntimeInputValues,
  resources: Record<string, Resource>,
  readResourceBlob: (resource: Resource) => Promise<Blob>,
): Promise<LocalTransformOutput[]> {
  const kind = functionDef.localTransform?.kind
  if (!kind) throw new Error('Local transform kind is missing')

  if (kind === 'image_resize') {
    const resource = requiredResource(functionDef, inputValues, resources, 'image')
    const image = await loadImageFromBlob(await readResourceBlob(resource))
    const scale = Math.max(0.01, numberInput(functionDef, inputValues, resources, 'scale', 0.5))
    const canvas = drawImageToCanvas(image.naturalWidth * scale, image.naturalHeight * scale, (context) => {
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, image.naturalWidth * scale, image.naturalHeight * scale)
    })
    return [
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        values: [await imagePayloadFromCanvas(canvas, `${mediaBaseName(resource, 'image')}-resize.png`)],
      },
    ]
  }

  if (kind === 'image_blur') {
    const resource = requiredResource(functionDef, inputValues, resources, 'image')
    const image = await loadImageFromBlob(await readResourceBlob(resource))
    const radius = Math.max(0, numberInput(functionDef, inputValues, resources, 'radius', 8))
    const canvas = drawImageToCanvas(image.naturalWidth, image.naturalHeight, (context) => {
      context.filter = `blur(${radius}px)`
      context.drawImage(image, 0, 0)
    })
    return [
      {
        key: 'image',
        label: 'Image',
        type: 'image',
        values: [await imagePayloadFromCanvas(canvas, `${mediaBaseName(resource, 'image')}-blur.png`)],
      },
    ]
  }

  if (kind === 'image_grid_split') {
    const resource = requiredResource(functionDef, inputValues, resources, 'image')
    const image = await loadImageFromBlob(await readResourceBlob(resource))
    const columns = Math.max(1, Math.min(24, Math.floor(numberInput(functionDef, inputValues, resources, 'columns', 2))))
    const rows = Math.max(1, Math.min(24, Math.floor(numberInput(functionDef, inputValues, resources, 'rows', 2))))
    const tileWidth = image.naturalWidth / columns
    const tileHeight = image.naturalHeight / rows
    const values: MediaResourcePayload[] = []

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const canvas = drawImageToCanvas(tileWidth, tileHeight, (context) => {
          context.drawImage(
            image,
            column * tileWidth,
            row * tileHeight,
            tileWidth,
            tileHeight,
            0,
            0,
            tileWidth,
            tileHeight,
          )
        })
        values.push(await imagePayloadFromCanvas(canvas, `${mediaBaseName(resource, 'image')}-grid-${row + 1}-${column + 1}.png`))
      }
    }

    return [{ key: 'image', label: 'Images', type: 'image', values }]
  }

  if (kind === 'image_info') {
    const resource = requiredResource(functionDef, inputValues, resources, 'image')
    const image = await loadImageFromBlob(await readResourceBlob(resource))
    return [
      {
        key: 'text',
        label: 'Info',
        type: 'text',
        values: [
          infoText({
            filename: mediaValue(resource)?.filename ?? resource.name,
            mimeType: mediaValue(resource)?.mimeType,
            width: image.naturalWidth,
            height: image.naturalHeight,
          }),
        ],
      },
    ]
  }

  if (kind === 'text_trim') {
    const resource = requiredResource(functionDef, inputValues, resources, 'text')
    return [{ key: 'text', label: 'Text', type: 'text', values: [String(resource.value ?? '').trim()] }]
  }

  if (kind === 'text_case') {
    const resource = requiredResource(functionDef, inputValues, resources, 'text')
    const mode = textInput(functionDef, inputValues, resources, 'mode', 'uppercase').trim().toLowerCase()
    const text = String(resource.value ?? '')
    const transformed =
      mode === 'lowercase'
        ? text.toLowerCase()
        : mode === 'titlecase'
          ? text.replace(/\S+/g, (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
          : text.toUpperCase()
    return [{ key: 'text', label: 'Text', type: 'text', values: [transformed] }]
  }

  if (kind === 'video_info' || kind === 'audio_info') {
    const inputKey = kind === 'video_info' ? 'video' : 'audio'
    const resource = requiredResource(functionDef, inputValues, resources, inputKey)
    const element = await loadMediaMetadata(await readResourceBlob(resource), inputKey)
    return [
      {
        key: 'text',
        label: 'Info',
        type: 'text',
        values: [
          infoText({
            filename: mediaValue(resource)?.filename ?? resource.name,
            mimeType: mediaValue(resource)?.mimeType,
            durationMs: Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : undefined,
            width: 'videoWidth' in element ? element.videoWidth : undefined,
            height: 'videoHeight' in element ? element.videoHeight : undefined,
          }),
        ],
      },
    ]
  }

  throw new Error(`Unsupported local transform: ${kind}`)
}
