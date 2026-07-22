const { get } = require('@vercel/blob')
const fallback = require('../data/catalogo-inicial.json')
const { BLOB_PATHNAME, aplicarImagenesAsignadas } = require('./_catalogo')

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(200).json({ productos: aplicarImagenesAsignadas(fallback), actualizado: null, fuente: 'inicial' })
    return
  }

  try {
    const resultado = await get(BLOB_PATHNAME, { access: 'public', useCache: false })
    if (!resultado || resultado.statusCode !== 200) {
      res.status(200).json({ productos: aplicarImagenesAsignadas(fallback), actualizado: null, fuente: 'inicial' })
      return
    }
    const productos = await new Response(resultado.stream).json()
    res.status(200).json({ productos: aplicarImagenesAsignadas(productos), actualizado: resultado.blob.uploadedAt, fuente: 'admin' })
  } catch (err) {
    res.status(200).json({
      productos: aplicarImagenesAsignadas(fallback),
      actualizado: null,
      fuente: 'inicial',
      aviso: 'No se pudo leer el catálogo actualizado, se muestra el catálogo inicial.',
    })
  }
}
