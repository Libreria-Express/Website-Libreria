#!/usr/bin/env node
/**
 * Servidor de desarrollo 100% local para probar TODO el sitio, incluido
 * /admin con login real, antes de pushear nada. No usa `vercel dev` (evita
 * el lío de cuentas/login de Vercel) — levanta un http.createServer que sirve
 * los estáticos y adapta los handlers de api/*.js al formato que espera
 * Vercel (req.body ya parseado, res.status().json()).
 *
 * IMPORTANTE — por seguridad mientras probamos antes de pushear a main:
 *   - /api/admin-imagen y /api/admin-imagen-descartar NO commitean a GitHub
 *     acá: escriben localmente en imagenes-productos/ y
 *     data/imagenes-asignadas.json, igual que scripts/revisar-candidatos.js.
 *     Así podés usar el panel real (secciones 3 y 4) sin tocar el repo.
 *   - El resto (login, catálogo, Excel) es el código real de api/*.js.
 *
 * Uso:
 *   node scripts/dev-server.js
 *   (o) npm run dev:local
 * Abrí http://localhost:4323/admin.html (usuario: la ADMIN_PASSWORD de tu .env.local)
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const {
  loadEnvFiles,
  guardarImagenComoArchivo,
  cargarImagenesAsignadas,
  guardarImagenesAsignadas,
} = require('../scripts/enrich-imagenes')

loadEnvFiles()

const ROOT = path.join(__dirname, '..')
const PORT = Number(process.env.PORT_DEV || 4323)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
}

// --- Adaptador: convierte un handler estilo Vercel en algo que funciona con http.createServer ---
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > 20 * 1024 * 1024) {
        reject(new Error('Body demasiado grande'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function adaptar(handler) {
  return async (req, res) => {
    try {
      const buf = await leerCuerpo(req)
      const contentType = req.headers['content-type'] || ''
      if (buf.length) {
        if (contentType.includes('application/json')) {
          try {
            req.body = JSON.parse(buf.toString('utf8'))
          } catch {
            req.body = {}
          }
        } else {
          req.body = buf
        }
      } else {
        req.body = {}
      }
      res.status = (code) => {
        res.statusCode = code
        return res
      }
      res.json = (obj) => {
        const body = JSON.stringify(obj)
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(body)
      }
      await handler(req, res)
    } catch (err) {
      console.error('Error en', req.url, err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: err.message }))
      }
    }
  }
}

// --- Versiones LOCALES (sin GitHub) de subir/descartar imagen, para poder ---
// --- probar el panel real sin arriesgar un push accidental. ------------------
const sharp = require('sharp')
const fallback = require('../data/catalogo-inicial.json')
const { isAuthenticated } = require('../api/_auth')
const { aplicarImagenesAsignadas } = require('../api/_catalogo')

const TAMANO = 320
const MAX_IMAGEN_DESCARGADA = 12 * 1024 * 1024

async function descargarImagenDesdeUrlLocal(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_IMAGEN_DESCARGADA) throw new Error('La imagen descargada es demasiado grande')
  if (buf.length < 500) throw new Error('La imagen descargada es demasiado chica o está vacía')
  return buf
}

async function adminImagenLocal(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' })
  const { id, base64, url } = req.body || {}
  if (!id) return res.status(400).json({ error: 'Falta el id del producto' })
  if (!base64 && !url) return res.status(400).json({ error: 'Falta la imagen: subí un archivo o pegá una URL' })

  const productos = aplicarImagenesAsignadas(fallback)
  if (!productos.some((p) => p.id === id)) return res.status(404).json({ error: 'No se encontró un producto con ese id' })

  let bufferOriginal
  try {
    bufferOriginal = base64 ? Buffer.from(base64, 'base64') : await descargarImagenDesdeUrlLocal(url)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  let webp
  try {
    webp = await sharp(bufferOriginal).resize(TAMANO, TAMANO, { fit: 'cover' }).webp({ quality: 75 }).toBuffer()
  } catch {
    return res.status(400).json({ error: 'No se pudo procesar la imagen. ¿Es un archivo de imagen válido?' })
  }

  const rutaPublica = guardarImagenComoArchivo(id, webp)
  res.json({ ok: true, imagen: rutaPublica, aviso: '[DEV LOCAL] Guardado en imagenes-productos/ — NO se subió a GitHub.' })
}

async function adminImagenDescartarLocal(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autenticado' })
  const { ids } = req.body || {}
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Falta la lista de ids a descartar' })
  const asignadas = cargarImagenesAsignadas()
  let descartados = 0
  for (const id of ids) {
    if (asignadas[id] !== undefined) {
      delete asignadas[id]
      descartados++
    }
  }
  guardarImagenesAsignadas(asignadas)
  res.json({ ok: true, descartados })
}

// --- Rutas ---
const rutas = {
  '/api/catalogo': adaptar(require('../api/catalogo')),
  '/api/admin-check': adaptar(require('../api/admin-check')),
  '/api/admin-login': adaptar(require('../api/admin-login')),
  '/api/admin-logout': adaptar(require('../api/admin-logout')),
  '/api/admin-upload': adaptar(require('../api/admin-upload')),
  '/api/catalogo-excel': adaptar(require('../api/catalogo-excel')),
  '/api/admin-imagen': adaptar(adminImagenLocal),
  '/api/admin-imagen-descartar': adaptar(adminImagenDescartarLocal),
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const ruta = rutas[url.pathname]
  if (ruta) {
    await ruta(req, res)
    return
  }

  let rel = url.pathname === '/' ? '/index.html' : url.pathname
  let abs = path.join(ROOT, decodeURIComponent(rel))
  // Replica vercel.json (cleanUrls: true): /admin -> /admin.html, /catalogo -> /catalogo.html
  if ((!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) && fs.existsSync(abs + '.html')) {
    abs = abs + '.html'
  }
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404)
    res.end('No encontrado: ' + rel)
    return
  }
  const ext = path.extname(abs).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
  fs.createReadStream(abs).pipe(res)
})

server.listen(PORT, () => {
  console.log(`Servidor de desarrollo en http://localhost:${PORT}`)
  console.log(`  Catálogo: http://localhost:${PORT}/catalogo.html`)
  console.log(`  Admin:    http://localhost:${PORT}/admin.html  (contraseña: la ADMIN_PASSWORD de tu .env.local)`)
  console.log('Subir/descartar imagen desde /admin acá NO toca GitHub: escribe local en imagenes-productos/.')
  console.log('Ctrl+C para salir.')
})
