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

// Conserva la imagen de un producto entre actualizaciones de precios: si el
// Excel trae una ImagenURL para esa fila, esa gana; si no, se mantiene la que
// ya estaba publicada para ese mismo id.
function fusionarImagenes(productosNuevos, catalogoActual) {
  const imagenesActuales = new Map(
    (catalogoActual || []).filter((p) => p.imagen).map((p) => [p.id, p.imagen])
  )
  return productosNuevos.map((p) => {
    if (p.imagen) return p
    const imagenPrevia = imagenesActuales.get(p.id)
    return imagenPrevia ? { ...p, imagen: imagenPrevia } : p
  })
}

// Mapa { id: "/imagenes-productos/id.webp" } commiteado a git. Es la fuente
// de verdad para las fotos de producto (no Blob): tanto el flujo de revisión
// local (scripts/revisar-candidatos.js) como el admin en producción
// (api/admin-imagen.js, vía GitHub API) escriben acá. Cada deploy nuevo
// re-empaqueta este JSON, así que siempre refleja el último commit.
let imagenesAsignadas = {}
try {
  imagenesAsignadas = require('../data/imagenes-asignadas.json')
} catch {
  imagenesAsignadas = {}
}

// Pisa el campo `imagen` de cada producto con lo que haya en
// data/imagenes-asignadas.json, si existe una entrada para ese id. Se aplica
// SIEMPRE encima del catálogo (venga de Blob o del respaldo local), para que
// las fotos no dependan de Blob para nada.
function aplicarImagenesAsignadas(productos) {
  if (!imagenesAsignadas || !Object.keys(imagenesAsignadas).length) return productos
  return productos.map((p) => (imagenesAsignadas[p.id] ? { ...p, imagen: imagenesAsignadas[p.id] } : p))
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
  fusionarImagenes,
  aplicarImagenesAsignadas,
}
