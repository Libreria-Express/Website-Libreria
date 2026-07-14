const XLSX = require('xlsx')
const { put } = require('@vercel/blob')
const { BLOB_PATHNAME, parsePrice, normalizarTexto, withIds, esPlantillaSimple, parseFilasPorFamilia } = require('./_catalogo')
const { isAuthenticated } = require('./_auth')

const MAX_BASE64_LENGTH = 15 * 1024 * 1024 // ~10 MB de archivo original en base64

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'No autenticado' })
    return
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).json({ error: 'Falta configurar el almacenamiento (BLOB_READ_WRITE_TOKEN)' })
    return
  }

  const { base64 } = req.body || {}
  if (!base64 || typeof base64 !== 'string') {
    res.status(400).json({ error: 'Falta el archivo Excel' })
    return
  }
  if (base64.length > MAX_BASE64_LENGTH) {
    res.status(400).json({ error: 'El archivo es demasiado grande' })
    return
  }

  let workbook
  try {
    workbook = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' })
  } catch (err) {
    res.status(400).json({ error: 'No se pudo leer el archivo. ¿Es un Excel (.xlsx) válido?' })
    return
  }

  const hoja = workbook.Sheets[workbook.SheetNames[0]]
  if (!hoja) {
    res.status(400).json({ error: 'El Excel no tiene hojas con datos' })
    return
  }

  const filasCrudas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })
  let productos = []
  let descartadas = []

  if (esPlantillaSimple(filasCrudas)) {
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' })
    filas.forEach((fila, idx) => {
      const categoria = normalizarTexto(fila.Categoria ?? fila.categoria ?? '')
      const producto = normalizarTexto(fila.Producto ?? fila.producto ?? '')
      const precio = parsePrice(fila.Precio ?? fila.precio)

      if (!categoria || !producto || !Number.isFinite(precio) || precio <= 0) {
        descartadas.push({ fila: idx + 2, motivo: 'Falta categoría/producto o el precio no es válido' })
        return
      }
      productos.push({ categoria, producto, precio })
    })
  } else {
    // Export "crudo" del sistema interno: filas agrupadas por familia.
    const resultado = parseFilasPorFamilia(filasCrudas)
    productos = resultado.productos
    descartadas = resultado.descartadas
  }

  if (!productos.length) {
    res.status(400).json({
      error: 'El Excel no tiene filas válidas. Verificá que tenga las columnas Categoria, Producto y Precio.',
    })
    return
  }

  await put(BLOB_PATHNAME, JSON.stringify(withIds(productos)), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })

  res.status(200).json({ ok: true, importados: productos.length, descartadas })
}
