const { isAuthenticated } = require('./_auth')

module.exports = async function handler(req, res) {
  res.status(200).json({ autenticado: isAuthenticated(req) })
}
