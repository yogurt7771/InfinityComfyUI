import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = join(rootDir, 'dist')
const imageDir = join(distDir, 'images')
const envTemplatePath = join(rootDir, 'packaging', 'release.env')
const envPath = join(distDir, '.env')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `${command} failed`
    throw new Error(detail)
  }
  return result.stdout?.trim() ?? ''
}

function parseEnv(content) {
  const parsed = new Map()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    parsed.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim())
  }
  return parsed
}

function imageRefsFromEnv(content) {
  const env = parseEnv(content)
  const refs = env.get('RELEASE_IMAGE_REFS')
  if (!refs) throw new Error('RELEASE_IMAGE_REFS is required in packaging/release.env')
  return refs
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function listFromEnv(env, key) {
  return (env.get(key) ?? '')
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function safeImageFileName(ref) {
  return `${ref.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.tar`
}

function prepareReleaseImages(env) {
  const localImage = env.get('INFINITY_COMFYUI_IMAGE') || 'infinity-comfyui:local'
  console.log(`[Infinity ComfyUI] Building ${localImage}`)
  run('docker', ['build', '-t', localImage, '.'])

  for (const ref of listFromEnv(env, 'RELEASE_PULL_IMAGE_REFS')) {
    console.log(`[Infinity ComfyUI] Pulling ${ref}`)
    run('docker', ['pull', ref])
  }
}

function writeReleaseCompose() {
  writeFileSync(
    join(distDir, 'docker-compose.yaml'),
    `services:
  infinity-comfyui:
    image: \${INFINITY_COMFYUI_IMAGE:-infinity-comfyui:local}
    container_name: infinity-comfyui
    ports:
      - "\${INFINITY_COMFYUI_PORT:-7930}:7930"
    environment:
      HOST: 0.0.0.0
      PORT: 7930
      COMFY_PROXY_LOOPBACK_HOST: \${COMFY_PROXY_LOOPBACK_HOST:-host.docker.internal}
    extra_hosts:
      - "host.docker.internal:host-gateway"
  comfyui-ui-to-api-server:
    image: \${COMFYUI_UI_TO_API_IMAGE:-comfyui-ui-to-api-server:latest}
    container_name: comfyui-ui-to-api-server
    ports:
      - "\${COMFYUI_UI_TO_API_PORT:-28188}:28188"
`,
    'utf8',
  )
}

function writeStartScripts() {
  writeFileSync(
    join(distDir, 'load-images.ps1'),
    `$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
function Invoke-Docker {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DockerArgs)
  & docker @DockerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($DockerArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}
Get-ChildItem -LiteralPath (Join-Path $root "images") -Filter "*.tar" | Sort-Object Name | ForEach-Object {
  Write-Host "[Infinity ComfyUI] Loading image $($_.Name)"
  Invoke-Docker load -i $_.FullName
}
`,
    'utf8',
  )
  writeFileSync(
    join(distDir, 'start.ps1'),
    `$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
function Invoke-Docker {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DockerArgs)
  & docker @DockerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($DockerArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}
& (Join-Path $root "load-images.ps1")
Invoke-Docker compose --env-file (Join-Path $root ".env") -f (Join-Path $root "docker-compose.yaml") up -d
$port = ((Get-Content (Join-Path $root ".env") | Where-Object { $_ -match '^INFINITY_COMFYUI_PORT=' }) -replace '^INFINITY_COMFYUI_PORT=', '')
Write-Host "[Infinity ComfyUI] Started at http://127.0.0.1:$port"
`,
    'utf8',
  )
  writeFileSync(
    join(distDir, 'stop.ps1'),
    `$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
function Invoke-Docker {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DockerArgs)
  & docker @DockerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($DockerArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}
Invoke-Docker compose --env-file (Join-Path $root ".env") -f (Join-Path $root "docker-compose.yaml") down
`,
    'utf8',
  )
  writeFileSync(
    join(distDir, 'start.bat'),
    `@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
`,
    'utf8',
  )
  writeFileSync(
    join(distDir, 'load-images.sh'),
    `#!/usr/bin/env sh
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
for image in "$root"/images/*.tar; do
  [ -e "$image" ] || continue
  echo "[Infinity ComfyUI] Loading image $(basename "$image")"
  docker load -i "$image"
done
`,
    'utf8',
  )
  writeFileSync(
    join(distDir, 'start.sh'),
    `#!/usr/bin/env sh
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
sh "$root/load-images.sh"
docker compose --env-file "$root/.env" -f "$root/docker-compose.yaml" up -d
port="$(grep '^INFINITY_COMFYUI_PORT=' "$root/.env" | sed 's/^INFINITY_COMFYUI_PORT=//')"
echo "[Infinity ComfyUI] Started at http://127.0.0.1:$port"
`,
    'utf8',
  )
  writeFileSync(
    join(distDir, 'stop.sh'),
    `#!/usr/bin/env sh
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
docker compose --env-file "$root/.env" -f "$root/docker-compose.yaml" down
`,
    'utf8',
  )
}

function writeReadme(imageRefs) {
  writeFileSync(
    join(distDir, 'README.md'),
    `# Infinity ComfyUI Docker Release

This directory is self-contained for Docker startup.

## Start

\`\`\`powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\\start.ps1
\`\`\`

Or double-click \`start.bat\` on Windows.

Linux/macOS:

\`\`\`sh
sh ./start.sh
\`\`\`

## Stop

\`\`\`powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\\stop.ps1
\`\`\`

## Included Docker Images

${imageRefs.map((ref) => `- \`${ref}\``).join('\n')}

The start script loads every \`.tar\` file in \`images/\` before running Docker Compose.
`,
    'utf8',
  )
}

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: 'pipe', shell: false })
  return result.status === 0 ? result.stdout.trim() : undefined
}

function main() {
  if (!existsSync(envTemplatePath)) throw new Error(`Missing ${envTemplatePath}`)

  const envContent = readFileSync(envTemplatePath, 'utf8')
  const env = parseEnv(envContent)
  const imageRefs = imageRefsFromEnv(envContent)
  prepareReleaseImages(env)

  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(imageDir, { recursive: true })

  copyFileSync(envTemplatePath, envPath)

  writeReleaseCompose()
  writeStartScripts()
  writeReadme(imageRefs)

  const imageRecords = []
  for (const ref of imageRefs) {
    run('docker', ['image', 'inspect', ref], { capture: true })
    const fileName = safeImageFileName(ref)
    const target = join(imageDir, fileName)
    console.log(`[Infinity ComfyUI] Saving ${ref} -> ${join('dist', 'images', fileName)}`)
    run('docker', ['save', '-o', target, ref])
    imageRecords.push({ ref, file: `images/${fileName}` })
  }

  writeFileSync(
    join(distDir, 'manifest.json'),
    `${JSON.stringify(
      {
        name: 'Infinity ComfyUI Docker Release',
        generatedAt: new Date().toISOString(),
        gitCommit: gitValue(['rev-parse', 'HEAD']),
        gitTag: gitValue(['describe', '--tags', '--always']),
        files: [
          'docker-compose.yaml',
          '.env',
          'start.ps1',
          'start.bat',
          'stop.ps1',
          'load-images.ps1',
          'start.sh',
          'stop.sh',
          'load-images.sh',
        ],
        images: imageRecords,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  console.log(`[Infinity ComfyUI] Exported release package to ${distDir}`)
}

main()
