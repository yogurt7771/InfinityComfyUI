import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const releaseDir = join(rootDir, 'release')
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const version = packageJson.version
const localImage = process.env.INFINITY_COMFYUI_IMAGE?.trim() || 'infinity-comfyui:local'
const versionedImage = `infinity-comfyui:v${version}`
const artifactBase = `Infinity ComfyUI Docker ${version}`
const imagePath = join(releaseDir, `${artifactBase}.tar`)
const composePath = join(releaseDir, `${artifactBase}.compose.yml`)
const readmePath = join(releaseDir, `${artifactBase}.README.txt`)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.quiet ? 'ignore' : 'inherit',
    shell: false,
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
}

mkdirSync(releaseDir, { recursive: true })
run('docker', ['image', 'inspect', localImage], { quiet: true })
run('docker', ['tag', localImage, versionedImage])
run('docker', ['save', '-o', imagePath, localImage, versionedImage])
copyFileSync(join(rootDir, 'packaging', 'docker-compose.release.yml'), composePath)
writeFileSync(
  readmePath,
  `Infinity ComfyUI Docker ${version}

1. Load the image:
   docker load -i "${artifactBase}.tar"

2. Start the service:
   docker compose -f "${artifactBase}.compose.yml" up -d

3. Open:
   http://127.0.0.1:7930

4. Stop:
   docker compose -f "${artifactBase}.compose.yml" down

The default host ComfyUI address is http://127.0.0.1:27707.
Override COMFY_PROXY_TARGET_BASE or configure the server URL in Infinity when needed.
ComfyUI page passwords are entered manually in the embedded page; API tokens remain separate.
`,
  'utf8',
)

console.log(`[Infinity ComfyUI] Exported Docker release files to ${releaseDir}`)
