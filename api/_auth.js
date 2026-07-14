// Autenticación mínima para /admin: una sola contraseña (ADMIN_PASSWORD) y una
// cookie de sesión firmada con HMAC (ADMIN_SESSION_SECRET). Sin dependencias
// externas ni base de datos de sesiones.
const crypto = require('crypto')

const COOKIE_NAME = 'le_admin'
const SESSION_HOURS = 12

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) throw new Error('Falta configurar ADMIN_SESSION_SECRET')
  return secret
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function createSessionCookie() {
  const expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000
  const payload = String(expires)
  const value = `${payload}.${sign(payload)}`
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=')
    if (idx === -1) return
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim())
  })
  return out
}

function isAuthenticated(req) {
  const value = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (!value) return false
  const [payload, sig] = value.split('.')
  if (!payload || !sig) return false
  if (!safeEqual(sig, sign(payload))) return false
  return Number(payload) > Date.now()
}

module.exports = { createSessionCookie, clearSessionCookie, isAuthenticated, safeEqual }
