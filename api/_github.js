// Helper para commitear archivos directamente al repo de GitHub desde una
// función serverless, usando la Contents API (REST). Así el admin panel en
// producción puede "subir" una imagen sin pasar por Vercel Blob: el archivo
// queda commiteado en el repo, lo que dispara un redeploy automático en
// Vercel (si el proyecto está conectado a ese repo/rama).
//
// Requiere las env vars:
//   GITHUB_TOKEN  -> personal access token con permiso "contents: write"
//                     sobre el repo (fine-grained) o scope "repo" (classic)
//   GITHUB_REPO   -> "owner/nombre-repo", ej "Libreria-Express/Website-Libreria"
//   GITHUB_BRANCH -> opcional, default "main"

const GITHUB_API = 'https://api.github.com'

function config() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH || 'main'
  if (!token) throw new Error('Falta GITHUB_TOKEN')
  if (!repo || !repo.includes('/')) throw new Error('Falta GITHUB_REPO (formato "owner/repo")')
  return { token, repo, branch }
}

async function githubFetch(path, opts = {}) {
  const { token } = config()
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'libreria-express-admin',
      ...(opts.headers || {}),
    },
  })
  return res
}

// Lee un archivo del repo. Devuelve { contenido: Buffer, sha, texto } o null si no existe.
async function leerArchivoGitHub(rutaRepo) {
  const { repo, branch } = config()
  const res = await githubFetch(`/repos/${repo}/contents/${encodeURI(rutaRepo)}?ref=${encodeURIComponent(branch)}`)
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub GET ${rutaRepo} -> HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const contenido = Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8')
  return { contenido, sha: data.sha, texto: contenido.toString('utf8') }
}

// Crea o actualiza un archivo del repo con un solo commit. `contenido` puede
// ser Buffer (binario) o string (texto, se sube tal cual en utf-8).
async function escribirArchivoGitHub(rutaRepo, contenido, mensaje, shaPrevio) {
  const { repo, branch } = config()
  const buffer = Buffer.isBuffer(contenido) ? contenido : Buffer.from(String(contenido), 'utf8')
  const res = await githubFetch(`/repos/${repo}/contents/${encodeURI(rutaRepo)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: mensaje,
      content: buffer.toString('base64'),
      branch,
      ...(shaPrevio ? { sha: shaPrevio } : {}),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub PUT ${rutaRepo} -> HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// Actualiza data/imagenes-asignadas.json: lee el estado actual desde GitHub
// (no desde el bundle local, que puede estar desactualizado), agrega/pisa la
// entrada `id -> rutaPublica`, y lo commitea de vuelta.
async function actualizarImagenAsignadaGitHub(id, rutaPublica, mensaje) {
  const ruta = 'data/imagenes-asignadas.json'
  const actual = await leerArchivoGitHub(ruta)
  let mapa = {}
  if (actual) {
    try {
      mapa = JSON.parse(actual.texto)
    } catch {
      mapa = {}
    }
  }
  mapa[id] = rutaPublica
  const texto = JSON.stringify(mapa, null, 2)
  return escribirArchivoGitHub(ruta, texto, mensaje, actual ? actual.sha : undefined)
}

// Sube (o reemplaza) el archivo de imagen imagenes-productos/<id>.webp.
async function subirImagenGitHub(id, webpBuffer, mensaje) {
  const ruta = `imagenes-productos/${id}.webp`
  const actual = await leerArchivoGitHub(ruta).catch(() => null)
  await escribirArchivoGitHub(ruta, webpBuffer, mensaje, actual ? actual.sha : undefined)
  return `/imagenes-productos/${id}.webp`
}

// Quita entradas del mapa de imágenes asignadas (usado al "descartar" una
// foto desde el admin). No borra el archivo .webp del repo (no hace falta:
// si no está en el mapa, no se usa; queda como archivo huérfano sin costo).
async function quitarImagenesAsignadasGitHub(ids, mensaje) {
  const ruta = 'data/imagenes-asignadas.json'
  const actual = await leerArchivoGitHub(ruta)
  if (!actual) return null
  let mapa = {}
  try {
    mapa = JSON.parse(actual.texto)
  } catch {
    mapa = {}
  }
  let cambios = 0
  for (const id of ids) {
    if (mapa[id] !== undefined) {
      delete mapa[id]
      cambios++
    }
  }
  if (!cambios) return null
  const texto = JSON.stringify(mapa, null, 2)
  return escribirArchivoGitHub(ruta, texto, mensaje, actual.sha)
}

module.exports = {
  leerArchivoGitHub,
  escribirArchivoGitHub,
  actualizarImagenAsignadaGitHub,
  subirImagenGitHub,
  quitarImagenesAsignadasGitHub,
}
