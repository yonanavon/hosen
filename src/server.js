require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server: IOServer } = require('socket.io');
const { setIO } = require('./socket');
const { OrefClient } = require('./orefClient');
const { getWhatsAppService } = require('./services/whatsapp.service');
const { processAlerts } = require('./services/alert-processor');
const { addPending } = require('./services/sticker.service');

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
  res.json({
    alerts: orefClient.lastAlerts,
    activeSource: orefClient.status.activeSources.realtime,
  });
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
orefClient.on('alerts', (alerts) => {
  processAlerts(alerts).catch((err) =>
    console.error('[AlertProcessor] Error:', err)
  );
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
