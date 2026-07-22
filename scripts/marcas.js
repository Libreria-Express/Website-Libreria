/**
 * Detección de marca a partir del nombre de producto / categoría.
 * Orden: marcas más específicas / largas primero para evitar falsos positivos.
 */

const MARCAS = [
  { id: 'faber-castell', label: 'Faber-Castell', patterns: ['faber-castell', 'faber castell', 'fabercastell', 'faber'] },
  { id: 'paper-mate', label: 'Paper Mate', patterns: ['paper mate', 'papermate'] },
  { id: 'uni-ball', label: 'Uni-ball', patterns: ['uni-ball', 'uniball'] },
  { id: 'skycolor', label: 'Skycolor', patterns: ['skycolor', 'sky color'] },
  { id: 'playcolor', label: 'Playcolor', patterns: ['playcolor', 'play color'] },
  { id: 'crayonina', label: 'Crayonina', patterns: ['crayonina'] },
  { id: 'mooving', label: 'Mooving', patterns: ['mooving'] },
  { id: 'simball', label: 'Simball', patterns: ['simball'] },
  { id: 'pelikan', label: 'Pelikan', patterns: ['pelikan'] },
  { id: 'pizzini', label: 'Pizzini', patterns: ['pizzini'] },
  { id: 'chamex', label: 'Chamex', patterns: ['chamex'] },
  { id: 'canson', label: 'Canson', patterns: ['canson'] },
  { id: 'giotto', label: 'Giotto', patterns: ['giotto'] },
  { id: 'edding', label: 'Edding', patterns: ['edding'] },
  { id: 'stabilo', label: 'Stabilo', patterns: ['stabilo'] },
  { id: 'sharpie', label: 'Sharpie', patterns: ['sharpie'] },
  { id: 'filgo', label: 'Filgo', patterns: ['filgo'] },
  { id: 'maped', label: 'Maped', patterns: ['maped'] },
  { id: 'koby', label: 'Koby', patterns: ['koby'] },
  { id: 'olami', label: 'Olami', patterns: ['olami'] },
  { id: 'trabi', label: 'Trabi', patterns: ['trabi'] },
  { id: 'ezco', label: 'Ezco', patterns: ['ezco'] },
  { id: 'adix', label: 'Adix', patterns: ['adix'] },
  { id: 'artel', label: 'Artel', patterns: ['artel'] },
  { id: 'pilot', label: 'Pilot', patterns: ['pilot'] },
  { id: 'pentel', label: 'Pentel', patterns: ['pentel'] },
  { id: 'bic', label: 'Bic', patterns: ['bic'] },
]

function normalizar(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * @param {string} producto
 * @param {string} [categoria]
 * @returns {{ id: string, label: string } | null}
 */
function detectarMarca(producto, categoria) {
  const texto = normalizar(`${producto || ''} ${categoria || ''}`)
  for (const marca of MARCAS) {
    for (const pattern of marca.patterns) {
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(pattern)}(?:[^a-z0-9]|$)`, 'i')
      if (re.test(texto)) {
        return { id: marca.id, label: marca.label }
      }
    }
  }
  return null
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = { MARCAS, detectarMarca, normalizar }
