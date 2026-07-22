// Librería Express — Panel de administración (login + subir/bajar Excel)
;(function () {
  const vistaCargando = document.getElementById('vista-cargando')
  const vistaLogin = document.getElementById('vista-login')
  const vistaPanel = document.getElementById('vista-panel')
  const formLogin = document.getElementById('form-login')
  const loginError = document.getElementById('login-error')
  const btnLogout = document.getElementById('btn-logout')
  const panelMeta = document.getElementById('panel-meta')
  const inputExcel = document.getElementById('input-excel')
  const btnSubir = document.getElementById('btn-subir')
  const resultadoSubida = document.getElementById('resultado-subida')
  const imagenBuscar = document.getElementById('imagen-buscar')
  const imagenLista = document.getElementById('imagen-lista')
  const imagenSoloSinFoto = document.getElementById('imagen-solo-sin-foto')
  const imagenSinFotoTotal = document.getElementById('imagen-sin-foto-total')
  const imagenPaginado = document.getElementById('imagen-paginado')
  const imagenAnterior = document.getElementById('imagen-anterior')
  const imagenSiguiente = document.getElementById('imagen-siguiente')
  const imagenPaginaSpan = document.getElementById('imagen-pagina')
  const btnRevisionCargar = document.getElementById('btn-revision-cargar')
  const revisionContador = document.getElementById('revision-contador')
  const revisionGrid = document.getElementById('revision-grid')
  const revisionPaginado = document.getElementById('revision-paginado')
  const revisionAnterior = document.getElementById('revision-anterior')
  const revisionSiguiente = document.getElementById('revision-siguiente')
  const revisionPagina = document.getElementById('revision-pagina')
  const revisionAcciones = document.getElementById('revision-acciones')
  const btnRevisionDescartar = document.getElementById('btn-revision-descartar')
  const revisionSeleccionCount = document.getElementById('revision-seleccion-count')
  const revisionEstado = document.getElementById('revision-estado')

  let productosCatalogo = []
  const IMAGEN_POR_PAGINA = 25
  let imagenPaginaActual = 0
  const REVISION_POR_PAGINA = 60
  let revisionProductos = []
  let revisionPaginaActual = 0
  const revisionSeleccionados = new Set()

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

  function mostrar(vista) {
    vistaCargando.hidden = vista !== 'cargando'
    vistaLogin.hidden = vista !== 'login'
    vistaPanel.hidden = vista !== 'panel'
  }

  async function cargarMetaCatalogo() {
    try {
      const respuesta = await fetch('/api/catalogo', { cache: 'no-store' })
      const data = await respuesta.json()
      productosCatalogo = data.productos || []
      const total = productosCatalogo.length
      if (data.fuente === 'admin' && data.actualizado) {
        const fecha = new Date(data.actualizado).toLocaleString('es-AR')
        panelMeta.textContent = total + ' productos publicados · última actualización ' + fecha
      } else {
        panelMeta.textContent = total + ' productos (catálogo inicial, todavía no se subió un Excel)'
      }
      actualizarTotalSinFoto()
      renderResultadosImagenes()
    } catch (err) {
      panelMeta.textContent = 'No se pudo leer el estado del catálogo.'
    }
  }

  function formatoLegible(str) {
    const s = String(str).toLowerCase()
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  const moneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
  function formatPrecio(n) {
    return Number.isFinite(n) ? moneda.format(n) : '—'
  }

  function actualizarTotalSinFoto() {
    const sinFoto = productosCatalogo.filter((p) => !p.imagen).length
    imagenSinFotoTotal.textContent = String(sinFoto)
  }

  function renderItemsImagenes(resultados) {
    imagenLista.innerHTML = resultados.map((p) => (
      '<li class="admin-imagenes__item" data-id="' + escapeHtml(p.id) + '">' +
      '<img class="admin-imagenes__foto" src="' + (p.imagen ? escapeHtml(p.imagen) : 'favicon.svg') + '" alt="" />' +
      '<div class="admin-imagenes__info">' +
      '<p class="admin-imagenes__nombre">' + escapeHtml(formatoLegible(p.producto)) + '</p>' +
      '<p class="admin-imagenes__categoria">' + escapeHtml(formatoLegible(p.categoria)) +
        ' · <span class="admin-imagenes__precio">' + formatPrecio(p.precio) + '</span></p>' +
      '<p class="admin-imagenes__estado" hidden></p>' +
      '</div>' +
      '<div class="admin-imagenes__accion">' +
      '<input type="file" accept="image/*" aria-label="Subir foto para ' + escapeHtml(formatoLegible(p.producto)) + '" />' +
      '<div class="admin-imagenes__url">' +
      '<input type="url" placeholder="o pegá una URL de imagen…" aria-label="URL de imagen para ' + escapeHtml(formatoLegible(p.producto)) + '" />' +
      '<button type="button" class="admin-imagenes__url-boton">Usar URL</button>' +
      '</div>' +
      '</div>' +
      '</li>'
    )).join('')
  }

  function renderPaginadoImagenes(total) {
    const totalPaginas = Math.max(1, Math.ceil(total / IMAGEN_POR_PAGINA))
    if (totalPaginas <= 1) {
      imagenPaginado.hidden = true
      return
    }
    imagenPaginado.hidden = false
    imagenPaginaSpan.textContent = 'Página ' + (imagenPaginaActual + 1) + ' de ' + totalPaginas
    imagenAnterior.disabled = imagenPaginaActual === 0
    imagenSiguiente.disabled = imagenPaginaActual >= totalPaginas - 1
  }

  function renderResultadosImagenes() {
    const q = normalizar(imagenBuscar.value.trim())
    const soloSinFoto = imagenSoloSinFoto.checked
    const base = soloSinFoto ? productosCatalogo.filter((p) => !p.imagen) : productosCatalogo

    let resultados
    if (!q) {
      if (!soloSinFoto) {
        imagenLista.innerHTML = '<li class="admin-imagenes__vacio">Escribí para buscar un producto.</li>'
        imagenPaginado.hidden = true
        return
      }
      if (!base.length) {
        imagenLista.innerHTML = '<li class="admin-imagenes__vacio">Todos los productos tienen foto.</li>'
        imagenPaginado.hidden = true
        return
      }
      resultados = base
    } else {
      const terminos = q.split(/\s+/).filter(Boolean)
      resultados = base.filter((p) => {
        const texto = normalizar(p.categoria + ' ' + p.producto)
        return terminos.every((t) => texto.includes(t))
      })
      if (!resultados.length) {
        imagenLista.innerHTML = '<li class="admin-imagenes__vacio">No encontramos productos con esa búsqueda.</li>'
        imagenPaginado.hidden = true
        return
      }
    }

    const totalPaginas = Math.max(1, Math.ceil(resultados.length / IMAGEN_POR_PAGINA))
    if (imagenPaginaActual > totalPaginas - 1) imagenPaginaActual = totalPaginas - 1
    const desde = imagenPaginaActual * IMAGEN_POR_PAGINA
    renderItemsImagenes(resultados.slice(desde, desde + IMAGEN_POR_PAGINA))
    renderPaginadoImagenes(resultados.length)
  }

  function iniciarRevision() {
    revisionProductos = productosCatalogo.filter((p) => p.imagen)
    revisionPaginaActual = 0
    revisionSeleccionados.clear()
    revisionContador.textContent = revisionProductos.length + ' fotos para revisar'
    revisionGrid.hidden = false
    revisionPaginado.hidden = false
    revisionAcciones.hidden = false
    renderRevisionPagina()
  }

  function totalPaginasRevision() {
    return Math.max(1, Math.ceil(revisionProductos.length / REVISION_POR_PAGINA))
  }

  function renderRevisionPagina() {
    const total = totalPaginasRevision()
    const desde = revisionPaginaActual * REVISION_POR_PAGINA
    const pagina = revisionProductos.slice(desde, desde + REVISION_POR_PAGINA)

    if (!pagina.length) {
      revisionGrid.innerHTML = '<p class="admin-imagenes__vacio">No quedan fotos para revisar.</p>'
    } else {
      revisionGrid.innerHTML = pagina.map((p) => (
        '<div class="admin-revision__item' + (revisionSeleccionados.has(p.id) ? ' seleccionado' : '') + '" data-id="' + escapeHtml(p.id) + '">' +
        '<input type="checkbox" ' + (revisionSeleccionados.has(p.id) ? 'checked' : '') + ' aria-label="Descartar foto de ' + escapeHtml(formatoLegible(p.producto)) + '" />' +
        '<img src="' + escapeHtml(p.imagen) + '" alt="" loading="lazy" />' +
        '<p class="admin-revision__nombre">' + escapeHtml(formatoLegible(p.producto)) + '</p>' +
        '<p class="admin-revision__categoria">' + escapeHtml(formatoLegible(p.categoria)) + '</p>' +
        '<p class="admin-revision__precio">' + formatPrecio(p.precio) + '</p>' +
        '</div>'
      )).join('')
    }

    revisionPagina.textContent = 'Página ' + (revisionPaginaActual + 1) + ' de ' + total
    revisionAnterior.disabled = revisionPaginaActual === 0
    revisionSiguiente.disabled = revisionPaginaActual >= total - 1
    actualizarContadorSeleccion()
  }

  function actualizarContadorSeleccion() {
    revisionSeleccionCount.textContent = String(revisionSeleccionados.size)
    btnRevisionDescartar.disabled = revisionSeleccionados.size === 0
  }

  btnRevisionCargar.addEventListener('click', iniciarRevision)

  revisionAnterior.addEventListener('click', () => {
    if (revisionPaginaActual === 0) return
    revisionPaginaActual--
    renderRevisionPagina()
  })

  revisionSiguiente.addEventListener('click', () => {
    if (revisionPaginaActual >= totalPaginasRevision() - 1) return
    revisionPaginaActual++
    renderRevisionPagina()
  })

  revisionGrid.addEventListener('click', (e) => {
    const item = e.target.closest('.admin-revision__item')
    if (!item) return
    // Evitar doble toggle cuando el click cae justo sobre el checkbox (ya dispara su propio evento).
    if (e.target.tagName === 'INPUT') return
    const checkbox = item.querySelector('input[type="checkbox"]')
    checkbox.checked = !checkbox.checked
    // bubbles: true es necesario para que el listener delegado en revisionGrid lo reciba.
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
  })

  revisionGrid.addEventListener('change', (e) => {
    const checkbox = e.target.closest('input[type="checkbox"]')
    if (!checkbox) return
    const item = checkbox.closest('.admin-revision__item')
    const id = item.dataset.id
    if (checkbox.checked) {
      revisionSeleccionados.add(id)
      item.classList.add('seleccionado')
    } else {
      revisionSeleccionados.delete(id)
      item.classList.remove('seleccionado')
    }
    actualizarContadorSeleccion()
  })

  btnRevisionDescartar.addEventListener('click', async () => {
    const ids = Array.from(revisionSeleccionados)
    if (!ids.length) return

    btnRevisionDescartar.disabled = true
    revisionEstado.className = 'admin-revision__estado'
    revisionEstado.textContent = 'Descartando…'

    try {
      const respuesta = await fetch('/api/admin-imagen-descartar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const data = await respuesta.json()
      if (!respuesta.ok) {
        revisionEstado.className = 'admin-revision__estado error'
        revisionEstado.textContent = data.error || 'No se pudo descartar'
        btnRevisionDescartar.disabled = false
        return
      }

      const idsSet = new Set(ids)
      productosCatalogo.forEach((p) => {
        if (idsSet.has(p.id)) delete p.imagen
      })
      revisionProductos = revisionProductos.filter((p) => !idsSet.has(p.id))
      revisionSeleccionados.clear()
      revisionContador.textContent = revisionProductos.length + ' fotos para revisar'
      actualizarTotalSinFoto()
      renderResultadosImagenes()
      revisionEstado.className = 'admin-revision__estado ok'
      revisionEstado.textContent = 'Se descartaron ' + data.descartados + ' fotos'

      const total = totalPaginasRevision()
      if (revisionPaginaActual > total - 1) revisionPaginaActual = Math.max(0, total - 1)
      renderRevisionPagina()
    } catch (err) {
      revisionEstado.className = 'admin-revision__estado error'
      revisionEstado.textContent = 'Error de conexión. Probá de nuevo.'
      btnRevisionDescartar.disabled = false
    }
  })

  let debounceImagenBuscar
  imagenBuscar.addEventListener('input', () => {
    imagenPaginaActual = 0
    clearTimeout(debounceImagenBuscar)
    debounceImagenBuscar = setTimeout(renderResultadosImagenes, 150)
  })

  imagenSoloSinFoto.addEventListener('change', () => {
    imagenPaginaActual = 0
    renderResultadosImagenes()
  })

  imagenAnterior.addEventListener('click', () => {
    if (imagenPaginaActual === 0) return
    imagenPaginaActual -= 1
    renderResultadosImagenes()
  })

  imagenSiguiente.addEventListener('click', () => {
    imagenPaginaActual += 1
    renderResultadosImagenes()
  })

  async function subirImagenProducto(li, payload, controles) {
    const id = li.dataset.id
    const estado = li.querySelector('.admin-imagenes__estado')
    const foto = li.querySelector('.admin-imagenes__foto')

    estado.hidden = false
    estado.className = 'admin-imagenes__estado'
    estado.textContent = 'Subiendo…'
    controles.forEach((c) => (c.disabled = true))

    try {
      const respuesta = await fetch('/api/admin-imagen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await respuesta.json()
      if (!respuesta.ok) {
        estado.className = 'admin-imagenes__estado error'
        estado.textContent = data.error || 'No se pudo subir la imagen'
        return
      }
      // La ruta ya es válida, pero recién se va a poder ver una vez que
      // termine el redeploy automático que dispara el commit a GitHub.
      foto.src = data.imagen
      const producto = productosCatalogo.find((p) => p.id === id)
      if (producto) producto.imagen = data.imagen
      actualizarTotalSinFoto()
      estado.className = 'admin-imagenes__estado ok'
      estado.textContent = data.aviso || 'Foto actualizada'
    } catch (err) {
      estado.className = 'admin-imagenes__estado error'
      estado.textContent = 'Error de conexión. Probá de nuevo.'
    } finally {
      controles.forEach((c) => (c.disabled = false))
    }
  }

  imagenLista.addEventListener('change', async (e) => {
    const input = e.target.closest('input[type="file"]')
    if (!input || !input.files.length) return
    const li = input.closest('.admin-imagenes__item')
    try {
      const base64 = await archivoABase64(input.files[0])
      await subirImagenProducto(li, { id: li.dataset.id, base64 }, [input])
    } finally {
      input.value = ''
    }
  })

  imagenLista.addEventListener('click', async (e) => {
    const boton = e.target.closest('.admin-imagenes__url-boton')
    if (!boton) return
    const li = boton.closest('.admin-imagenes__item')
    const input = li.querySelector('.admin-imagenes__url input[type="url"]')
    const url = (input.value || '').trim()
    if (!url) {
      input.focus()
      return
    }
    await subirImagenProducto(li, { id: li.dataset.id, url }, [boton, input])
  })

  async function verificarSesion() {
    try {
      const respuesta = await fetch('/api/admin-check', { cache: 'no-store' })
      const data = await respuesta.json()
      if (data.autenticado) {
        mostrar('panel')
        cargarMetaCatalogo()
      } else {
        mostrar('login')
      }
    } catch (err) {
      mostrar('login')
    }
  }

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault()
    loginError.hidden = true
    const password = new FormData(formLogin).get('password')
    try {
      const respuesta = await fetch('/api/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await respuesta.json()
      if (!respuesta.ok) {
        loginError.textContent = data.error || 'No se pudo iniciar sesión'
        loginError.hidden = false
        return
      }
      formLogin.reset()
      mostrar('panel')
      cargarMetaCatalogo()
    } catch (err) {
      loginError.textContent = 'Error de conexión. Probá de nuevo.'
      loginError.hidden = false
    }
  })

  btnLogout.addEventListener('click', async () => {
    await fetch('/api/admin-logout', { method: 'POST' })
    mostrar('login')
  })

  inputExcel.addEventListener('change', () => {
    btnSubir.disabled = !inputExcel.files.length
    resultadoSubida.innerHTML = ''
  })

  function archivoABase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  btnSubir.addEventListener('click', async () => {
    const file = inputExcel.files[0]
    if (!file) return

    btnSubir.disabled = true
    btnSubir.textContent = 'Subiendo…'
    resultadoSubida.innerHTML = ''

    try {
      const base64 = await archivoABase64(file)
      const respuesta = await fetch('/api/admin-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64 }),
      })
      const data = await respuesta.json()

      if (!respuesta.ok) {
        resultadoSubida.innerHTML = '<p class="error">' + escapeHtml(data.error || 'No se pudo subir el archivo') + '</p>'
        return
      }

      let html = '<p class="ok">Listo: se publicaron ' + data.importados + ' productos.</p>'
      if (data.descartadas && data.descartadas.length) {
        html += '<p>Se descartaron ' + data.descartadas.length + ' filas:</p><ul>' +
          data.descartadas.slice(0, 20).map((d) => '<li>Fila ' + d.fila + ': ' + escapeHtml(d.motivo) + '</li>').join('') +
          '</ul>'
      }
      resultadoSubida.innerHTML = html
      inputExcel.value = ''
      cargarMetaCatalogo()
    } catch (err) {
      resultadoSubida.innerHTML = '<p class="error">Error de conexión. Probá de nuevo.</p>'
    } finally {
      btnSubir.disabled = !inputExcel.files.length
      btnSubir.textContent = 'Subir y actualizar precios'
    }
  })

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]))
  }

  verificarSesion()
})()
