const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'gcm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricula TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'agente' CHECK (perfil IN ('agente','admin')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ocorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  protocolo TEXT,
  tipo TEXT NOT NULL,
  local TEXT NOT NULL,
  descricao TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Aberta',
  agente_id INTEGER NOT NULL REFERENCES users(id),
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ponto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agente_id INTEGER NOT NULL REFERENCES users(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  registrado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS escalas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agente_id INTEGER NOT NULL REFERENCES users(id),
  data TEXT NOT NULL,
  turno TEXT NOT NULL,
  posto TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS viaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prefixo TEXT NOT NULL UNIQUE,
  placa TEXT,
  modelo TEXT,
  km INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Disponível'
);
CREATE TABLE IF NOT EXISTS equipamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT NOT NULL,
  patrimonio TEXT,
  status TEXT NOT NULL DEFAULT 'Disponível',
  responsavel_id INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_oc_status ON ocorrencias(status);
CREATE INDEX IF NOT EXISTS idx_ponto_agente ON ponto(agente_id, id);
CREATE INDEX IF NOT EXISTS idx_escala_data ON escalas(data);
`);

module.exports = db;
