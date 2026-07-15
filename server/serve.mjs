import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 7930)
const distRoot = path.resolve(process.env.DIST_DIR || path.join(process.cwd(), 'app-dist'))
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
])

const insideDist = (candidate) => candidate === distRoot || candidate.startsWith(`${distRoot}${path.sep}`)

const resolveStaticFile = async (pathname) => {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const candidate = path.resolve(distRoot, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`)
  if (!insideDist(candidate)) return undefined
  try {
    if ((await stat(candidate)).isFile()) return candidate
  } catch {}

  if (path.extname(decoded)) return undefined
  const indexFile = path.join(distRoot, 'index.html')
  try {
    return (await stat(indexFile)).isFile() ? indexFile : undefined
  } catch {
    return undefined
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    const filePath = await resolveStaticFile(requestUrl.pathname)
    if (!filePath) {
      response.statusCode = 404
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end('Not found')
      return
    }

    response.statusCode = 200
    response.setHeader('content-type', contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream')
    response.setHeader(
      'cache-control',
      path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    )
    if (request.method === 'HEAD') response.end()
    else createReadStream(filePath).pipe(response)
  })().catch((error) => {
    response.statusCode = 500
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end(error instanceof Error ? error.message : 'Infinity app server failed')
  })
})

server.on('upgrade', (_request, socket) => socket.destroy())

server.listen(port, host, () => {
  console.log(`Infinity ComfyUI serving ${distRoot} at http://${host}:${port}`)
})
