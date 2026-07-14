// Librería Express — interacción mínima (formularios → WhatsApp)
// El número de la empresa y el envío del mensaje prellenado por WhatsApp.

const WHATSAPP = '5493816090957'

function abrirWhatsApp(mensaje) {
  const url = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(mensaje)
  window.open(url, '_blank', 'noopener,noreferrer')
}

// --- Formulario: Cotización Corporativa ---
const formCorp = document.getElementById('form-corp')
if (formCorp) {
  formCorp.addEventListener('submit', function (e) {
    e.preventDefault()
    const d = new FormData(formCorp)
    const msg =
      '*Solicitud de Cotización Corporativa — Cuentas Pymes*\n\n' +
      'Empresa: ' + (d.get('empresa') || '') + '\n' +
      'Contacto: ' + (d.get('contacto') || '') + '\n' +
      'Empleados aprox.: ' + (d.get('empleados') || '') + '\n' +
      'Insumos habituales: ' + (d.get('insumos') || '(a definir)')
    abrirWhatsApp(msg)
  })
}

// --- Formulario: Mensaje Directo ---
const formMsg = document.getElementById('form-msg')
if (formMsg) {
  formMsg.addEventListener('submit', function (e) {
    e.preventDefault()
    const d = new FormData(formMsg)
    const msg =
      '*Mensaje Directo desde la web*\n\n' +
      'Nombre: ' + (d.get('nombre') || '') + '\n' +
      'Teléfono: ' + (d.get('telefono') || '(no indicado)') + '\n' +
      'Consulta: ' + (d.get('ayuda') || '')
    abrirWhatsApp(msg)
  })
}

// --- Cerrar el menú móvil al hacer clic en un enlace ---
const menuToggle = document.getElementById('menu-toggle')
if (menuToggle) {
  document.querySelectorAll('.nav__links a').forEach(function (a) {
    a.addEventListener('click', function () {
      menuToggle.checked = false
    })
  })
}
