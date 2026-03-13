/**
 * Pikud HaOref (Home Front Command) Alert API Client
 * Direct connection to oref.org.il — requires Israeli IP
 */

const { EventEmitter } = require('events');
const debug = require('./services/debug-log');

const OREF_URL = 'https://www.oref.org.il/WarningMessages/alert/alerts.json';

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': 'application/json',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

class OrefClient extends EventEmitter {
  constructor() {
    super();
    this.lastAlert = null; // raw oref object or null
    this.pollInterval = null;

    this.status = {
      ok: false,
      lastCheck: null,
      lastError: null,
      httpStatus: null,
      lastAlertTime: null,
      totalAlertsReceived: 0
    };
  }

  async fetchAlerts() {
    const now = new Date().toISOString();
    this.status.lastCheck = now;

    try {
      const res = await fetch(OREF_URL, {
        headers: OREF_HEADERS,
        signal: AbortSignal.timeout(8000)
      });

      this.status.httpStatus = res.status;

      if (!res.ok) {
        this.status.ok = false;
        this.status.lastError = `HTTP ${res.status}`;
        debug.log('OrefClient', 'warn', `פיקוד העורף החזיר HTTP ${res.status}`);
        return null;
      }

      const text = await res.text();
      if (!text || text.trim() === '' || text.trim() === '[]') {
        this.status.ok = true;
        this.status.lastError = null;
        this.lastAlert = null;
        return null; // no active alert
      }

      const data = JSON.parse(text);
      this.status.ok = true;
      this.status.lastError = null;
      this.lastAlert = data;
      this.status.lastAlertTime = now;
      this.status.totalAlertsReceived++;

      debug.log('OrefClient', 'alert', `התקבלה התרעה — cat:${data.cat} title:"${data.title}"`, { raw: data });

      return data;
    } catch (err) {
      this.status.ok = false;
      this.status.lastError = err.message;
      debug.log('OrefClient', 'error', `שגיאה בגישה לפיקוד העורף: ${err.message}`);
      return null;
    }
  }

  startPolling(intervalMs = 3000) {
    if (this.pollInterval) return;
    console.log(`[OrefClient] Polling oref.org.il every ${intervalMs / 1000}s`);
    this.pollInterval = setInterval(async () => {
      const alert = await this.fetchAlerts();
      this.emit('alert', alert);
    }, intervalMs);
    this.fetchAlerts().then((alert) => this.emit('alert', alert));
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  getStatus() {
    return { ...this.status };
  }
}

module.exports = { OrefClient };
