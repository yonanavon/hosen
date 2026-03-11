/**
 * Pikud HaOref (Home Front Command) Alert API Client
 *
 * Multi-source strategy to bypass geo-blocking:
 *   1. Direct oref.org.il (works only from Israeli IPs)
 *   2. pikud-haoref-api npm package (with optional proxy)
 *   3. Publicly available alert proxy APIs
 */

const { EventEmitter } = require('events');
const pikudHaoref = require('pikud-haoref-api');
const debug = require('./services/debug-log');

const OREF_BASE = 'https://www.oref.org.il';

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': 'application/json',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

// Alternative public proxy APIs that mirror oref data from Israeli servers
const PROXY_SOURCES = [
  {
    name: 'Tzeva Adom (alerts)',
    url: 'https://api.tzevaadom.co.il/notifications',
    type: 'realtime'
  },
  {
    name: 'Oref Direct (alerts)',
    url: `${OREF_BASE}/WarningMessages/alert/alerts.json`,
    headers: OREF_HEADERS,
    type: 'realtime'
  },
  {
    name: 'Oref Direct (history)',
    url: `${OREF_BASE}/WarningMessages/History/AlertsHistory.json`,
    headers: OREF_HEADERS,
    type: 'history'
  }
];

class OrefClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.lastAlerts = [];
    this.lastHistory = [];
    this.activeSource = null;
    this.proxyUrl = options.proxy || process.env.OREF_PROXY || null;

    this.status = {
      sources: {},
      activeSources: { realtime: null, history: null },
      lastAlertTime: null,
      totalAlertsReceived: 0
    };

    this.pollInterval = null;

    // Initialize status for each source
    for (const src of PROXY_SOURCES) {
      this.status.sources[src.name] = {
        ok: false, lastCheck: null, lastError: null, httpStatus: null, type: src.type
      };
    }
    this.status.sources['pikud-haoref-api (npm)'] = {
      ok: false, lastCheck: null, lastError: null, httpStatus: null, type: 'realtime'
    };
  }

  // Try fetching from a URL source
  async _fetchSource(source) {
    const now = new Date().toISOString();
    const stat = this.status.sources[source.name];

    try {
      const res = await fetch(source.url, {
        headers: source.headers || { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });

      stat.httpStatus = res.status;
      stat.lastCheck = now;

      if (!res.ok) {
        stat.ok = false;
        stat.lastError = `HTTP ${res.status}`;
        debug.log('OrefClient', 'warn', `מקור "${source.name}" החזיר HTTP ${res.status}`, { source: source.name, status: res.status });
        return null;
      }

      const text = await res.text();
      if (!text || text.trim() === '' || text.trim() === '[]') {
        stat.ok = true;
        stat.lastError = null;
        return []; // No active alerts - this is a valid response
      }

      const data = JSON.parse(text);
      stat.ok = true;
      stat.lastError = null;
      return Array.isArray(data) ? data : [data];
    } catch (err) {
      stat.lastCheck = now;
      stat.ok = false;
      stat.lastError = err.message;
      debug.log('OrefClient', 'error', `שגיאה בגישה למקור "${source.name}": ${err.message}`, { source: source.name, error: err.message });
      return null;
    }
  }

  // Try the npm package (pikud-haoref-api)
  async _fetchViaNpm() {
    const stat = this.status.sources['pikud-haoref-api (npm)'];
    const now = new Date().toISOString();
    stat.lastCheck = now;

    return new Promise((resolve) => {
      const options = {};
      if (this.proxyUrl) {
        options.proxy = this.proxyUrl;
      }

      pikudHaoref.getActiveAlerts((err, alerts) => {
        if (err) {
          stat.ok = false;
          stat.lastError = err.message || String(err);
          resolve(null);
        } else {
          stat.ok = true;
          stat.lastError = null;
          stat.httpStatus = 200;
          resolve(alerts || []);
        }
      }, options);
    });
  }

  // Main fetch - tries all sources with fallback
  async fetchAlerts() {
    // Try each realtime source
    for (const source of PROXY_SOURCES.filter(s => s.type === 'realtime')) {
      const result = await this._fetchSource(source);
      if (result !== null) {
        this.status.activeSources.realtime = source.name;
        this.lastAlerts = result;
        if (result.length > 0) {
          this.status.lastAlertTime = new Date().toISOString();
          this.status.totalAlertsReceived += result.length;
        }
        return result;
      }
    }

    // Fallback to npm package
    const npmResult = await this._fetchViaNpm();
    if (npmResult !== null) {
      this.status.activeSources.realtime = 'pikud-haoref-api (npm)';
      this.lastAlerts = npmResult;
      if (npmResult.length > 0) {
        this.status.lastAlertTime = new Date().toISOString();
        this.status.totalAlertsReceived += npmResult.length;
      }
      return npmResult;
    }

    debug.log('OrefClient', 'error', 'כל המקורות נכשלו — לא ניתן לקבל התרעות', { sources: Object.keys(this.status.sources) });
    this.status.activeSources.realtime = null;
    return [];
  }

  async fetchHistory() {
    for (const source of PROXY_SOURCES.filter(s => s.type === 'history')) {
      const result = await this._fetchSource(source);
      if (result !== null) {
        this.status.activeSources.history = source.name;
        this.lastHistory = result;
        return result;
      }
    }

    this.status.activeSources.history = null;
    return [];
  }

  startPolling(intervalMs = 5000) {
    if (this.pollInterval) return;
    console.log(`[OrefClient] Polling every ${intervalMs / 1000}s (multi-source fallback enabled)`);
    if (this.proxyUrl) {
      console.log(`[OrefClient] Using proxy: ${this.proxyUrl.replace(/\/\/.*@/, '//***@')}`);
    }
    this.pollInterval = setInterval(async () => {
      const alerts = await this.fetchAlerts();
      this.emit('alerts', alerts);
    }, intervalMs);
    this.fetchAlerts().then((alerts) => this.emit('alerts', alerts));
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  getStatus() {
    return {
      ...this.status,
      geoBlockNote: 'oref.org.il blocks non-Israeli IPs. The system tries multiple sources with automatic fallback.',
      tip: 'Set OREF_PROXY env var to an Israeli HTTP proxy to enable direct API access from abroad.'
    };
  }
}

module.exports = { OrefClient };
