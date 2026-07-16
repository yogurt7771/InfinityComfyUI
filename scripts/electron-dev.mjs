import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import electron from 'electron'

const developmentUrl = 'http://127.0.0.1:7930/'
const appMode = process.argv[2] === 'electron' ? 'electron' : 'launcher'
const require = createRequire(import.meta.url)
const viteCli = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
const renderer = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '7930', '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'inherit',
})

const stopRenderer = () => {
  if (!renderer.killed) renderer.kill()
}

const waitForRenderer = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (renderer.exitCode !== null) throw new Error(`Vite exited with code ${renderer.exitCode}`)
    try {
      const response = await fetch(developmentUrl)
      if (response.ok) return
    } catch {
      // Vite has not opened its local development port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the Infinity renderer development server')
}

try {
  await waitForRenderer()
  const desktop = spawn(electron, [appMode === 'launcher' ? 'electron/launcher.cjs' : '.'], {
    cwd: process.cwd(),
    env: { ...process.env, INFINITY_DEV_SERVER_URL: developmentUrl },
    stdio: 'inherit',
  })
  const exitCode = await new Promise((resolve, reject) => {
    desktop.once('error', reject)
    desktop.once('exit', (code) => resolve(code ?? 0))
  })
  process.exitCode = exitCode
} finally {
  stopRenderer()
}
