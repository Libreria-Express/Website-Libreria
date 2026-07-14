const XLSX = require('xlsx')
const { get } = require('@vercel/blob')
const fallback = require('../data/catalogo-inicial.json')
const { BLOB_PATHNAME, COLUMNAS } = require('./_catalogo')
const { isAuthenticated } = require('./_auth')

async function catalogoActual() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return fallback
  try {
    const resultado = await get(BLOB_PATHNAME, { access: 'public', useCache: false })
    if (!resultado || resultado.statusCode !== 200) return fallback
    return await new Response(resultado.stream).json()
  } catch (err) {
    return fallback
  }
}

module.exports = async function handler(req, res) {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'No autenticado' })
    return
  }

  const productos = await catalogoActual()
  const filas = productos.map((p) => ({
    [COLUMNAS[0]]: p.categoria,
    [COLUMNAS[1]]: p.producto,
    [COLUMNAS[2]]: p.precio,
  }))

  const hoja = XLSX.utils.json_to_sheet(filas, { header: COLUMNAS })
  hoja['!cols'] = [{ wch: 30 }, { wch: 60 }, { wch: 14 }]
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Catálogo')
  const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="catalogo-libreria-express.xlsx"')
  res.status(200).send(buffer)
}
