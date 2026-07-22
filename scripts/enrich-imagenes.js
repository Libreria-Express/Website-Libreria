#!/usr/bin/env node
/**
 * Enriquece el catálogo con imágenes de producto y las publica en Vercel Blob
 * (mismo layout que /api/admin-imagen).
 *
 * Motor por defecto: DuckDuckGo/Bing vía `ddgs` (gratis, sin API key).
 * Opcional: SerpAPI con --engine serpapi (requiere SERPAPI_API_KEY).
 *
 * Uso:
 *   node scripts/enrich-imagenes.js --dry-run --limit 20
 *   node scripts/enrich-imagenes.js --only-missing --limit 20
 *   node scripts/enrich-imagenes.js --only-missing --resume
 *
 * Env:
 *   BLOB_READ_WRITE_TOKEN  (requerido salvo --dry-run)
 *   SERPAPI_API_KEY        (solo con --engine serpapi)
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const sharp = require('sharp')
const { put, get } = require('@vercel/blob')
const { detectarMarca } = require('./marcas')

const ROOT = path.join(__dirname, '..')
const FALLBACK_CATALOGO = path.join(ROOT, 'data', 'catalogo-inicial.json')
const CHECKPOINT_PATH = path.join(ROOT, 'data', 'enrich-imagenes-checkpoint.json')
const DDG_SCRIPT = path.join(__dirname, 'buscar-imagenes-ddg.py')
const VENV_PYTHON = path.join(ROOT, '.venv-enrich', 'bin', 'python')
const BLOB_PATHNAME = 'catalogo/catalogo.json'
const IMAGENES_ASIGNADAS_PATH = path.join(ROOT, 'data', 'imagenes-asignadas.json')
const IMAGENES_PRODUCTOS_DIR = path.join(ROOT, 'imagenes-productos')
const TAMANO = 320
const SAVE_EVERY = 10
const MIN_IMAGE_BYTES = 2_000
const MIN_SIDE = 80
const DELAY_MS_DDG = 3500
const DELAY_MS_SERPAPI = 250
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

function loadEnvFiles() {
  for (const name of ['.env.local', '.env.development.local', '.env']) {
    const file = path.join(ROOT, name)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    onlyMissing: false,
    resume: false,
    limit: null,
    saveEvery: SAVE_EVERY,
    engine: 'ddg',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--only-missing') opts.onlyMissing = true
    else if (a === '--resume') opts.resume = true
    else if (a === '--engine') {
      opts.engine = String(argv[++i] || '').toLowerCase()
      if (!['ddg', 'serpapi'].includes(opts.engine)) {
        throw new Error('--engine debe ser ddg o serpapi')
      }
    } else if (a === '--limit') {
      opts.limit = Number(argv[++i])
      if (!Number.isFinite(opts.limit) || opts.limit <= 0) {
        throw new Error('--limit debe ser un número positivo')
      }
    } else if (a === '--save-every') {
      opts.saveEvery = Number(argv[++i])
      if (!Number.isFinite(opts.saveEvery) || opts.saveEvery <= 0) {
        throw new Error('--save-every debe ser un número positivo')
      }
    } else if (a === '--help' || a === '-h') {
      opts.help = true
    } else {
      throw new Error(`Flag desconocido: ${a}`)
    }
  }
  return opts
}

function printHelp() {
  console.log(`Uso: node scripts/enrich-imagenes.js [flags]

Flags:
  --dry-run         Busca candidatos pero no descarga ni escribe Blob
  --only-missing    Salta productos que ya tienen imagen de producto en Blob
  --resume          Reanuda desde data/enrich-imagenes-checkpoint.json
  --limit N         Procesa como máximo N productos nuevos en esta corrida
  --save-every N    Persiste el catálogo cada N éxitos (default ${SAVE_EVERY})
  --engine ddg|serpapi   Motor de búsqueda (default: ddg, gratis)

Env:
  BLOB_READ_WRITE_TOKEN  requerido salvo --dry-run
  SERPAPI_API_KEY        solo con --engine serpapi

Setup DDG (una vez):
  python3 -m venv .venv-enrich && .venv-enrich/bin/pip install ddgs
`)
}

function limpiarNombre(producto) {
  return String(producto || '')
    .replace(/\s*\/\s*PRECIO UNITARIO\s*/gi, ' ')
    .replace(/\s*PRECIO UNITARIO\s*/gi, ' ')
    .replace(/\bX\s*\d+\b/gi, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildQuery(producto, categoria) {
  const marca = detectarMarca(producto, categoria)
  const nombre = limpiarNombre(producto)
  const parts = []
  if (marca) parts.push(marca.label)
  parts.push(nombre)
  if (!marca && categoria) parts.push(String(categoria).split('/')[0].trim())
  parts.push('producto')
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function tieneImagenProducto(p) {
  if (!p.imagen || typeof p.imagen !== 'string') return false
  const url = p.imagen
  if (url.includes('imagenes-marca/')) return false
  if (url.includes('data/imagenes-')) return false
  if (url.startsWith('/imagenes-productos/')) return true
  if (/\/imagenes\//.test(url) && /\.webp(\?|$)/.test(url)) return true
  if (url.startsWith('http://') || url.startsWith('https://')) return true
  return false
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { items: {} }
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'))
  } catch {
    return { items: {} }
  }
}

function saveCheckpoint(checkpoint) {
  checkpoint.updatedAt = new Date().toISOString()
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2))
}

async function leerCatalogo() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn('Sin BLOB_READ_WRITE_TOKEN: usando catálogo local de respaldo')
    return JSON.parse(fs.readFileSync(FALLBACK_CATALOGO, 'utf8'))
  }
  try {
    const resultado = await get(BLOB_PATHNAME, { access: 'public', useCache: false })
    if (!resultado || resultado.statusCode !== 200) {
      console.warn('Blob sin catálogo, usando respaldo local')
      return JSON.parse(fs.readFileSync(FALLBACK_CATALOGO, 'utf8'))
    }
    return await new Response(resultado.stream).json()
  } catch (err) {
    console.warn('Error leyendo Blob, usando respaldo local:', err.message)
    return JSON.parse(fs.readFileSync(FALLBACK_CATALOGO, 'utf8'))
  }
}

// Como leerCatalogo(), pero sin fallback silencioso: si Blob no responde,
// lanza un error. Para usar en herramientas que van a ESCRIBIR de vuelta el
// catálogo (como revisar-candidatos.js), donde operar sobre el catálogo de
// respaldo por error podría pisar datos reales en producción.
async function leerCatalogoEstricto() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Falta BLOB_READ_WRITE_TOKEN')
  }
  const resultado = await get(BLOB_PATHNAME, { access: 'public', useCache: false })
  if (!resultado || resultado.statusCode !== 200) {
    throw new Error(`Blob respondió statusCode=${resultado && resultado.statusCode}`)
  }
  return await new Response(resultado.stream).json()
}

async function guardarCatalogo(productos) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Falta BLOB_READ_WRITE_TOKEN para guardar el catálogo')
  }
  await put(BLOB_PATHNAME, JSON.stringify(productos), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

// --- Imágenes como archivos del repo (en vez de Blob) -----------------------
//
// data/imagenes-asignadas.json es un mapa simple { id: "/imagenes-productos/id.webp" }
// que se commitea a git junto con los archivos .webp en imagenes-productos/.
// api/catalogo.js lo usa para "pisar" el campo imagen de cada producto encima
// de lo que traiga el catálogo (Blob o de respaldo), así las fotos no
// dependen de la cuota de Blob para nada.
function cargarImagenesAsignadas() {
  if (!fs.existsSync(IMAGENES_ASIGNADAS_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(IMAGENES_ASIGNADAS_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function guardarImagenesAsignadas(asignadas) {
  fs.mkdirSync(path.dirname(IMAGENES_ASIGNADAS_PATH), { recursive: true })
  fs.writeFileSync(IMAGENES_ASIGNADAS_PATH, JSON.stringify(asignadas, null, 2))
}

// Aplica el mapa de imágenes asignadas encima de una lista de productos
// (muta y devuelve la misma lista, por comodidad).
function aplicarImagenesAsignadas(productos, asignadas) {
  const mapa = asignadas || cargarImagenesAsignadas()
  for (const p of productos) {
    if (mapa[p.id]) p.imagen = mapa[p.id]
  }
  return productos
}

// Guarda el webp final en imagenes-productos/<id>.webp (archivo del repo) y
// actualiza data/imagenes-asignadas.json. Devuelve la ruta pública relativa.
function guardarImagenComoArchivo(id, webpBuffer) {
  fs.mkdirSync(IMAGENES_PRODUCTOS_DIR, { recursive: true })
  const archivo = `${id}.webp`
  fs.writeFileSync(path.join(IMAGENES_PRODUCTOS_DIR, archivo), webpBuffer)
  const rutaPublica = `/imagenes-productos/${archivo}`
  const asignadas = cargarImagenesAsignadas()
  asignadas[id] = rutaPublica
  guardarImagenesAsignadas(asignadas)
  return rutaPublica
}

function pythonBin() {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function buscarImagenesDdg(query) {
  const proc = spawnSync(pythonBin(), [DDG_SCRIPT, query, '15'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 45_000,
  })
  if (proc.error) throw new Error(`ddg spawn: ${proc.error.message}`)
  const stderr = (proc.stderr || '').trim()
  const stdout = (proc.stdout || '').trim()
  if (proc.status !== 0) {
    throw new Error(stderr || stdout || `ddg exit ${proc.status}`)
  }
  let data
  try {
    data = JSON.parse(stdout)
  } catch {
    throw new Error(`ddg JSON inválido: ${stdout.slice(0, 200)}`)
  }
  if (data && data.error) throw new Error(`ddg: ${data.error}`)
  return Array.isArray(data) ? data : []
}

async function buscarImagenesSerpapi(query) {
  const key = process.env.SERPAPI_API_KEY
  if (!key) throw new Error('Falta SERPAPI_API_KEY')

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google_images')
  url.searchParams.set('q', query)
  url.searchParams.set('hl', 'es')
  url.searchParams.set('gl', 'ar')
  url.searchParams.set('ijn', '0')
  url.searchParams.set('licenses', 'fmc')
  url.searchParams.set('api_key', key)

  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SerpAPI HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  if (data.error) throw new Error(`SerpAPI: ${data.error}`)
  return Array.isArray(data.images_results) ? data.images_results : []
}

async function buscarImagenes(query, engine) {
  if (engine === 'serpapi') return buscarImagenesSerpapi(query)
  return buscarImagenesDdg(query)
}

// Dominios que en la práctica devuelven fotos de stock/redes/contenido genérico
// (no fotos de producto de librería). Ver data/enrich-imagenes-checkpoint.json
// para casos reales descartados: alamy (foto con copyright de banco de
// imágenes), google/gstatic (logos), reddit/pinterest/flickr (fotos random de
// usuarios), sitios de turismo/moda/recetas, etc.
const DOMINIOS_BLOQUEADOS = [
  'alamy.com',
  'gettyimages.com',
  'shutterstock.com',
  'istockphoto.com',
  'dreamstime.com',
  '123rf.com',
  'depositphotos.com',
  'stock.adobe.com',
  'redd.it',
  'reddit.com',
  'pinterest.',
  'pinimg.com',
  'staticflickr.com',
  'flickr.com',
  'wikipedia.org',
  'wikimedia.org',
  'google.com',
  'gstatic.com',
  'facebook.com',
  'fbcdn.net',
  'instagram.com',
  'cdninstagram.com',
  'tiktok.com',
  'themodestman.com',
  'imdb.com',
  // Sitios de contenido adulto / citas / streaming de video genérico (nunca
  // van a tener una foto de producto de librería, y filtrar por dominio es
  // más confiable que por palabra clave).
  'xvideos.com',
  'xnxx.com',
  'pornhub.com',
  'xhamster.com',
  'redtube.com',
  'youporn.com',
  'onlyfans.com',
  'chaturbate.com',
  'motherless.com',
  'thumbzilla.com',
  'spankbang.com',
  'eporner.com',
  'tnaflix.com',
  'youjizz.com',
  'txxx.com',
  'tube8.com',
  'rule34.',
  'e-hentai.org',
  'nhentai.net',
  'deviantart.com',
  'imagefap.com',
  'fapello.',
  'coomer.',
  'kemono.',
  'erome.com',
  'bing.com', // suele devolver thumbnails/miniaturas de bing, no la foto real
]

// Palabras en el título del resultado que delatan que la imagen no es de un
// producto de librería (personas, lugares, comida, mapas, contenido adulto,
// etc.). Se compara en minúsculas contra el título del resultado.
const PALABRAS_NEGATIVAS_TITULO = [
  'actriz', 'actor', 'actress', 'model', 'modelo', 'bikini', 'beach', 'playa',
  'island', 'isla', 'map of', 'mapa de', 'weather', 'clima', 'recipe', 'receta',
  'stuffed pepper', 'pimiento relleno', 'movie', 'película', 'film still',
  'wallpaper', 'landscape', 'paisaje', 'sunset', 'atardecer', 'logo de google',
  'google logo',
  // Contenido adulto / sexual explícito o insinuado — se descarta cualquier
  // resultado cuyo título contenga estas palabras, sin excepción.
  'porn', 'porno', 'xxx', 'sex', 'sexo', 'sexy', 'nude', 'desnud', 'naked',
  'erotic', 'erótic', 'erotico', 'nsfw', 'hentai', 'onlyfans', 'fetish',
  'fetiche', 'stripper', 'strip tease', 'lingerie', 'lencería', 'escort',
  'webcam girl', 'cam girl', 'adult video', 'adult content', 'milf', 'teen sex',
  'hot girl', 'hot babe', 'nipple', 'boob', 'ass ', 'culo', 'tetas', 'vagina',
  'penis', 'pene', 'orgasm', 'masturbat', 'gangbang', 'threesome', 'anal',
]

function dominioBloqueado(url) {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return DOMINIOS_BLOQUEADOS.some((d) => host.includes(d))
}

function tituloSospechoso(title) {
  const t = String(title || '').toLowerCase()
  return PALABRAS_NEGATIVAS_TITULO.some((p) => t.includes(p))
}

function candidatoUsable(item) {
  const original = item.original || item.thumbnail
  if (!original || typeof original !== 'string') return null
  if (!/^https?:\/\//i.test(original)) return null
  if (dominioBloqueado(original)) return null
  if (tituloSospechoso(item.title)) return null
  const w = Number(item.original_width || item.width || 0)
  const h = Number(item.original_height || item.height || 0)
  if (w > 0 && h > 0 && (w < MIN_SIDE || h < MIN_SIDE)) return null
  const lower = original.toLowerCase()
  if (lower.includes('logo') && w > 0 && w < 200) return null
  return original
}

async function descargarImagenDetallada(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < MIN_IMAGE_BYTES) throw new Error(`Imagen demasiado chica (${buf.length} bytes)`)
  return { buffer: buf, contentType: res.headers.get('content-type') || '' }
}

async function descargarImagen(url) {
  return (await descargarImagenDetallada(url)).buffer
}

// Variantes de búsqueda en cascada. Probado a mano contra el motor real: los
// resultados son bastante ruidosos y agregar SIEMPRE una coletilla tipo
// "papelería producto" no mejora la relevancia de forma consistente (a veces
// ayuda, a veces la empeora — el motor no es determinístico). Por eso se
// prueban variantes de distinta especificidad y se junta lo que sirva de
// cada una; el filtro de dominios/palabras de abajo (no la query) es la
// defensa real contra resultados inapropiados o irrelevantes.
function construirVariantesQuery(producto, categoria) {
  const marca = detectarMarca(producto, categoria)
  const nombre = limpiarNombre(producto)
  const cat = categoria ? String(categoria).split('/')[0].trim() : ''
  const variantes = []
  if (marca) variantes.push([marca.label, nombre].filter(Boolean).join(' '))
  variantes.push([nombre, cat].filter(Boolean).join(' '))
  variantes.push([nombre, 'papelería'].filter(Boolean).join(' '))
  variantes.push(nombre)
  const vistos = new Set()
  return variantes
    .map((v) => v.replace(/\s+/g, ' ').trim())
    .filter((v) => v && !vistos.has(v) && vistos.add(v))
}

async function recolectarCandidatos(producto, categoria, opts) {
  const { engine, maxCandidatos, delayEntreQueriesMs } = opts
  const variantes = construirVariantesQuery(producto, categoria)
  const vistos = new Set()
  const candidatos = []
  for (let i = 0; i < variantes.length; i++) {
    if (candidatos.length >= maxCandidatos) break
    const query = variantes[i]
    let resultados = []
    try {
      resultados = await buscarImagenes(query, engine)
    } catch (err) {
      candidatos.errorUltimaQuery = err.message
      continue
    }
    for (const item of resultados) {
      const url = candidatoUsable(item)
      if (!url || vistos.has(url)) continue
      vistos.add(url)
      candidatos.push({ url, title: item.title || '', query })
      if (candidatos.length >= maxCandidatos) break
    }
    if (i < variantes.length - 1) {
      await new Promise((r) => setTimeout(r, delayEntreQueriesMs || 1200))
    }
  }
  return candidatos
}

async function optimizar(buffer) {
  return sharp(buffer)
    .resize(TAMANO, TAMANO, { fit: 'cover' })
    .webp({ quality: 75 })
    .toBuffer()
}

async function subirImagen(id, webpBuffer) {
  const blob = await put(`imagenes/${id}.webp`, webpBuffer, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'image/webp',
  })
  return `${blob.url}?v=${Date.now()}`
}

async function procesarProducto(producto, opts) {
  const query = buildQuery(producto.producto, producto.categoria)
  const resultados = await buscarImagenes(query, opts.engine)

  let sourceUrl = null
  for (const item of resultados) {
    const url = candidatoUsable(item)
    if (url) {
      sourceUrl = url
      break
    }
  }
  if (!sourceUrl) {
    return { status: 'fail', reason: 'sin_candidato', query }
  }

  if (opts.dryRun) {
    return { status: 'dry-run', query, sourceUrl }
  }

  let lastErr = null
  const urls = []
  for (const item of resultados) {
    const url = candidatoUsable(item)
    if (url && !urls.includes(url)) urls.push(url)
    if (urls.length >= 4) break
  }

  for (const url of urls) {
    try {
      const raw = await descargarImagen(url)
      const webp = await optimizar(raw)
      const imagenUrl = await subirImagen(producto.id, webp)
      return { status: 'ok', query, sourceUrl: url, imagen: imagenUrl }
    } catch (err) {
      lastErr = err
    }
  }
  return {
    status: 'fail',
    reason: lastErr ? lastErr.message : 'download_fail',
    query,
    sourceUrl: urls[0] || null,
  }
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

  if (opts.engine === 'serpapi' && !process.env.SERPAPI_API_KEY) {
    console.error('Falta SERPAPI_API_KEY (o usá --engine ddg, el default gratis)')
    process.exit(1)
  }
  if (opts.engine === 'ddg' && !fs.existsSync(VENV_PYTHON)) {
    console.error(
      'Falta .venv-enrich. Corré:\n  python3 -m venv .venv-enrich && .venv-enrich/bin/pip install ddgs'
    )
    process.exit(1)
  }
  if (!opts.dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Falta BLOB_READ_WRITE_TOKEN (necesario salvo --dry-run)')
    process.exit(1)
  }

  const productos = await leerCatalogo()
  const byId = new Map(productos.map((p) => [p.id, p]))
  const checkpoint = opts.resume ? loadCheckpoint() : { items: {} }
  if (!checkpoint.items) checkpoint.items = {}

  const pendientes = []
  for (const p of productos) {
    const prev = checkpoint.items[p.id]
    if (opts.resume && prev && (prev.status === 'ok' || prev.status === 'skip')) continue
    if (opts.onlyMissing && tieneImagenProducto(p)) {
      checkpoint.items[p.id] = {
        status: 'skip',
        reason: 'ya_tiene_imagen',
        at: new Date().toISOString(),
      }
      continue
    }
    pendientes.push(p)
  }

  const lote = opts.limit != null ? pendientes.slice(0, opts.limit) : pendientes
  console.log(
    `Catálogo: ${productos.length} | pendientes: ${pendientes.length} | esta corrida: ${lote.length}` +
      ` | engine=${opts.engine}` +
      (opts.dryRun ? ' [dry-run]' : '')
  )

  let ok = 0
  let fail = 0
  let dry = 0
  let sinceSave = 0
  const delayMs = opts.engine === 'ddg' ? DELAY_MS_DDG : DELAY_MS_SERPAPI

  for (let i = 0; i < lote.length; i++) {
    const p = lote[i]
    const marca = detectarMarca(p.producto, p.categoria)
    process.stdout.write(
      `[${i + 1}/${lote.length}] ${p.id.slice(0, 60)}… marca=${marca ? marca.id : '-'} `
    )
    try {
      const result = await procesarProducto(p, opts)
      if (result.status === 'ok') {
        ok++
        sinceSave++
        p.imagen = result.imagen
        byId.set(p.id, p)
        checkpoint.items[p.id] = {
          status: 'ok',
          query: result.query,
          sourceUrl: result.sourceUrl,
          imagen: result.imagen,
          at: new Date().toISOString(),
        }
        console.log('OK')
        if (!opts.dryRun && sinceSave >= opts.saveEvery) {
          await guardarCatalogo(productos)
          saveCheckpoint(checkpoint)
          sinceSave = 0
          console.log('  → catálogo guardado en Blob')
        }
      } else if (result.status === 'dry-run') {
        dry++
        checkpoint.items[p.id] = {
          status: 'dry-run',
          query: result.query,
          sourceUrl: result.sourceUrl,
          at: new Date().toISOString(),
        }
        console.log(`DRY ${result.sourceUrl}`)
      } else {
        fail++
        checkpoint.items[p.id] = {
          status: 'fail',
          reason: result.reason,
          query: result.query,
          sourceUrl: result.sourceUrl || null,
          at: new Date().toISOString(),
        }
        console.log(`FAIL ${result.reason}`)
      }
    } catch (err) {
      fail++
      checkpoint.items[p.id] = {
        status: 'fail',
        reason: err.message,
        at: new Date().toISOString(),
      }
      console.log(`FAIL ${err.message}`)
    }
    saveCheckpoint(checkpoint)
    await new Promise((r) => setTimeout(r, delayMs))
  }

  if (!opts.dryRun && sinceSave > 0) {
    await guardarCatalogo(productos)
    console.log('Catálogo final guardado en Blob')
  }
  saveCheckpoint(checkpoint)

  console.log(`Listo. ok=${ok} fail=${fail} dry-run=${dry} checkpoint=${CHECKPOINT_PATH}`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = {
  buildQuery,
  limpiarNombre,
  detectarMarca: require('./marcas').detectarMarca,
  tieneImagenProducto,
  parseArgs,
  loadEnvFiles,
  leerCatalogo,
  leerCatalogoEstricto,
  guardarCatalogo,
  buscarImagenes,
  candidatoUsable,
  construirVariantesQuery,
  recolectarCandidatos,
  descargarImagen,
  descargarImagenDetallada,
  optimizar,
  subirImagen,
  BLOB_PATHNAME,
  cargarImagenesAsignadas,
  guardarImagenesAsignadas,
  aplicarImagenesAsignadas,
  guardarImagenComoArchivo,
  IMAGENES_ASIGNADAS_PATH,
  IMAGENES_PRODUCTOS_DIR,
}
