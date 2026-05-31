require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server: IOServer } = require('socket.io');
const { setIO } = require('./socket');
const { OrefClient } = require('./orefClient');
const { getWhatsAppService } = require('./services/whatsapp.service');
const { processAlert } = require('./services/alert-processor');
const { addPending } = require('./services/sticker.service');
const { prisma } = require('./lib/prisma');

const app = express();
const server = http.createServer(app);
const io = new IOServer(server);
setIO(io);

app.use(express.json({ limit: '10mb' }));

// --- Pages ---
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'login.html'));
});

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'dashboard.html'));
});

app.get('/debug', (_req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'debug.html'));
});

// --- API Routes ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/stickers', require('./routes/stickers'));
app.use('/api/config', require('./routes/config'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/debug', require('./routes/debug'));

// --- Public endpoints (no auth, for monitoring) ---
const orefClient = new OrefClient();

app.get('/api/oref/alerts', (_req, res) => {
  res.json({ alert: orefClient.lastAlert });
});

app.get('/api/status', (_req, res) => {
  res.json(orefClient.getStatus());
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// --- Socket.IO: forward sticker:received to pending queue ---
io.on('connection', (socket) => {
  console.log('[Socket.IO] Client connected');
  socket.on('disconnect', () => console.log('[Socket.IO] Client disconnected'));
});

// Hook io.emit to intercept sticker:received and add to pending queue
const origIOEmit = io.emit;
io.emit = function (event, ...args) {
  if (event === 'sticker:received' && args[0]) {
    addPending(args[0]);
  }
  return origIOEmit.call(this, event, ...args);
};

// --- Start alert polling + processing ---
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);
let lastSavedAlertFingerprint = null;

orefClient.on('alert', (alert) => {
  processAlert(alert).catch((err) =>
    console.error('[AlertProcessor] Error:', err)
  );

  if (alert) {
    const cities = Array.isArray(alert.data) ? alert.data : (alert.data ? String(alert.data).split(',') : []);
    const fingerprint = `${alert.cat}|${alert.title}|${cities.slice().sort().join(',')}`;
    if (fingerprint !== lastSavedAlertFingerprint) {
      lastSavedAlertFingerprint = fingerprint;
      prisma.orefAlertHistory.create({
        data: {
          cat: String(alert.cat || ''),
          title: alert.title || '',
          cities: cities.map(c => c.trim()).filter(Boolean).join(', '),
        },
      }).catch((err) => console.error('[AlertHistory] Error saving:', err));
    }
  } else {
    lastSavedAlertFingerprint = null;
  }
});
orefClient.startPolling(POLL_INTERVAL);

// --- Start WhatsApp ---
const wa = getWhatsAppService();
wa.connect().catch((err) => console.error('[WA] Initial connect error:', err));

// --- Start server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Hosen] Server running on port ${PORT}`);
  console.log(`[Hosen] Dashboard: http://localhost:${PORT}`);
  console.log(`[Hosen] Alert polling every ${POLL_INTERVAL / 1000}s`);
});
