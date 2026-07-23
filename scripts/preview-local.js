#!/usr/bin/env node
/**
 * Preview 100% local del catálogo público, tal como se vería en producción
 * una vez desplegados los cambios — pero SIN tocar git ni GitHub ni Vercel.
 *
 * Sirve los archivos estáticos del sitio (catalogo.html, catalogo.js, css,
 * imagenes-productos/, etc.) y un /api/catalogo local que devuelve el
 * catálogo de respaldo con las imágenes de data/imagenes-asignadas.json ya
 * mezcladas (la misma lógica que corre en producción en api/catalogo.js).
 *
 * Uso:
 *   node scripts/preview-local.js
 *   (o) npm run preview:local
 * Abrí http://localhost:4323/catalogo.html
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const fallback = require('../data/catalogo-inicial.json')
const { aplicarImagenesAsignadas } = require('../api/_catalogo')

const ROOT = path.join(__dirname, '..')
const PORT = Number(process.env.PORT_PREVIEW || 4323)

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/api/catalogo') {
    const productos = aplicarImagenesAsignadas(fallback)
    const conFoto = productos.filter((p) => p.imagen).length
    const body = JSON.stringify({ productos, actualizado: null, fuente: 'preview-local' })
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(body)
    console.log(`GET /api/catalogo -> ${productos.length} productos, ${conFoto} con foto`)
    return
  }

  let rel = url.pathname === '/' ? '/catalogo.html' : url.pathname
  const abs = path.join(ROOT, decodeURIComponent(rel))
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
  const productos = aplicarImagenesAsignadas(fallback)
  const conFoto = productos.filter((p) => p.imagen)
  console.log(`Preview local en http://localhost:${PORT}/catalogo.html`)
  console.log(`(${conFoto.length} producto(s) van a mostrar foto ahí mismo, tal como se verían en producción)`)
  for (const p of conFoto) console.log(' -', p.producto, '->', p.imagen)
  console.log('No modifica nada en git/GitHub/Vercel. Ctrl+C para salir.')
})
