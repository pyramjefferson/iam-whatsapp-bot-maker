require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD === 'change-this-to-a-long-password') {
  console.warn('WARNING: Set a strong ADMIN_PASSWORD in .env before exposing this app to the internet.');
}
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'bots.json');
let bots = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : [];
const runtime = new Map();
const tokens = new Map();
function saveBots() { fs.writeFileSync(DB_FILE, JSON.stringify(bots, null, 2)); }
function safeBot(bot) {
  const rt = runtime.get(bot.id);
  return { id: bot.id, name: bot.name, status: rt?.status || 'disconnected', qr: rt?.qr || null, commands: bot.commands || [] };
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !tokens.has(token)) return res.status(401).json({ error: 'Tanpri konekte an premye.' });
  next();
}
app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD || req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Modpas la pa bon.' });
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, Date.now());
  res.json({ token });
});
app.post('/api/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  tokens.delete(token); res.json({ ok: true });
});
app.get('/api/bots', auth, (req, res) => res.json(bots.map(safeBot)));
app.post('/api/bots', auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Mete yon non pou bot la.' });
  if (bots.length >= 10) return res.status(400).json({ error: 'Vèsyon demo sa a limite a 10 bot.' });
  const bot = { id: crypto.randomUUID(), name, commands: [
    { trigger: '.ping', reply: 'Pong! 🇭🇹' },
    { trigger: '.menu', reply: '🤖 IAM BOT MENU\n.ping — teste bot la\n.menu — wè kòmand yo' }
  ] };
  bots.push(bot); saveBots(); runtime.set(bot.id, { status: 'disconnected', qr: null, sock: null, starting: false });
  res.json(safeBot(bot));
});
app.delete('/api/bots/:id', auth, async (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot pa jwenn.' });
  const rt = runtime.get(bot.id);
  try { rt?.sock?.end(undefined); } catch {}
  runtime.delete(bot.id); bots = bots.filter(b => b.id !== bot.id); saveBots();
  fs.rmSync(path.join(SESSIONS_DIR, bot.id), { recursive: true, force: true });
  res.json({ ok: true });
});
app.post('/api/bots/:id/connect', auth, async (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot pa jwenn.' });
  try { await startBot(bot); res.json(safeBot(bot)); }
  catch (e) { res.status(500).json({ error: 'Pa t kapab kòmanse bot la: ' + e.message }); }
});
app.post('/api/bots/:id/disconnect', auth, async (req, res) => {
  const rt = runtime.get(req.params.id);
  if (rt?.sock) { try { rt.sock.end(undefined); } catch {} }
  if (rt) { rt.sock = null; rt.status = 'disconnected'; rt.qr = null; rt.starting = false; }
  res.json({ ok: true });
});
app.put('/api/bots/:id/commands', auth, (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot pa jwenn.' });
  const commands = Array.isArray(req.body.commands) ? req.body.commands : [];
  if (commands.length > 100) return res.status(400).json({ error: 'Maksimòm 100 kòmand pou chak bot nan vèsyon sa a.' });
  for (const c of commands) {
    if (!String(c.trigger || '').trim().startsWith('.') || !String(c.reply || '').trim()) return res.status(400).json({ error: 'Chak kòmand dwe kòmanse ak yon pwen epi gen yon repons.' });
  }
  bot.commands = commands.map(c => ({ trigger: String(c.trigger).trim().toLowerCase().slice(0, 40), reply: String(c.reply).trim().slice(0, 3000) }));
  saveBots(); res.json(safeBot(bot));
});

async function startBot(bot) {
  let rt = runtime.get(bot.id);
  if (!rt) { rt = { status: 'disconnected', qr: null, sock: null, starting: false }; runtime.set(bot.id, rt); }
  if (rt.starting || rt.status === 'connected') return;
  rt.starting = true; rt.status = 'connecting'; rt.qr = null;
  const authDir = path.join(SESSIONS_DIR, bot.id);
  fs.mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, printQRInTerminal: false, browser: ['IAM Bot Maker', 'Chrome', '1.0.0'], markOnlineOnConnect: false });
  rt.sock = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { rt.qr = await QRCode.toDataURL(qr); rt.status = 'qr'; }
    if (connection === 'open') { rt.status = 'connected'; rt.qr = null; rt.starting = false; }
    if (connection === 'close') {
      rt.status = 'disconnected'; rt.qr = null; rt.starting = false; rt.sock = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) setTimeout(() => startBot(bot).catch(console.error), 5000);
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;
      const m = msg.message;
      const text = (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '').trim();
      if (!text) continue;
      const command = (bot.commands || []).find(c => text.toLowerCase() === c.trigger.toLowerCase() || text.toLowerCase().startsWith(c.trigger.toLowerCase() + ' '));
      if (command) {
        try { await sock.sendMessage(msg.key.remoteJid, { text: command.reply }); } catch (e) { console.error('Reply failed:', e.message); }
      }
    }
  });
}

// Recreate runtime entries and restore sessions on startup.
for (const bot of bots) runtime.set(bot.id, { status: 'disconnected', qr: null, sock: null, starting: false });
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'IAM WhatsApp Bot Maker Pro' }));
app.listen(PORT, () => console.log(`IAM Bot Maker running on port ${PORT}`));
