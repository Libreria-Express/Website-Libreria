// Descarta la foto de uno o varios productos (revisión manual de imágenes
// agregadas automáticamente). Deja al producto sin imagen: vuelve a mostrarse
// como pendiente para /admin (sección 3) o para una futura pasada del script
// de enriquecimiento.
const { del, put, get } = require('@vercel/blob')
const fallback = require('../data/catalogo-inicial.json')
const { BLOB_PATHNAME } = require('./_catalogo')
const { isAuthenticated } = require('./_auth')
const { quitarImagenesAsignadasGitHub } = require('./_github')

const MAX_IDS = 500

async function catalogoActual() {
  try {
    const resultado = await get(BLOB_PATHNAME, { access: 'public', useCache: false })
    if (!resultado || resultado.statusCode !== 200) return fallback
    return await new Response(resultado.stream).json()
  } catch (err) {
    return fallback
  }
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

  const { ids } = req.body || {}
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === 'string')) {
    res.status(400).json({ error: 'Falta la lista de ids a descartar' })
    return
  }
  if (ids.length > MAX_IDS) {
    res.status(400).json({ error: `Máximo ${MAX_IDS} por vez` })
    return
  }

  // Las fotos "reales" están commiteadas en data/imagenes-asignadas.json (vía
  // GitHub), no en el catálogo de Blob: hay que quitarlas de ahí o van a
  // seguir apareciendo por el merge que hace api/catalogo.js.
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
    try {
      await quitarImagenesAsignadasGitHub(ids, `imagenes: descartar foto de ${ids.join(', ')} (desde admin)`)
    } catch (err) {
      res.status(502).json({ error: 'No se pudo actualizar GitHub: ' + err.message })
      return
    }
  }

  let descartados = ids.length

  // Compatibilidad con el esquema viejo (imagen guardada directo en el
  // catálogo de Blob / Vercel Blob): si está configurado, se limpia también,
  // pero ya no es la fuente principal de las fotos.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const idsSet = new Set(ids)
    const productos = await catalogoActual()
    descartados = 0
    const actualizados = productos.map((p) => {
      if (!idsSet.has(p.id) || !p.imagen) return p
      descartados++
      const { imagen, ...resto } = p
      return resto
    })

    await Promise.all(
      ids.map((id) =>
        del(`imagenes/${id}.webp`).catch(() => {
          /* puede no existir o ya haber sido borrado; no es un error para el usuario */
        })
      )
    )

    await put(BLOB_PATHNAME, JSON.stringify(actualizados), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
  }

  res.status(200).json({ ok: true, descartados })
}
