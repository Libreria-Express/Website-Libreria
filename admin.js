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

  function mostrar(vista) {
    vistaCargando.hidden = vista !== 'cargando'
    vistaLogin.hidden = vista !== 'login'
    vistaPanel.hidden = vista !== 'panel'
  }

  async function cargarMetaCatalogo() {
    try {
      const respuesta = await fetch('/api/catalogo', { cache: 'no-store' })
      const data = await respuesta.json()
      const total = data.productos ? data.productos.length : 0
      if (data.fuente === 'admin' && data.actualizado) {
        const fecha = new Date(data.actualizado).toLocaleString('es-AR')
        panelMeta.textContent = total + ' productos publicados · última actualización ' + fecha
      } else {
        panelMeta.textContent = total + ' productos (catálogo inicial, todavía no se subió un Excel)'
      }
    } catch (err) {
      panelMeta.textContent = 'No se pudo leer el estado del catálogo.'
    }
  }

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
