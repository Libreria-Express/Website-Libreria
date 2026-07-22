#!/usr/bin/env node
/**
 * Busca VARIOS candidatos de imagen por producto (búsqueda en cascada:
 * marca+nombre, nombre+categoría, nombre solo) y los descarga localmente en
 * data/candidatos/<id>/ para poder elegir a mano cuál usar con
 * `npm run candidatos:revisar`.
 *
 * A diferencia de enrich-imagenes.js (que elige automáticamente el primer
 * resultado "usable"), este script NO sube nada a Blob ni toca el catálogo:
 * solo junta opciones para revisar.
 *
 * Uso:
 *   node scripts/buscar-candidatos.js --limit 10 --only-missing
 *   node scripts/buscar-candidatos.js --ids id1,id2,id3
 *
 * Env: no requiere BLOB_READ_WRITE_TOKEN (solo lee el catálogo; si no está
 * el token usa el catálogo local de respaldo).
 */

const fs = require('fs')
const path = require('path')
const {
  loadEnvFiles,
  leerCatalogo,
  tieneImagenProducto,
  recolectarCandidatos,
  descargarImagenDetallada,
  aplicarImagenesAsignadas,
} = require('./enrich-imagenes')

const ROOT = path.join(__dirname, '..')
const CANDIDATOS_DIR = path.join(ROOT, 'data', 'candidatos')
const INDEX_PATH = path.join(CANDIDATOS_DIR, 'index.json')
const MAX_CANDIDATOS = 5
const DELAY_MS_ENTRE_PRODUCTOS = 3000

function parseArgs(argv) {
  const opts = { limit: 10, onlyMissing: true, engine: 'ddg', ids: null, retryDescartados: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--limit') {
      opts.limit = Number(argv[++i])
      if (!Number.isFinite(opts.limit) || opts.limit <= 0) throw new Error('--limit debe ser un número positivo')
    } else if (a === '--only-missing') opts.onlyMissing = true
    else if (a === '--all') opts.onlyMissing = false
    else if (a === '--engine') opts.engine = String(argv[++i] || '').toLowerCase()
    else if (a === '--ids') opts.ids = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--retry-descartados') opts.retryDescartados = true
    else if (a === '--help' || a === '-h') opts.help = true
    else throw new Error(`Flag desconocido: ${a}`)
  }
  return opts
}

function printHelp() {
  console.log(`Uso: node scripts/buscar-candidatos.js [flags]

Flags:
  --limit N         Máximo de productos a procesar en esta corrida (default 10)
  --only-missing    Solo productos sin imagen de producto (default, salvo --ids)
  --all             Incluye también productos que ya tienen imagen
  --ids a,b,c       Procesa solo esos IDs de producto (ignora --limit/--only-missing)
  --engine ddg|serpapi   Motor de búsqueda (default: ddg)
  --retry-descartados    Vuelve a buscar productos que ya marcaste "Ninguna sirve"
                         (por default se saltean para no repetir trabajo)

Después de correr esto, revisá y elegí las imágenes con:
  npm run candidatos:revisar
`)
}

function extensionDesde(contentType, url) {
  if (/png/i.test(contentType)) return 'png'
  if (/webp/i.test(contentType)) return 'webp'
  if (/gif/i.test(contentType)) return 'gif'
  if (/jpe?g/i.test(contentType)) return 'jpg'
  const m = /\.(jpe?g|png|webp|gif)(\?|$)/i.exec(url)
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg')
  return 'jpg'
}

function limpiarDir(dir) {
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f))
}

async function main() {
  loadEnvFiles()
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    printHelp()
    process.exit(1)
  }
  if (opts.help) {
    printHelp()
    process.exit(0)
  }

  const productos = aplicarImagenesAsignadas(await leerCatalogo())

  fs.mkdirSync(CANDIDATOS_DIR, { recursive: true })
  const index = fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : { productos: [] }
  const porId = new Map(index.productos.map((p) => [p.id, p]))

  let candidatosProductos
  if (opts.ids && opts.ids.length) {
    const idsSet = new Set(opts.ids)
    candidatosProductos = productos.filter((p) => idsSet.has(p.id))
  } else if (opts.onlyMissing) {
    candidatosProductos = productos.filter((p) => !tieneImagenProducto(p))
  } else {
    candidatosProductos = productos
  }
  // No repetir trabajo: por default salteamos cualquier producto que ya esté en el
  // índice (pendiente de revisar, ya aplicado, o descartado), salvo que se pida
  // explícitamente reintentar los descartados.
  candidatosProductos = candidatosProductos.filter((p) => {
    const previo = porId.get(p.id)
    if (!previo) return true
    if (previo.estado === 'descartado' && opts.retryDescartados) return true
    return false
  })

  const lote = opts.limit != null ? candidatosProductos.slice(0, opts.limit) : candidatosProductos
  if (!lote.length) {
    console.log('No hay productos para procesar con esos filtros.')
    return
  }
  console.log(`Buscando candidatos para ${lote.length} producto(s)… (engine=${opts.engine})`)

  for (let i = 0; i < lote.length; i++) {
    const p = lote[i]
    process.stdout.write(`[${i + 1}/${lote.length}] ${p.id.slice(0, 60)}… `)

    const candidatos = await recolectarCandidatos(p.producto, p.categoria, {
      engine: opts.engine,
      maxCandidatos: MAX_CANDIDATOS,
    })

    const dirProducto = path.join(CANDIDATOS_DIR, p.id)
    fs.mkdirSync(dirProducto, { recursive: true })
    limpiarDir(dirProducto)

    const descargados = []
    for (let c = 0; c < candidatos.length; c++) {
      try {
        const { buffer, contentType } = await descargarImagenDetallada(candidatos[c].url)
        const ext = extensionDesde(contentType, candidatos[c].url)
        const archivo = `${c}.${ext}`
        fs.writeFileSync(path.join(dirProducto, archivo), buffer)
        descargados.push({ archivo, url: candidatos[c].url, title: candidatos[c].title })
      } catch (err) {
        // Ese candidato puntual no se pudo descargar; seguimos con el resto.
      }
    }

    porId.set(p.id, {
      id: p.id,
      producto: p.producto,
      categoria: p.categoria,
      precio: p.precio,
      candidatos: descargados,
      estado: 'pendiente',
      buscadoAt: new Date().toISOString(),
    })
    console.log(`${descargados.length} candidato(s) descargados`)

    // Guardado incremental: así se puede empezar a revisar sin esperar a que
    // termine todo el lote.
    index.productos = Array.from(porId.values())
    index.actualizado = new Date().toISOString()
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2))

    if (i < lote.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS_ENTRE_PRODUCTOS))
  }

  index.productos = Array.from(porId.values())
  index.actualizado = new Date().toISOString()
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2))
  console.log(`\nListo. Índice guardado en ${INDEX_PATH}`)
  console.log('Ahora corré: npm run candidatos:revisar')
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
