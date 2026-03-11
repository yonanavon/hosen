const QRCode = require('qrcode');
const { usePrismaAuthState } = require('./whatsapp-auth-store');
const { getIO } = require('../socket');
const debug = require('./debug-log');

class WhatsAppService {
  constructor() {
    this.socket = null;
    this.status = 'disconnected'; // disconnected | connecting | connected | qr
    this.currentQR = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async connect() {
    try {
      this.status = 'connecting';
      this._emitStatus();

      const baileys = await import('baileys');
      const makeWASocket = baileys.default;
      const { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = baileys;

      const { state, saveCreds } = await usePrismaAuthState();
      const { version } = await fetchLatestBaileysVersion();

      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined),
        },
        printQRInTerminal: true,
        generateHighQualityLinkPreview: false,
      });

      // Handle connection updates
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQR = await QRCode.toDataURL(qr);
          this.status = 'qr';
          this._emitStatus();
          this._emitQR();
        }

        if (connection === 'close') {
          this.currentQR = null;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMsg = lastDisconnect?.error?.message || 'unknown';
          debug.log('WhatsApp', 'warn', `חיבור נסגר — קוד: ${statusCode}, שגיאה: "${errorMsg}"`, { statusCode, errorMsg });
          console.log(`[WA] Connection closed — statusCode=${statusCode}, error="${errorMsg}"`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('[WA] Logged out, clearing session...');
            const { prisma } = require('../lib/prisma');
            await prisma.whatsappSession.deleteMany();
            this.status = 'disconnected';
            this._emitStatus();
          } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = 3000 * this.reconnectAttempts;
            console.log(`[WA] Reconnecting... attempt ${this.reconnectAttempts} in ${delay}ms`);
            this.status = 'connecting';
            this._emitStatus();
            setTimeout(() => this.connect(), delay);
          } else {
            this.status = 'disconnected';
            this._emitStatus();
            this._emitError(`החיבור נכשל לאחר ${this.maxReconnectAttempts} ניסיונות (${errorMsg}). נסה "נתק וחבר מחדש".`);
            console.log('[WA] Max reconnect attempts reached');
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.currentQR = null;
          this.reconnectAttempts = 0;
          this._emitStatus();
          debug.log('WhatsApp', 'info', 'WhatsApp מחובר בהצלחה');
          console.log('[WA] Connected successfully');
        }
      });

      // Save credentials on update
      this.socket.ev.on('creds.update', saveCreds);

      // Handle incoming messages — detect stickers
      this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (msg.key.fromMe) continue;
          if (!msg.message) continue;

          const stickerMsg = msg.message.stickerMessage;
          if (!stickerMsg) continue;

          try {
            const baileys2 = await import('baileys');
            const { downloadMediaMessage } = baileys2;
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            const base64 = Buffer.from(buffer).toString('base64');

            console.log(`[WA] Sticker received from ${msg.key.remoteJid}`);
            const io = getIO();
            if (io) {
              io.emit('sticker:received', {
                base64,
                mimetype: stickerMsg.mimetype || 'image/webp',
                from: msg.key.remoteJid,
                timestamp: new Date().toISOString(),
              });
            }
          } catch (err) {
            console.error('[WA] Error downloading sticker:', err);
          }
        }
      });
    } catch (error) {
      console.error('[WA] Connection error:', error);
      this.status = 'disconnected';
      this._emitStatus();
      this._emitError(error.message || 'שגיאה בחיבור לוואטסאפ');
    }
  }

  async sendSticker(jid, buffer) {
    if (!this.socket || this.status !== 'connected') {
      debug.log('WhatsApp', 'error', `ניסיון שליחת סטיקר נכשל — WhatsApp לא מחובר (status=${this.status})`, { jid, status: this.status });
      throw new Error('WhatsApp not connected');
    }
    await this.socket.sendMessage(jid, { sticker: buffer });
    debug.log('WhatsApp', 'send', `סטיקר נשלח בהצלחה לקבוצה ${jid}`, { jid });
  }

  async getGroups() {
    if (!this.socket || this.status !== 'connected') {
      throw new Error('WhatsApp not connected');
    }
    const groups = await this.socket.groupFetchAllParticipating();
    return Object.values(groups).map((g) => ({
      jid: g.id,
      subject: g.subject,
      participants: g.participants?.length || 0,
    }));
  }

  async restart() {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.reconnectAttempts = 0;
    this.status = 'disconnected';
    this.currentQR = null;
    this._emitStatus();
    this.connect().catch((err) => console.error('[WA] Restart connect error:', err));
  }

  async logout() {
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch (_) {
        // ignore — socket may already be closed
      }
      this.socket.end(undefined);
      this.socket = null;
    }
    const { prisma } = require('../lib/prisma');
    await prisma.whatsappSession.deleteMany();
    console.log('[WA] Session cleared from DB');
    this.reconnectAttempts = 0;
    this.status = 'disconnected';
    this.currentQR = null;
    this._emitStatus();
  }

  getStatus() {
    return this.status;
  }

  getQR() {
    return this.currentQR;
  }

  _emitStatus() {
    const io = getIO();
    if (io) io.emit('whatsapp:status', { status: this.status });
  }

  _emitQR() {
    const io = getIO();
    if (io && this.currentQR) io.emit('whatsapp:qr', { qr: this.currentQR });
  }

  _emitError(message) {
    const io = getIO();
    if (io) io.emit('whatsapp:error', { error: message });
  }
}

let instance = null;

function getWhatsAppService() {
  if (!instance) {
    instance = new WhatsAppService();
  }
  return instance;
}

module.exports = { getWhatsAppService };
