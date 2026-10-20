// Uso: node seed.js <matricula> "<Nome completo>" <senha> [admin|agente]
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const [matricula, nome, senha, perfil = 'admin'] = process.argv.slice(2);
if (!matricula || !nome || !senha || senha.length < 8) {
  console.error('Uso: node seed.js <matricula> "<Nome>" <senha com 8+ caracteres> [admin|agente]');
  process.exit(1);
}
db.prepare('INSERT INTO users(matricula,nome,senha_hash,perfil,criado_em) VALUES (?,?,?,?,?)')
  .run(matricula.trim(), nome.trim(), bcrypt.hashSync(senha, 12), perfil === 'agente' ? 'agente' : 'admin', new Date().toISOString());
console.log(`Usuário ${matricula} criado como ${perfil}.`);
