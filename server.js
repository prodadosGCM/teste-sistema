require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
const PROD = process.env.NODE_ENV === 'production';
if (!SECRET || SECRET.length < 32) {
  console.error('Defina JWT_SECRET (32+ caracteres) no arquivo .env');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null } },
  hsts: PROD
}));
app.use(express.json({ limit: '50kb' }));
app.use((req, _res, next) => { req.body = req.body || {}; next(); });
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

/* ---------- utilidades ---------- */
const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const agora = () => new Date().toISOString();
const OC_STATUS = ['Aberta', 'Em andamento', 'Encerrada'];
const VTR_STATUS = ['Disponível', 'Em serviço', 'Manutenção', 'Baixada'];
const EQP_STATUS = ['Disponível', 'Em uso', 'Manutenção', 'Extraviado'];
const TURNOS = ['Diurno 07h–19h', 'Noturno 19h–07h', 'Administrativo 08h–17h'];

function auth(req, res, next) {
  try {
    const p = jwt.verify(req.cookies.token, SECRET);
    const u = db.prepare('SELECT id,matricula,nome,perfil,ativo FROM users WHERE id=?').get(p.id);
    if (!u || !u.ativo) throw new Error('inválido');
    req.user = u;
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  }
}
const admin = (req, res, next) =>
  req.user.perfil === 'admin' ? next() : res.status(403).json({ erro: 'Acesso restrito ao administrador.' });

const bad = (res, msg) => res.status(400).json({ erro: msg });

/* ---------- autenticação ---------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' }
});
// hash falso para manter o tempo de resposta igual quando a matrícula não existe
const FAKE_HASH = bcrypt.hashSync('nao-existe', 12);

app.post('/api/login', loginLimiter, (req, res) => {
  const matricula = clean(req.body.matricula, 40);
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
  const u = db.prepare('SELECT * FROM users WHERE matricula=?').get(matricula);
  const ok = bcrypt.compareSync(senha, u ? u.senha_hash : FAKE_HASH);
  if (!u || !ok || !u.ativo) return res.status(401).json({ erro: 'Matrícula ou senha incorretas.' });
  const token = jwt.sign({ id: u.id }, SECRET, { expiresIn: '12h' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 12 * 3600 * 1000 });
  res.json({ id: u.id, nome: u.nome, perfil: u.perfil, matricula: u.matricula });
});
app.post('/api/logout', (_req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(req.user));

app.post('/api/me/senha', auth, (req, res) => {
  const atual = req.body.atual, nova = req.body.nova;
  if (typeof nova !== 'string' || nova.length < 8) return bad(res, 'A nova senha precisa ter 8 caracteres ou mais.');
  const u = db.prepare('SELECT senha_hash FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(atual || ''), u.senha_hash)) return bad(res, 'A senha atual está incorreta.');
  db.prepare('UPDATE users SET senha_hash=? WHERE id=?').run(bcrypt.hashSync(nova, 12), req.user.id);
  res.json({ ok: true });
});

/* ---------- ocorrências ---------- */
app.get('/api/ocorrencias', auth, (_req, res) => {
  res.json(db.prepare(`SELECT o.*, u.nome AS agente FROM ocorrencias o
    JOIN users u ON u.id=o.agente_id ORDER BY o.id DESC LIMIT 200`).all());
});
app.post('/api/ocorrencias', auth, (req, res) => {
  const tipo = clean(req.body.tipo, 80), local = clean(req.body.local, 200), descricao = clean(req.body.descricao, 3000);
  if (!tipo || !local || !descricao) return bad(res, 'Preencha tipo, local e descrição.');
  const r = db.prepare('INSERT INTO ocorrencias(tipo,local,descricao,agente_id,criado_em) VALUES (?,?,?,?,?)')
    .run(tipo, local, descricao, req.user.id, agora());
  const protocolo = `GCM-${new Date().getFullYear()}-${String(r.lastInsertRowid).padStart(5, '0')}`;
  db.prepare('UPDATE ocorrencias SET protocolo=? WHERE id=?').run(protocolo, r.lastInsertRowid);
  res.status(201).json({ id: r.lastInsertRowid, protocolo });
});
app.patch('/api/ocorrencias/:id', auth, (req, res) => {
  const o = db.prepare('SELECT * FROM ocorrencias WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ erro: 'Ocorrência não encontrada.' });
  if (req.user.perfil !== 'admin' && o.agente_id !== req.user.id)
    return res.status(403).json({ erro: 'Só o autor ou o administrador pode alterar.' });
  if (!OC_STATUS.includes(req.body.status)) return bad(res, 'Status inválido.');
  db.prepare('UPDATE ocorrencias SET status=? WHERE id=?').run(req.body.status, o.id);
  res.json({ ok: true });
});

/* ---------- ponto ---------- */
app.get('/api/ponto', auth, (req, res) => {
  const todos = req.query.todos === '1' && req.user.perfil === 'admin';
  const base = 'SELECT p.*, u.nome FROM ponto p JOIN users u ON u.id=p.agente_id';
  res.json(todos
    ? db.prepare(`${base} ORDER BY p.id DESC LIMIT 100`).all()
    : db.prepare(`${base} WHERE p.agente_id=? ORDER BY p.id DESC LIMIT 60`).all(req.user.id));
});
app.post('/api/ponto', auth, (req, res) => {
  const last = db.prepare('SELECT tipo, registrado_em FROM ponto WHERE agente_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (last && Date.now() - new Date(last.registrado_em).getTime() < 20000)
    return res.status(429).json({ erro: 'Ponto já registrado agora há pouco.' });
  const tipo = last && last.tipo === 'entrada' ? 'saida' : 'entrada';
  db.prepare('INSERT INTO ponto(agente_id,tipo,registrado_em) VALUES (?,?,?)').run(req.user.id, tipo, agora());
  res.status(201).json({ tipo });
});

/* ---------- escala ---------- */
app.get('/api/escalas', auth, (req, res) => {
  const hoje = new Date().toISOString().slice(0, 10);
  const base = 'SELECT e.*, u.nome FROM escalas e JOIN users u ON u.id=e.agente_id WHERE e.data>=?';
  res.json(req.user.perfil === 'admin'
    ? db.prepare(`${base} ORDER BY e.data, e.turno LIMIT 200`).all(hoje)
    : db.prepare(`${base} AND e.agente_id=? ORDER BY e.data, e.turno LIMIT 100`).all(hoje, req.user.id));
});
app.post('/api/escalas', auth, admin, (req, res) => {
  const { agente_id, data, turno } = req.body, posto = clean(req.body.posto, 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) return bad(res, 'Informe uma data válida.');
  if (!TURNOS.includes(turno)) return bad(res, 'Turno inválido.');
  if (!posto) return bad(res, 'Informe o posto ou local do serviço.');
  if (!db.prepare('SELECT 1 FROM users WHERE id=? AND ativo=1').get(agente_id)) return bad(res, 'Agente inválido.');
  db.prepare('INSERT INTO escalas(agente_id,data,turno,posto) VALUES (?,?,?,?)').run(agente_id, data, turno, posto);
  res.status(201).json({ ok: true });
});
app.delete('/api/escalas/:id', auth, admin, (req, res) => {
  db.prepare('DELETE FROM escalas WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- viaturas ---------- */
app.get('/api/viaturas', auth, (_req, res) => res.json(db.prepare('SELECT * FROM viaturas ORDER BY prefixo').all()));
app.post('/api/viaturas', auth, admin, (req, res) => {
  const prefixo = clean(req.body.prefixo, 30);
  if (!prefixo) return bad(res, 'Informe o prefixo da viatura.');
  try {
    db.prepare('INSERT INTO viaturas(prefixo,placa,modelo,km) VALUES (?,?,?,?)')
      .run(prefixo, clean(req.body.placa, 12), clean(req.body.modelo, 60), Math.max(0, parseInt(req.body.km, 10) || 0));
  } catch { return bad(res, 'Já existe uma viatura com esse prefixo.'); }
  res.status(201).json({ ok: true });
});
app.patch('/api/viaturas/:id', auth, (req, res) => {
  const v = db.prepare('SELECT * FROM viaturas WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ erro: 'Viatura não encontrada.' });
  const status = req.body.status === undefined ? v.status : req.body.status;
  const km = req.body.km === undefined ? v.km : parseInt(req.body.km, 10);
  if (!VTR_STATUS.includes(status)) return bad(res, 'Status inválido.');
  if (!Number.isInteger(km) || km < v.km) return bad(res, 'O km não pode ser menor que o atual.');
  db.prepare('UPDATE viaturas SET status=?, km=? WHERE id=?').run(status, km, v.id);
  res.json({ ok: true });
});

/* ---------- equipamentos ---------- */
app.get('/api/equipamentos', auth, (_req, res) => {
  res.json(db.prepare(`SELECT q.*, u.nome AS responsavel FROM equipamentos q
    LEFT JOIN users u ON u.id=q.responsavel_id ORDER BY q.descricao`).all());
});
app.post('/api/equipamentos', auth, admin, (req, res) => {
  const descricao = clean(req.body.descricao, 120);
  if (!descricao) return bad(res, 'Informe a descrição do equipamento.');
  db.prepare('INSERT INTO equipamentos(descricao,patrimonio) VALUES (?,?)').run(descricao, clean(req.body.patrimonio, 40));
  res.status(201).json({ ok: true });
});
app.patch('/api/equipamentos/:id', auth, (req, res) => {
  if (!EQP_STATUS.includes(req.body.status)) return bad(res, 'Status inválido.');
  const resp = req.body.status === 'Em uso' ? req.user.id : null;
  const r = db.prepare('UPDATE equipamentos SET status=?, responsavel_id=? WHERE id=?').run(req.body.status, resp, req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  res.json({ ok: true });
});

/* ---------- equipe (admin) ---------- */
app.get('/api/users', auth, admin, (_req, res) => {
  res.json(db.prepare('SELECT id,matricula,nome,perfil,ativo FROM users ORDER BY nome').all());
});
app.post('/api/users', auth, admin, (req, res) => {
  const matricula = clean(req.body.matricula, 40), nome = clean(req.body.nome, 100), senha = req.body.senha;
  if (!matricula || !nome) return bad(res, 'Informe matrícula e nome.');
  if (typeof senha !== 'string' || senha.length < 8) return bad(res, 'A senha inicial precisa ter 8 caracteres ou mais.');
  try {
    db.prepare('INSERT INTO users(matricula,nome,senha_hash,perfil,criado_em) VALUES (?,?,?,?,?)')
      .run(matricula, nome, bcrypt.hashSync(senha, 12), req.body.perfil === 'admin' ? 'admin' : 'agente', agora());
  } catch { return bad(res, 'Essa matrícula já está cadastrada.'); }
  res.status(201).json({ ok: true });
});
app.patch('/api/users/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  if (req.body.ativo !== undefined) {
    if (id === req.user.id) return bad(res, 'Você não pode desativar a própria conta.');
    db.prepare('UPDATE users SET ativo=? WHERE id=?').run(req.body.ativo ? 1 : 0, id);
  }
  if (req.body.senha !== undefined) {
    if (typeof req.body.senha !== 'string' || req.body.senha.length < 8) return bad(res, 'A senha precisa ter 8 caracteres ou mais.');
    db.prepare('UPDATE users SET senha_hash=? WHERE id=?').run(bcrypt.hashSync(req.body.senha, 12), id);
  }
  res.json({ ok: true });
});

app.get('/api/opcoes', auth, (_req, res) => res.json({ OC_STATUS, VTR_STATUS, EQP_STATUS, TURNOS }));

app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ erro: 'Erro interno. Tente novamente.' }); });

app.listen(PORT, '127.0.0.1', () => console.log(`GCM Cabo Frio rodando em http://127.0.0.1:${PORT}`));
