import JSZip from 'jszip'
import { collectProjectAssetFiles, hydrateProjectAssetFiles, type ProjectAssetFileEntry } from './projectAssets'
import type { ConfigPackage, FullProjectPackage } from './projectPackage'

export type ProjectTransferPayload = {
  manifest?: unknown
  project?: FullProjectPackage['project']
  config?: ConfigPackage['config']
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const safeDownloadBaseName = (name: string | undefined, fallback: string) => {
  const normalized = name
    ?.trim()
    .replace(/[<>:"/\\|?*#%&\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return normalized || fallback
}

export async function downloadPackage(
  filename: string,
  entries: Record<string, unknown>,
  files: ProjectAssetFileEntry[] = [],
) {
  const zip = new JSZip()
  for (const [path, value] of Object.entries(entries)) {
    zip.file(path, JSON.stringify(value, null, 2))
  }
  for (const file of files) {
    zip.file(file.path, file.blob)
  }
  downloadBlob(filename, await zip.generateAsync({ type: 'blob' }))
}

export async function downloadProjectPackage(
  pkg: FullProjectPackage,
  filename = `${safeDownloadBaseName(pkg.project.project.name, 'project')}.aicanvas`,
) {
  const assetFiles = await collectProjectAssetFiles(pkg.project)
  await downloadPackage(
    filename,
    {
      'manifest.json': pkg.manifest,
      'project.json': pkg.project,
      'config/assets.json': assetFiles.manifest,
    },
    assetFiles.files,
  )
}

export async function downloadConfigPackage(
  pkg: ConfigPackage,
  filename = `${safeDownloadBaseName(pkg.project?.name, 'config')}.aicanvas-config`,
) {
  await downloadPackage(filename, {
    'manifest.json': pkg.manifest,
    'config.json': pkg.config,
  })
}

export async function readPackageFile(file: File): Promise<ProjectTransferPayload> {
  if (file.name.endsWith('.json')) {
    return JSON.parse(await file.text()) as ProjectTransferPayload
  }

  const zip = await JSZip.loadAsync(file)
  const manifestFile = zip.file('manifest.json')
  const projectFile = zip.file('project.json')
  const configFile = zip.file('config.json')
  const assetManifestFile = zip.file('config/assets.json') ?? zip.file('assets.json')
  const assetManifest = assetManifestFile ? JSON.parse(await assetManifestFile.async('text')) : undefined
  const project = projectFile ? JSON.parse(await projectFile.async('text')) : undefined
  const hydratedProject = project
    ? await hydrateProjectAssetFiles(project, assetManifest, async (assetPath) => {
        const normalizedPath = assetPath.startsWith('assets/') ? assetPath : `assets/${assetPath}`
        return (await (zip.file(normalizedPath) ?? zip.file(assetPath))?.async('blob')) ?? undefined
      })
    : undefined

  return {
    manifest: manifestFile ? JSON.parse(await manifestFile.async('text')) : undefined,
    project: hydratedProject,
    config: configFile ? JSON.parse(await configFile.async('text')) : undefined,
  }
}
