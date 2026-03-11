/**
 * Pikud HaOref (Home Front Command) Alert API Client
 *
 * Endpoints:
 *   - Real-time alerts: /WarningMessages/alert/alerts.json
 *   - Alert history:    /WarningMessages/History/AlertsHistory.json
 *
 * NOTE: The oref.org.il API geo-blocks non-Israeli IPs.
 *       This client tracks connection status so we can diagnose
 *       whether Railway's servers can reach the API.
 */

const BASE_URL = 'https://www.oref.org.il';

const HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': 'application/json',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

class OrefClient {
  constructor() {
    this.lastAlerts = [];
    this.lastHistory = [];
    this.status = {
      realtime: { ok: false, lastCheck: null, lastError: null, httpStatus: null },
      history:  { ok: false, lastCheck: null, lastError: null, httpStatus: null }
    };
    this.pollInterval = null;
  }

  async fetchAlerts() {
    const url = `${BASE_URL}/WarningMessages/alert/alerts.json`;
    const now = new Date().toISOString();

    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10000)
      });

      this.status.realtime.httpStatus = res.status;
      this.status.realtime.lastCheck = now;

      if (!res.ok) {
        this.status.realtime.ok = false;
        this.status.realtime.lastError = `HTTP ${res.status}`;
        return [];
      }

      const text = await res.text();
      // The endpoint returns empty string when there are no active alerts
      if (!text || text.trim() === '') {
        this.status.realtime.ok = true;
        this.status.realtime.lastError = null;
        this.lastAlerts = [];
        return [];
      }

      const data = JSON.parse(text);
      this.status.realtime.ok = true;
      this.status.realtime.lastError = null;
      this.lastAlerts = Array.isArray(data) ? data : [data];
      return this.lastAlerts;
    } catch (err) {
      this.status.realtime.lastCheck = now;
      this.status.realtime.ok = false;
      this.status.realtime.lastError = err.message;
      return [];
    }
  }

  async fetchHistory() {
    const url = `${BASE_URL}/WarningMessages/History/AlertsHistory.json`;
    const now = new Date().toISOString();

    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10000)
      });

      this.status.history.httpStatus = res.status;
      this.status.history.lastCheck = now;

      if (!res.ok) {
        this.status.history.ok = false;
        this.status.history.lastError = `HTTP ${res.status}`;
        return [];
      }

      const data = await res.json();
      this.status.history.ok = true;
      this.status.history.lastError = null;
      this.lastHistory = Array.isArray(data) ? data : [data];
      return this.lastHistory;
    } catch (err) {
      this.status.history.lastCheck = now;
      this.status.history.ok = false;
      this.status.history.lastError = err.message;
      return [];
    }
  }

  startPolling(intervalMs = 5000) {
    if (this.pollInterval) return;
    console.log(`[OrefClient] Polling every ${intervalMs / 1000}s`);
    this.pollInterval = setInterval(() => this.fetchAlerts(), intervalMs);
    this.fetchAlerts(); // immediate first check
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
      geoBlockNote: 'oref.org.il blocks non-Israeli IPs. If both endpoints show errors, the server IP is likely outside Israel.'
    };
  }
}

module.exports = { OrefClient };
