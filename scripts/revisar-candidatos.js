#!/usr/bin/env node
/**
 * Servidor local (solo para tu máquina) para revisar los candidatos que
 * juntó `buscar-candidatos.js` y elegir a mano cuál imagen usar por
 * producto. Al confirmar una (o pegar una URL propia), la procesa (resize +
 * webp con Sharp) y la guarda como archivo del repo en `imagenes-productos/`,
 * actualizando `data/imagenes-asignadas.json`.
 *
 * NO usa Vercel Blob para nada — las imágenes quedan como archivos locales
 * que hay que commitear y pushear (`git add imagenes-productos
 * data/imagenes-asignadas.json && git commit && git push`) para que se vean
 * en producción. `api/catalogo.js` las sirve mezclándolas con el catálogo.
 *
 * Uso:
 *   node scripts/revisar-candidatos.js
 *   (o) npm run candidatos:revisar
 *
 * Abrí http://localhost:4321 en el navegador.
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const {
  loadEnvFiles,
  optimizar,
  guardarImagenComoArchivo,
  descargarImagenDetallada,
} = require('./enrich-imagenes')

const ROOT = path.join(__dirname, '..')
const CANDIDATOS_DIR = path.join(ROOT, 'data', 'candidatos')
const INDEX_PATH = path.join(CANDIDATOS_DIR, 'index.json')
const PORT = Number(process.env.PORT_REVISION || 4321)

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function leerIndex() {
  if (!fs.existsSync(INDEX_PATH)) return { productos: [] }
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'))
}

function guardarIndex(index) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2))
}

function enviarJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > 5 * 1024 * 1024) {
        reject(new Error('Body demasiado grande'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

const PAGE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Revisión de candidatos de imagen</title>
<style>
  :root { --navy: #003e7b; --bg: #f5f5f5; --line: rgba(0,0,0,.08); }
  * { box-sizing: border-box; }
  body { font: 15px/1.4 'Inter', system-ui, sans-serif; background: var(--bg); margin: 0; color: #0a0f1c; }
  header { background: #fff; padding: 18px 24px; box-shadow: 0 1px 0 var(--line); position: sticky; top: 0; z-index: 5; }
  header h1 { font-size: 18px; margin: 0; }
  header p { margin: 4px 0 0; font-size: 13px; color: rgba(10,15,28,.6); }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 18px; }
  .tarjeta { background: #fff; border-radius: 16px; padding: 18px; box-shadow: inset 0 0 0 1px var(--line); }
  .tarjeta.aplicado { box-shadow: inset 0 0 0 2px #2e7d32; background: #f1f8f1; }
  .tarjeta.descartado { opacity: .5; }
  .tarjeta__cabecera { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .tarjeta__nombre { font-weight: 700; font-size: 15px; }
  .tarjeta__meta { font-size: 13px; color: rgba(10,15,28,.55); }
  .tarjeta__precio { color: var(--navy); font-weight: 700; }
  .tarjeta__estado { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .tarjeta__estado.pendiente { background: #fff4e0; color: #a15c00; }
  .tarjeta__estado.aplicado { background: #e3f5e6; color: #2e7d32; }
  .tarjeta__estado.descartado { background: #eee; color: #777; }
  .candidatos { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-top: 14px; }
  .candidato { border-radius: 10px; padding: 6px; cursor: pointer; box-shadow: inset 0 0 0 1px var(--line); background: var(--bg); }
  .candidato.elegido { box-shadow: inset 0 0 0 2px #c0392b; background: #fdecea; }
  .candidato img { display: block; width: 100%; aspect-ratio: 1/1; object-fit: cover; border-radius: 6px; background: #fff; }
  .candidato a { display: block; font-size: 10px; color: rgba(10,15,28,.4); text-decoration: none; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acciones { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
  button { font: inherit; border: none; border-radius: 10px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-aplicar { background: var(--navy); color: #fff; }
  .btn-aplicar:disabled { opacity: .4; cursor: not-allowed; }
  .btn-descartar { background: #eee; color: #444; }
  .url-manual { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .url-manual input { flex: 1 1 260px; font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--line); border: none; outline: none; }
  .btn-url { background: #fff; box-shadow: inset 0 0 0 1px var(--line); color: #333; }
  .sin-candidatos { font-size: 13px; color: rgba(10,15,28,.5); margin-top: 10px; }
  .resumen { display: flex; gap: 18px; font-size: 13px; color: rgba(10,15,28,.7); margin-top: 6px; }
  .cargando { text-align: center; padding: 60px 0; color: rgba(10,15,28,.4); }
  .paginado { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 8px 0 24px; }
  .paginado button { background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
  .paginado button:disabled { opacity: .4; cursor: not-allowed; }
  .paginado span { font-size: 13px; color: rgba(10,15,28,.6); font-weight: 600; }
</style>
</head>
<body>
<header>
  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
    <div>
      <h1>Revisión de candidatos de imagen</h1>
      <p>Elegí la mejor foto (o pegá una URL propia) y confirmá. Se guarda como archivo del repo — necesitás commitear y pushear para publicarlo.</p>
    </div>
    <button id="btn-recargar" style="background:var(--bg); color:#333; flex:none;">Recargar</button>
  </div>
  <div class="resumen" id="resumen"></div>
  <div class="paginado" id="paginado-arriba" hidden></div>
</header>
<main id="main"><div class="cargando">Cargando…</div></main>
<div class="paginado" id="paginado-abajo" hidden></div>
<script>
let productos = []
let elegido = {}
let paginaActual = 0
const POR_PAGINA = 12

async function cargar() {
  const res = await fetch('/api/estado', { cache: 'no-store' })
  const data = await res.json()
  const seleccionPrevia = elegido
  productos = data.productos || []
  elegido = seleccionPrevia
  paginaActual = 0
  render()
}

document.getElementById('btn-recargar').addEventListener('click', cargar)

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

function formatoLegible(s) {
  const t = String(s || '').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const moneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
function formatPrecio(n) {
  return Number.isFinite(n) ? moneda.format(n) : '—'
}

function render() {
  const pendientes = productos.filter((p) => p.estado === 'pendiente').length
  const aplicados = productos.filter((p) => p.estado === 'aplicado').length
  const descartados = productos.filter((p) => p.estado === 'descartado').length
  document.getElementById('resumen').innerHTML =
    '<span>' + pendientes + ' pendientes</span><span>' + aplicados + ' aplicados</span><span>' + descartados + ' descartados</span>'

  if (!productos.length) {
    document.getElementById('main').innerHTML = '<div class="cargando">No hay candidatos. Corré <code>npm run candidatos:buscar</code> primero.</div>'
    document.getElementById('paginado-arriba').hidden = true
    document.getElementById('paginado-abajo').hidden = true
    return
  }

  const visibles = productos.filter((p) => p.estado === 'pendiente')
  if (!visibles.length) {
    document.getElementById('main').innerHTML = '<div class="cargando">No quedan productos pendientes de revisar. Corré <code>npm run candidatos:buscar</code> para traer más.</div>'
    document.getElementById('paginado-arriba').hidden = true
    document.getElementById('paginado-abajo').hidden = true
    return
  }

  const totalPaginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA))
  if (paginaActual > totalPaginas - 1) paginaActual = totalPaginas - 1
  const desde = paginaActual * POR_PAGINA
  const pagina = visibles.slice(desde, desde + POR_PAGINA)

  const htmlPaginado = totalPaginas > 1
    ? '<button class="pag-anterior" ' + (paginaActual === 0 ? 'disabled' : '') + '>‹ Anterior</button>' +
      '<span>Página ' + (paginaActual + 1) + ' de ' + totalPaginas + ' (' + visibles.length + ' pendientes)</span>' +
      '<button class="pag-siguiente" ' + (paginaActual >= totalPaginas - 1 ? 'disabled' : '') + '>Siguiente ›</button>'
    : ''
  for (const elId of ['paginado-arriba', 'paginado-abajo']) {
    const el = document.getElementById(elId)
    el.hidden = totalPaginas <= 1
    el.innerHTML = htmlPaginado
  }
  document.querySelectorAll('.pag-anterior').forEach((b) => b.addEventListener('click', () => { paginaActual--; render() }))
  document.querySelectorAll('.pag-siguiente').forEach((b) => b.addEventListener('click', () => { paginaActual++; render() }))

  document.getElementById('main').innerHTML = pagina.map((p) => {
    const sel = elegido[p.id]
    const candidatosHtml = p.candidatos.length
      ? '<div class="candidatos">' + p.candidatos.map((c, idx) => (
          '<div class="candidato' + (sel === idx ? ' elegido' : '') + '" data-id="' + escapeHtml(p.id) + '" data-idx="' + idx + '">' +
          '<img src="/candidatos/' + escapeHtml(p.id) + '/' + escapeHtml(c.archivo) + '" loading="lazy" />' +
          '<a href="' + escapeHtml(c.url) + '" target="_blank" rel="noopener" title="' + escapeHtml(c.title || '') + '">fuente ↗</a>' +
          '</div>'
        )).join('') + '</div>'
      : '<p class="sin-candidatos">No se encontraron candidatos para este producto.</p>'

    const disabled = p.estado !== 'pendiente' || sel === undefined
    return (
      '<div class="tarjeta ' + p.estado + '" data-card="' + escapeHtml(p.id) + '">' +
      '<div class="tarjeta__cabecera">' +
      '<div>' +
      '<div class="tarjeta__nombre">' + escapeHtml(formatoLegible(p.producto)) + '</div>' +
      '<div class="tarjeta__meta">' + escapeHtml(formatoLegible(p.categoria)) + ' · <span class="tarjeta__precio">' + formatPrecio(p.precio) + '</span></div>' +
      '</div>' +
      '<span class="tarjeta__estado ' + p.estado + '">' + p.estado + '</span>' +
      '</div>' +
      candidatosHtml +
      (p.estado === 'pendiente'
        ? '<div class="acciones">' +
          '<button class="btn-aplicar" data-accion="aplicar" data-id="' + escapeHtml(p.id) + '" ' + (disabled ? 'disabled' : '') + '>Usar esta imagen</button>' +
          '<button class="btn-descartar" data-accion="descartar" data-id="' + escapeHtml(p.id) + '">Ninguna sirve</button>' +
          '</div>' +
          '<div class="url-manual">' +
          '<input type="url" placeholder="O pegá una URL de imagen…" data-url-input="' + escapeHtml(p.id) + '" />' +
          '<button class="btn-url" data-accion="aplicar-url" data-id="' + escapeHtml(p.id) + '">Usar esta URL</button>' +
          '</div>'
        : '') +
      '</div>'
    )
  }).join('')
}

document.getElementById('main').addEventListener('click', async (e) => {
  const candidato = e.target.closest('.candidato')
  if (candidato) {
    elegido[candidato.dataset.id] = Number(candidato.dataset.idx)
    render()
    return
  }
  const boton = e.target.closest('button[data-accion]')
  if (!boton) return
  const id = boton.dataset.id
  if (boton.dataset.accion === 'aplicar') {
    const idx = elegido[id]
    const p = productos.find((x) => x.id === id)
    const candidato = p.candidatos[idx]
    boton.disabled = true
    boton.textContent = 'Guardando…'
    try {
      const res = await fetch('/api/aplicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, archivo: candidato.archivo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al aplicar')
      p.estado = 'aplicado'
      render()
    } catch (err) {
      alert('No se pudo aplicar: ' + err.message)
      boton.disabled = false
      boton.textContent = 'Usar esta imagen'
    }
  } else if (boton.dataset.accion === 'aplicar-url') {
    const input = document.querySelector('[data-url-input="' + id + '"]')
    const url = (input && input.value || '').trim()
    if (!url) { alert('Pegá una URL primero'); return }
    boton.disabled = true
    boton.textContent = 'Descargando…'
    try {
      const res = await fetch('/api/aplicar-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al aplicar la URL')
      const p = productos.find((x) => x.id === id)
      p.estado = 'aplicado'
      render()
    } catch (err) {
      alert('No se pudo usar esa URL: ' + err.message)
      boton.disabled = false
      boton.textContent = 'Usar esta URL'
    }
  } else if (boton.dataset.accion === 'descartar') {
    try {
      const res = await fetch('/api/descartar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al descartar')
      const p = productos.find((x) => x.id === id)
      p.estado = 'descartado'
      render()
    } catch (err) {
      alert('No se pudo descartar: ' + err.message)
    }
  }
})

cargar()
</script>
</body>
</html>
`

async function main() {
  loadEnvFiles()

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGE_HTML)
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/estado') {
        enviarJson(res, 200, leerIndex())
        return
      }

      if (req.method === 'GET' && url.pathname.startsWith('/candidatos/')) {
        const rel = decodeURIComponent(url.pathname.replace('/candidatos/', ''))
        const abs = path.join(CANDIDATOS_DIR, rel)
        if (!abs.startsWith(CANDIDATOS_DIR) || !fs.existsSync(abs)) {
          res.writeHead(404)
          res.end('No encontrado')
          return
        }
        const ext = path.extname(abs).toLowerCase()
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
        fs.createReadStream(abs).pipe(res)
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/aplicar') {
        const { id, archivo } = await leerCuerpo(req)
        if (!id || !archivo) return enviarJson(res, 400, { error: 'Faltan id/archivo' })

        const index = leerIndex()
        const entrada = index.productos.find((p) => p.id === id)
        if (!entrada) return enviarJson(res, 404, { error: 'Producto no está en el índice de candidatos' })
        const candidato = entrada.candidatos.find((c) => c.archivo === archivo)
        if (!candidato) return enviarJson(res, 404, { error: 'Candidato no encontrado' })

        const archivoLocal = path.join(CANDIDATOS_DIR, id, archivo)
        if (!fs.existsSync(archivoLocal)) return enviarJson(res, 404, { error: 'Archivo local no encontrado' })

        const buffer = fs.readFileSync(archivoLocal)
        const webp = await optimizar(buffer)
        const rutaPublica = guardarImagenComoArchivo(id, webp)

        entrada.estado = 'aplicado'
        entrada.archivoElegido = archivo
        entrada.urlElegida = candidato.url
        entrada.origen = 'candidato'
        entrada.imagenAplicada = rutaPublica
        entrada.aplicadoAt = new Date().toISOString()
        guardarIndex(index)

        enviarJson(res, 200, { ok: true, imagen: rutaPublica })
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/aplicar-url') {
        const { id, url: urlImagen } = await leerCuerpo(req)
        if (!id || !urlImagen) return enviarJson(res, 400, { error: 'Faltan id/url' })
        if (!/^https?:\/\//i.test(urlImagen)) return enviarJson(res, 400, { error: 'La URL debe empezar con http:// o https://' })

        const index = leerIndex()
        const entrada = index.productos.find((p) => p.id === id)
        if (!entrada) return enviarJson(res, 404, { error: 'Producto no está en el índice de candidatos' })

        let buffer
        try {
          const detalle = await descargarImagenDetallada(urlImagen)
          buffer = detalle.buffer
        } catch (err) {
          return enviarJson(res, 400, { error: `No se pudo descargar esa URL: ${err.message}` })
        }
        const webp = await optimizar(buffer)
        const rutaPublica = guardarImagenComoArchivo(id, webp)

        entrada.estado = 'aplicado'
        entrada.archivoElegido = null
        entrada.urlElegida = urlImagen
        entrada.origen = 'manual'
        entrada.imagenAplicada = rutaPublica
        entrada.aplicadoAt = new Date().toISOString()
        guardarIndex(index)

        enviarJson(res, 200, { ok: true, imagen: rutaPublica })
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/descartar') {
        const { id } = await leerCuerpo(req)
        if (!id) return enviarJson(res, 400, { error: 'Falta id' })
        const index = leerIndex()
        const entrada = index.productos.find((p) => p.id === id)
        if (!entrada) return enviarJson(res, 404, { error: 'Producto no está en el índice de candidatos' })
        entrada.estado = 'descartado'
        entrada.descartadoAt = new Date().toISOString()
        guardarIndex(index)
        enviarJson(res, 200, { ok: true })
        return
      }

      res.writeHead(404)
      res.end('No encontrado')
    } catch (err) {
      enviarJson(res, 500, { error: err.message })
    }
  })

  server.listen(PORT, () => {
    console.log(`Revisión de candidatos en http://localhost:${PORT}`)
    console.log('Las imágenes se guardan en imagenes-productos/ (archivos del repo) — no se usa Vercel Blob.')
    console.log('No te olvides de "git add imagenes-productos data/imagenes-asignadas.json && git commit && git push" para publicarlas.')
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
