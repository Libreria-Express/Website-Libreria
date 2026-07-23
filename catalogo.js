// Librería Express — Catálogo, búsqueda, pedido y envío por WhatsApp
;(function () {
  const WHATSAPP = '5493816090957'
  const CART_KEY = 'le_pedido_v1'
  const MONTO_MINIMO = 80000

  function trackearEvento(nombre, datos) {
    if (typeof window.fbq === 'function') window.fbq('track', nombre, datos)
  }

  function trackearEventoCustom(nombre, datos) {
    if (typeof window.fbq === 'function') window.fbq('trackCustom', nombre, datos)
  }

  const els = {
    buscador: document.getElementById('buscador-input'),
    filtroCat: document.getElementById('filtro-cat'),
    filtroCatBtn: document.getElementById('filtro-cat-btn'),
    filtroCatLabel: document.getElementById('filtro-cat-label'),
    filtroCatPanel: document.getElementById('filtro-cat-panel'),
    filtroCatBuscar: document.getElementById('filtro-cat-buscar'),
    filtroCatLimpiar: document.getElementById('filtro-cat-limpiar'),
    filtroCatCerrar: document.getElementById('filtro-cat-cerrar'),
    filtroCatLista: document.getElementById('filtro-cat-lista'),
    filtroCatChips: document.getElementById('filtro-cat-chips'),
    meta: document.getElementById('catalogo-meta'),
    lista: document.getElementById('catalogo-lista'),
    btnAbrirPedido: document.getElementById('btn-abrir-pedido'),
    pedidoBadge: document.getElementById('pedido-badge'),
    overlay: document.getElementById('pedido-overlay'),
    panel: document.getElementById('pedido-panel'),
    btnCerrarPedido: document.getElementById('btn-cerrar-pedido'),
    pedidoLista: document.getElementById('pedido-lista'),
    pedidoTotal: document.getElementById('pedido-total'),
    pedidoMinimoAviso: document.getElementById('pedido-minimo-aviso'),
    btnEnviarPedido: document.getElementById('btn-enviar-pedido'),
    btnVaciarPedido: document.getElementById('btn-vaciar-pedido'),
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightbox-img'),
    lightboxNombre: document.getElementById('lightbox-nombre'),
    btnCerrarLightbox: document.getElementById('btn-cerrar-lightbox'),
  }

  const moneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
  const formatPrecio = (n) => moneda.format(n)

  function formatoLegible(str) {
    const s = String(str).toLowerCase()
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  function normalizar(str) {
    const normalizado = String(str).normalize('NFD')
    let out = ''
    for (const ch of normalizado) {
      const code = ch.codePointAt(0)
      if (code >= 0x0300 && code <= 0x036f) continue
      out += ch
    }
    return out.toLowerCase()
  }

  // productos: [{id, categoria, producto, precio}]
  // filas: [{id, categoria, precioTexto, elItem, elGrupo, normalizado}]
  let productos = []
  let filas = []
  let cart = cargarCarrito()
  const categoriasSeleccionadas = new Set()

  function cargarCarrito() {
    try {
      const raw = localStorage.getItem(CART_KEY)
      const data = raw ? JSON.parse(raw) : {}
      return data && typeof data === 'object' ? data : {}
    } catch (err) {
      return {}
    }
  }

  function guardarCarrito() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart))
    } catch (err) {
      /* localStorage no disponible: el pedido no persiste entre visitas */
    }
  }

  async function cargarCatalogo() {
    try {
      const respuesta = await fetch('/api/catalogo', { cache: 'no-store' })
      if (!respuesta.ok) throw new Error('respuesta no ok')
      const data = await respuesta.json()
      return data.productos || []
    } catch (err) {
      const respuestaFallback = await fetch('data/catalogo-inicial.json')
      return respuestaFallback.json()
    }
  }

  function poblarCategorias() {
    const categorias = [...new Set(productos.map((p) => p.categoria))]
    const frag = document.createDocumentFragment()
    categorias.forEach((cat) => {
      const li = document.createElement('li')
      li.dataset.normalizado = normalizar(cat)
      li.innerHTML =
        '<label>' +
        '<input type="checkbox" value="' + escapeHtml(cat) + '">' +
        escapeHtml(formatoLegible(cat)) +
        '</label>'
      frag.appendChild(li)
    })
    els.filtroCatLista.appendChild(frag)
  }

  function actualizarLabelFiltroCat() {
    const n = categoriasSeleccionadas.size
    if (n === 0) {
      els.filtroCatLabel.textContent = 'Todas las categorías'
    } else if (n === 1) {
      els.filtroCatLabel.textContent = formatoLegible([...categoriasSeleccionadas][0])
    } else {
      els.filtroCatLabel.textContent = n + ' categorías seleccionadas'
    }
  }

  function renderChipsCategorias() {
    if (!categoriasSeleccionadas.size) {
      els.filtroCatChips.hidden = true
      els.filtroCatChips.innerHTML = ''
      return
    }
    els.filtroCatChips.hidden = false
    els.filtroCatChips.innerHTML =
      [...categoriasSeleccionadas].map((cat) =>
        '<span class="chip-cat" data-cat="' + escapeHtml(cat) + '">' +
        escapeHtml(formatoLegible(cat)) +
        '<button type="button" aria-label="Quitar categoría ' + escapeHtml(formatoLegible(cat)) + '">×</button>' +
        '</span>'
      ).join('') +
      '<button type="button" class="chip-cat-limpiar" id="chip-cat-limpiar-todo">Limpiar todo</button>'
  }

  function quitarCategoriaSeleccionada(cat) {
    categoriasSeleccionadas.delete(cat)
    const checkbox = els.filtroCatLista.querySelector('input[type="checkbox"][value="' + CSS.escape(cat) + '"]')
    if (checkbox) checkbox.checked = false
    actualizarLabelFiltroCat()
    renderChipsCategorias()
    aplicarFiltro()
  }

  function limpiarCategoriasSeleccionadas() {
    categoriasSeleccionadas.clear()
    els.filtroCatLista.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false })
    actualizarLabelFiltroCat()
    renderChipsCategorias()
    aplicarFiltro()
  }

  function abrirPanelCategorias() {
    els.filtroCat.classList.add('activo')
    els.filtroCatPanel.hidden = false
    els.filtroCatBtn.setAttribute('aria-expanded', 'true')
  }

  function cerrarPanelCategorias() {
    els.filtroCat.classList.remove('activo')
    els.filtroCatPanel.hidden = true
    els.filtroCatBtn.setAttribute('aria-expanded', 'false')
  }

  function filtrarListaCategorias() {
    const q = normalizar(els.filtroCatBuscar.value.trim())
    let visibles = 0
    els.filtroCatLista.querySelectorAll('li').forEach((li) => {
      const visible = !q || li.dataset.normalizado.includes(q)
      li.classList.toggle('oculto', !visible)
      if (visible) visibles += 1
    })
    let vacio = els.filtroCatLista.querySelector('.filtro-cat__vacio')
    if (visibles === 0) {
      if (!vacio) {
        vacio = document.createElement('li')
        vacio.className = 'filtro-cat__vacio'
        vacio.textContent = 'Sin categorías que coincidan.'
        els.filtroCatLista.appendChild(vacio)
      }
    } else if (vacio) {
      vacio.remove()
    }
  }

  function renderCatalogo() {
    const grupos = new Map()
    const frag = document.createDocumentFragment()

    productos.forEach((p) => {
      let grupo = grupos.get(p.categoria)
      if (!grupo) {
        const section = document.createElement('section')
        section.className = 'cat-grupo'
        section.dataset.categoria = p.categoria
        section.innerHTML =
          '<h2 class="cat-grupo__titulo">' +
          escapeHtml(formatoLegible(p.categoria)) +
          ' <span class="cat-grupo__count"></span></h2>' +
          '<ul class="cat-grupo__items"></ul>'
        frag.appendChild(section)
        grupo = { section, ul: section.querySelector('.cat-grupo__items'), total: 0, visibles: 0 }
        grupos.set(p.categoria, grupo)
      }

      const foto = p.imagen
        ? '<img class="prod__foto" src="' + escapeHtml(p.imagen) + '" alt="" loading="lazy" decoding="async" />'
        : '<div class="prod__foto prod__foto--vacio" aria-hidden="true"></div>'

      const li = document.createElement('li')
      li.className = 'prod'
      li.dataset.id = p.id
      li.innerHTML =
        foto +
        '<div class="prod__info">' +
        '<p class="prod__nombre">' + escapeHtml(formatoLegible(p.producto)) + '</p>' +
        '<p class="prod__precio">' + formatPrecio(p.precio) + '</p>' +
        '</div>' +
        '<div class="prod__acciones">' +
        '<button type="button" class="prod__agregar">Agregar</button>' +
        '<div class="prod__stepper">' +
        '<button type="button" data-accion="menos" aria-label="Quitar uno"><svg class="ico"><use href="#i-minus"/></svg></button>' +
        '<span>0</span>' +
        '<button type="button" data-accion="mas" aria-label="Agregar uno"><svg class="ico"><use href="#i-plus"/></svg></button>' +
        '</div>' +
        '</div>'

      grupo.ul.appendChild(li)
      grupo.total += 1

      filas.push({
        id: p.id,
        categoria: p.categoria,
        elItem: li,
        elGrupo: grupo.section,
        grupoRef: grupo,
        normalizado: normalizar(p.categoria + ' ' + p.producto),
      })
    })

    grupos.forEach((g) => {
      g.section.querySelector('.cat-grupo__count').textContent = '(' + g.total + ')'
    })

    els.lista.innerHTML = ''
    els.lista.appendChild(frag)
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]))
  }

  function aplicarFiltro() {
    const terminos = normalizar(els.buscador.value.trim()).split(/\s+/).filter(Boolean)
    const conteoPorGrupo = new Map()
    let visibles = 0

    filas.forEach((fila) => {
      const coincideTexto = terminos.every((termino) => fila.normalizado.includes(termino))
      const coincideCategoria = categoriasSeleccionadas.size === 0 || categoriasSeleccionadas.has(fila.categoria)
      const visible = coincideTexto && coincideCategoria
      fila.elItem.classList.toggle('oculto', !visible)
      if (visible) {
        visibles += 1
        conteoPorGrupo.set(fila.elGrupo, (conteoPorGrupo.get(fila.elGrupo) || 0) + 1)
      }
    })

    const gruposVistos = new Set()
    filas.forEach((fila) => {
      if (gruposVistos.has(fila.elGrupo)) return
      gruposVistos.add(fila.elGrupo)
      const visiblesGrupo = conteoPorGrupo.get(fila.elGrupo) || 0
      fila.elGrupo.classList.toggle('oculto', visiblesGrupo === 0)
      const countEl = fila.elGrupo.querySelector('.cat-grupo__count')
      if (countEl) countEl.textContent = '(' + visiblesGrupo + ')'
    })

    els.meta.innerHTML = '<strong>' + visibles + '</strong> de ' + productos.length + ' productos'
    if (visibles === 0) {
      els.meta.innerHTML += ' — no encontramos productos con esa búsqueda.'
    }
  }

  let debounceTimer
  function onBuscar() {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(aplicarFiltro, 120)
  }

  // ===== Carrito =====
  function productoPorId(id) {
    return productos.find((p) => p.id === id)
  }

  function actualizarCantidadEnFila(id) {
    const fila = filas.find((f) => f.id === id)
    if (!fila) return
    const cantidad = cart[id]?.cantidad || 0
    const stepper = fila.elItem.querySelector('.prod__stepper')
    const agregarBtn = fila.elItem.querySelector('.prod__agregar')
    const span = stepper.querySelector('span')
    span.textContent = cantidad
    stepper.classList.toggle('activo', cantidad > 0)
    agregarBtn.classList.toggle('oculto-stepper', cantidad > 0)
  }

  function setCantidad(id, cantidad) {
    const producto = productoPorId(id)
    if (!producto) return
    const cantidadAnterior = cart[id]?.cantidad || 0
    const cantidadFinal = Math.max(0, Math.min(999, cantidad))
    if (cantidadFinal === 0) {
      delete cart[id]
    } else {
      cart[id] = { categoria: producto.categoria, producto: producto.producto, precio: producto.precio, cantidad: cantidadFinal }
    }
    if (cantidadFinal > cantidadAnterior) {
      trackearEvento('AddToCart', {
        content_name: producto.producto,
        content_category: producto.categoria,
        value: producto.precio,
        currency: 'ARS',
      })
    }
    guardarCarrito()
    actualizarCantidadEnFila(id)
    actualizarBadge()
    if (els.panel.classList.contains('activo')) renderPedido()
  }

  function actualizarBadge() {
    const total = Object.values(cart).reduce((acc, item) => acc + item.cantidad, 0)
    els.pedidoBadge.textContent = total
    els.pedidoBadge.hidden = total === 0
  }

  function calcularTotal() {
    return Object.values(cart).reduce((acc, item) => acc + item.cantidad * item.precio, 0)
  }

  function renderPedido() {
    const items = Object.entries(cart)
    if (!items.length) {
      els.pedidoLista.innerHTML = '<p class="pedido-panel__vacio">Todavía no agregaste productos. Buscá en el catálogo y tocá “Agregar”.</p>'
    } else {
      els.pedidoLista.innerHTML = items.map(([id, item]) => (
        '<div class="pedido-item" data-id="' + id + '">' +
        '<div class="pedido-item__info">' +
        '<p class="pedido-item__nombre">' + escapeHtml(formatoLegible(item.producto)) + '</p>' +
        '<p class="pedido-item__precio">' + formatPrecio(item.precio) + ' c/u</p>' +
        '</div>' +
        '<div class="pedido-item__acciones">' +
        '<button type="button" data-accion="menos" aria-label="Quitar uno"><svg class="ico"><use href="#i-minus"/></svg></button>' +
        '<span>' + item.cantidad + '</span>' +
        '<button type="button" data-accion="mas" aria-label="Agregar uno"><svg class="ico"><use href="#i-plus"/></svg></button>' +
        '<button type="button" class="pedido-item__quitar" data-accion="quitar" aria-label="Quitar del pedido"><svg class="ico"><use href="#i-trash"/></svg></button>' +
        '</div></div>'
      )).join('')
    }
    const total = calcularTotal()
    els.pedidoTotal.textContent = formatPrecio(total)

    const alcanzaMinimo = total >= MONTO_MINIMO
    els.btnEnviarPedido.disabled = !items.length || !alcanzaMinimo
    if (items.length && !alcanzaMinimo) {
      els.pedidoMinimoAviso.hidden = false
      els.pedidoMinimoAviso.textContent =
        'Te faltan ' + formatPrecio(MONTO_MINIMO - total) + ' para llegar al mínimo de compra de ' + formatPrecio(MONTO_MINIMO) + '.'
    } else {
      els.pedidoMinimoAviso.hidden = true
    }
  }

  function abrirPedido() {
    renderPedido()
    els.panel.classList.add('activo')
    els.overlay.hidden = false
    requestAnimationFrame(() => els.overlay.classList.add('activo'))
    els.panel.setAttribute('aria-hidden', 'false')
  }

  function cerrarPedido() {
    els.panel.classList.remove('activo')
    els.overlay.classList.remove('activo')
    els.panel.setAttribute('aria-hidden', 'true')
    setTimeout(() => { els.overlay.hidden = true }, 200)
  }

  // ===== Lightbox (ver foto de producto ampliada) =====
  function abrirLightbox(src, nombre) {
    els.lightboxImg.src = src
    els.lightboxImg.alt = nombre
    els.lightboxNombre.textContent = nombre
    els.lightbox.hidden = false
    requestAnimationFrame(() => els.lightbox.classList.add('activo'))
    els.lightbox.setAttribute('aria-hidden', 'false')
  }

  function cerrarLightbox() {
    els.lightbox.classList.remove('activo')
    els.lightbox.setAttribute('aria-hidden', 'true')
    setTimeout(() => {
      els.lightbox.hidden = true
      els.lightboxImg.src = ''
    }, 200)
  }

  function construirMensajeWhatsApp() {
    const items = Object.values(cart)
    const lineas = items.map((item) =>
      '- ' + formatoLegible(item.producto) + ' — x' + item.cantidad + ' (' + formatPrecio(item.precio) + ' c/u)'
    )
    return (
      '*Pedido desde el catálogo web — Librería Express*\n\n' +
      lineas.join('\n') +
      '\n\n———————————\n' +
      'Total estimado: ' + formatPrecio(calcularTotal()) + '\n\n' +
      'Mi nombre / local: '
    )
  }

  function enviarPedidoPorWhatsApp() {
    if (!Object.keys(cart).length) return
    const total = calcularTotal()
    if (total < MONTO_MINIMO) return // el botón ya está deshabilitado; defensa extra
    trackearEvento('Lead', {
      content_name: 'Pedido catálogo web',
      value: total,
      currency: 'ARS',
      num_items: Object.values(cart).reduce((acc, item) => acc + item.cantidad, 0),
    })
    const url = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(construirMensajeWhatsApp())
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function vaciarPedido() {
    if (!Object.keys(cart).length) return
    if (!window.confirm('¿Vaciar todo el pedido?')) return
    cart = {}
    guardarCarrito()
    filas.forEach((f) => actualizarCantidadEnFila(f.id))
    actualizarBadge()
    renderPedido()
  }

  // ===== Eventos =====
  els.lista.addEventListener('click', (e) => {
    const item = e.target.closest('.prod')
    if (!item) return
    const id = item.dataset.id
    const foto = e.target.closest('img.prod__foto')
    if (foto) {
      const producto = productoPorId(id)
      abrirLightbox(foto.src, formatoLegible(producto ? producto.producto : ''))
      return
    }
    if (e.target.closest('.prod__agregar')) {
      setCantidad(id, (cart[id]?.cantidad || 0) + 1)
      return
    }
    const accionBtn = e.target.closest('[data-accion]')
    if (!accionBtn) return
    const actual = cart[id]?.cantidad || 0
    if (accionBtn.dataset.accion === 'mas') setCantidad(id, actual + 1)
    if (accionBtn.dataset.accion === 'menos') setCantidad(id, actual - 1)
  })

  els.pedidoLista.addEventListener('click', (e) => {
    const fila = e.target.closest('.pedido-item')
    if (!fila) return
    const id = fila.dataset.id
    const actual = cart[id]?.cantidad || 0
    const accionBtn = e.target.closest('[data-accion]')
    if (!accionBtn) return
    if (accionBtn.dataset.accion === 'mas') setCantidad(id, actual + 1)
    if (accionBtn.dataset.accion === 'menos') setCantidad(id, actual - 1)
    if (accionBtn.dataset.accion === 'quitar') setCantidad(id, 0)
  })

  els.buscador.addEventListener('input', onBuscar)

  els.filtroCatBtn.addEventListener('click', () => {
    if (els.filtroCatPanel.hidden) {
      abrirPanelCategorias()
      els.filtroCatBuscar.focus()
    } else {
      cerrarPanelCategorias()
    }
  })

  els.filtroCatLista.addEventListener('change', (e) => {
    const checkbox = e.target.closest('input[type="checkbox"]')
    if (!checkbox) return
    if (checkbox.checked) categoriasSeleccionadas.add(checkbox.value)
    else categoriasSeleccionadas.delete(checkbox.value)
    actualizarLabelFiltroCat()
    renderChipsCategorias()
    aplicarFiltro()
  })

  els.filtroCatBuscar.addEventListener('input', filtrarListaCategorias)

  els.filtroCatLimpiar.addEventListener('click', limpiarCategoriasSeleccionadas)
  els.filtroCatCerrar.addEventListener('click', cerrarPanelCategorias)

  els.filtroCatChips.addEventListener('click', (e) => {
    if (e.target.closest('#chip-cat-limpiar-todo')) {
      limpiarCategoriasSeleccionadas()
      return
    }
    const chip = e.target.closest('.chip-cat')
    if (chip && e.target.closest('button')) quitarCategoriaSeleccionada(chip.dataset.cat)
  })

  document.addEventListener('click', (e) => {
    if (!els.filtroCat.contains(e.target)) cerrarPanelCategorias()
  })

  els.btnAbrirPedido.addEventListener('click', abrirPedido)
  els.btnCerrarPedido.addEventListener('click', cerrarPedido)
  els.overlay.addEventListener('click', cerrarPedido)
  els.btnEnviarPedido.addEventListener('click', enviarPedidoPorWhatsApp)
  els.btnVaciarPedido.addEventListener('click', vaciarPedido)
  els.btnCerrarLightbox.addEventListener('click', cerrarLightbox)
  els.lightbox.addEventListener('click', (e) => {
    if (e.target === els.lightbox) cerrarLightbox()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (els.lightbox.classList.contains('activo')) { cerrarLightbox(); return }
    if (els.panel.classList.contains('activo')) cerrarPedido()
    if (!els.filtroCatPanel.hidden) cerrarPanelCategorias()
  })

  document.querySelectorAll('[data-ventana]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault()
      trackearEventoCustom('VerUbicacion', { pagina: 'catalogo' })
      window.open(a.href, 'libreria_express_ubicacion', 'width=900,height=700,noopener,noreferrer')
    })
  })

  async function init() {
    productos = await cargarCatalogo()
    poblarCategorias()
    renderCatalogo()
    filas.forEach((f) => actualizarCantidadEnFila(f.id))
    actualizarBadge()
    aplicarFiltro()
    trackearEvento('ViewContent', {
      content_type: 'product_group',
      content_name: 'Catálogo Librería Express',
      content_ids: ['catalogo-completo'],
      num_items: productos.length,
    })
  }

  init()
})()
