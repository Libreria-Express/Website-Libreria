// Sube (o reemplaza) la foto de un producto desde el admin panel en
// producción. A diferencia de la versión anterior, NO usa Vercel Blob: la
// imagen final se commitea como archivo del repo (imagenes-productos/<id>.webp)
// y el mapa id -> ruta se guarda en data/imagenes-asignadas.json, ambos vía la
// API de GitHub (ver api/_github.js). Ese commit dispara un redeploy
// automático en Vercel (si el proyecto está conectado a ese repo/rama), así
// que la foto tarda ~30-90s en verse en el sitio: no es instantáneo como Blob,
// pero no depende de su cuota gratuita.
//
// Acepta subir un archivo (`base64`) o pegar una URL de imagen (`url`).
const sharp = require('sharp')
const { get } = require('@vercel/blob')
const fallback = require('../data/catalogo-inicial.json')
const { BLOB_PATHNAME } = require('./_catalogo')
const { isAuthenticated } = require('./_auth')
const { subirImagenGitHub, actualizarImagenAsignadaGitHub } = require('./_github')

const MAX_BASE64_LENGTH = 8 * 1024 * 1024 // ~6 MB de imagen original en base64
const MAX_IMAGEN_DESCARGADA = 12 * 1024 * 1024 // 12 MB tope al descargar una URL
const TAMANO = 320 // miniatura cuadrada, en píxeles
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function catalogoActual() {
  try {
    const resultado = await get(BLOB_PATHNAME, { access: 'public', useCache: false })
    if (!resultado || resultado.statusCode !== 200) return fallback
    return await new Response(resultado.stream).json()
  } catch (err) {
    return fallback
  }
}

async function descargarImagenDesdeUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('URL inválida')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('La URL debe ser http:// o https://')
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${res.status})`)
  const contentType = res.headers.get('content-type') || ''
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error('La URL no apunta a una imagen (content-type: ' + contentType + ')')
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_IMAGEN_DESCARGADA) throw new Error('La imagen descargada es demasiado grande')
  if (buf.length < 500) throw new Error('La imagen descargada es demasiado chica o está vacía')
  return buf
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'No autenticado' })
    return
  }
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    res.status(500).json({ error: 'Falta configurar GITHUB_TOKEN / GITHUB_REPO en las variables de entorno' })
    return
  }

  const { id, base64, url } = req.body || {}
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'Falta el id del producto' })
    return
  }
  if ((!base64 || typeof base64 !== 'string') && (!url || typeof url !== 'string')) {
    res.status(400).json({ error: 'Falta la imagen: subí un archivo o pegá una URL' })
    return
  }
  if (base64 && base64.length > MAX_BASE64_LENGTH) {
    res.status(400).json({ error: 'La imagen es demasiado grande' })
    return
  }

  const productos = await catalogoActual()
  const existe = productos.some((p) => p.id === id)
  if (!existe) {
    res.status(404).json({ error: 'No se encontró un producto con ese id' })
    return
  }

  let bufferOriginal
  try {
    bufferOriginal = base64 ? Buffer.from(base64, 'base64') : await descargarImagenDesdeUrl(url)
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo obtener la imagen' })
    return
  }

  let bufferOptimizado
  try {
    bufferOptimizado = await sharp(bufferOriginal)
      .resize(TAMANO, TAMANO, { fit: 'cover' })
      .webp({ quality: 75 })
      .toBuffer()
  } catch (err) {
    res.status(400).json({ error: 'No se pudo procesar la imagen. ¿Es un archivo de imagen válido?' })
    return
  }

  let rutaPublica
  try {
    const mensaje = `imagenes: actualizar foto de ${id} (desde admin)`
    rutaPublica = await subirImagenGitHub(id, bufferOptimizado, mensaje)
    await actualizarImagenAsignadaGitHub(id, rutaPublica, mensaje)
  } catch (err) {
    res.status(502).json({ error: 'No se pudo guardar en GitHub: ' + err.message })
    return
  }

  res.status(200).json({
    ok: true,
    imagen: rutaPublica,
    aviso: 'Se subió a GitHub. El sitio va a mostrar la foto nueva en 1-2 minutos, cuando termine el redeploy automático.',
  })
}
