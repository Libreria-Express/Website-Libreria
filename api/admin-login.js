const { createSessionCookie, safeEqual } = require('./_auth')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    res.status(500).json({ error: 'ADMIN_PASSWORD no está configurada en Vercel' })
    return
  }

  const { password } = req.body || {}
  if (typeof password !== 'string' || !password || !safeEqual(password, expected)) {
    res.status(401).json({ error: 'Contraseña incorrecta' })
    return
  }

  res.setHeader('Set-Cookie', createSessionCookie())
  res.status(200).json({ ok: true })
}
