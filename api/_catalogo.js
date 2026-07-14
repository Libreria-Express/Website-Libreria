// Utilidades compartidas por las funciones que leen/escriben el catálogo.
const BLOB_PATHNAME = 'catalogo/catalogo.json'
const COLUMNAS = ['Categoria', 'Producto', 'Precio']

function slugify(str) {
  const normalized = String(str).normalize('NFD')
  let out = ''
  for (const ch of normalized) {
    const code = ch.codePointAt(0)
    if (code >= 0x0300 && code <= 0x036f) continue
    out += ch
  }
  return out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function normalizarTexto(str) {
  return String(str).trim().replace(/\s+/g, ' ')
}

function parsePrice(value) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return NaN
  // Saca símbolos de moneda y espacios (ej. "20422,50 €"), y convierte el
  // formato AR (miles con "." y decimales con ",") a número.
  const soloNumero = value.replace(/[^0-9,.-]/g, '').trim()
  if (!soloNumero) return NaN
  return Number(soloNumero.replace(/\./g, '').replace(',', '.'))
}

// Detecta la plantilla simple (una hoja con encabezados Categoria/Producto/Precio).
function esPlantillaSimple(filas) {
  return filas.slice(0, 10).some((fila) => {
    const valores = fila.map((c) => String(c).trim().toLowerCase())
    return valores.includes('categoria') && valores.includes('producto') && valores.includes('precio')
  })
}

// Parsea el export "crudo" del sistema interno: filas agrupadas por familia,
// con una fila de encabezado por categoría que contiene la palabra "Precio"
// en la columna donde efectivamente está el precio de cada artículo debajo.
function parseFilasPorFamilia(filas) {
  const productos = []
  const descartadas = []
  let categoria = null
  let columnaPrecio = null

  filas.forEach((fila, idx) => {
    const nombre = normalizarTexto(fila[0] || '')
    if (!nombre) return // fila en blanco (separador visual del export)
    if (/^art[ií]culos por familia$/i.test(nombre)) return // salto de página del export

    const idxPrecio = fila.findIndex((c) => String(c).trim() === 'Precio')
    if (idxPrecio !== -1) {
      categoria = nombre
      columnaPrecio = idxPrecio
      return
    }

    if (!categoria || columnaPrecio == null) {
      descartadas.push({ fila: idx + 1, motivo: 'Fila fuera de una categoría reconocida' })
      return
    }

    const precio = parsePrice(String(fila[columnaPrecio] ?? ''))
    if (!Number.isFinite(precio) || precio <= 0) {
      descartadas.push({ fila: idx + 1, motivo: 'Precio faltante o inválido para "' + nombre + '"' })
      return
    }

    productos.push({ categoria, producto: nombre, precio })
  })

  return { productos, descartadas }
}

function withIds(productos) {
  const seen = new Map()
  return productos.map((p) => {
    const base = slugify(`${p.categoria}-${p.producto}`)
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    return { ...p, id: n ? `${base}-${n}` : base }
  })
}

module.exports = {
  BLOB_PATHNAME,
  COLUMNAS,
  slugify,
  parsePrice,
  normalizarTexto,
  withIds,
  esPlantillaSimple,
  parseFilasPorFamilia,
}
