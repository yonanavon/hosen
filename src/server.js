const express = require('express');
const { OrefClient } = require('./orefClient');

const app = express();
const PORT = process.env.PORT || 3000;
const client = new OrefClient();

// Start background polling for real-time alerts
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
client.startPolling(POLL_INTERVAL);

// Also fetch history on startup
client.fetchHistory();
// Refresh history every 30 seconds
setInterval(() => client.fetchHistory(), 30000);

// Helper: render source status rows
function renderSourceRows(sources) {
  return Object.entries(sources).map(([name, s]) => `
    <div class="status-row">
      <span>${name} <span class="type-tag">${s.type}</span></span>
      <div>
        <span class="badge ${s.ok ? 'ok' : s.lastCheck ? 'err' : 'pending'}">
          ${s.ok ? 'OK' : s.lastCheck ? `ERR ${s.httpStatus || ''}` : 'pending'}
        </span>
        ${s.lastError ? `<span class="err-detail">${s.lastError}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// --- Routes ---

app.get('/', (req, res) => {
  const status = client.getStatus();
  const hasAnySource = status.activeSources.realtime || status.activeSources.history;
  res.send(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>התרעות פיקוד העורף</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
        .container { max-width: 850px; margin: 0 auto; }
        h1 { text-align: center; margin-bottom: 10px; color: #f8fafc; font-size: 1.8em; }
        .subtitle { text-align: center; margin-bottom: 30px; color: #94a3b8; font-size: 0.9em; }
        .card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 20px; border: 1px solid #334155; }
        .card h2 { margin-bottom: 16px; font-size: 1.15em; color: #cbd5e1; }
        .status-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #334155; flex-wrap: wrap; gap: 6px; }
        .status-row:last-child { border-bottom: none; }
        .badge { padding: 4px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 600; white-space: nowrap; }
        .badge.ok { background: #065f46; color: #6ee7b7; }
        .badge.err { background: #7f1d1d; color: #fca5a5; }
        .badge.pending { background: #78350f; color: #fcd34d; }
        .type-tag { font-size: 0.7em; background: #334155; padding: 2px 8px; border-radius: 10px; color: #94a3b8; }
        .err-detail { font-size: 0.75em; color: #f87171; margin-right: 8px; display: block; }
        .big-status { text-align: center; padding: 30px; }
        .big-status .icon { font-size: 3em; }
        .big-status .label { font-size: 1.3em; margin-top: 10px; }
        .active-source { color: #60a5fa; font-size: 0.85em; margin-top: 6px; }
        .note { background: #1e1b4b; border: 1px solid #3730a3; border-radius: 8px; padding: 16px; margin-top: 20px; font-size: 0.9em; color: #c7d2fe; }
        a { color: #60a5fa; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .endpoints { margin-top: 10px; line-height: 2; }
        .refresh { text-align: center; margin-top: 20px; }
        .refresh a { background: #3b82f6; color: white; padding: 10px 24px; border-radius: 8px; display: inline-block; }
        .alerts-list { max-height: 300px; overflow-y: auto; }
        .alert-item { background: #7f1d1d; border: 1px solid #991b1b; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
        .alert-item .cities { font-weight: 600; }
        .no-alerts { color: #6ee7b7; text-align: center; padding: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>התרעות פיקוד העורף</h1>
        <p class="subtitle">בדיקת חיבור מרחוק - Multi-source fallback</p>

        <div class="card">
          <div class="big-status">
            <div class="icon">${hasAnySource ? '&#9989;' : '&#10060;'}</div>
            <div class="label">${hasAnySource ? 'מחובר למקור נתונים' : 'אין חיבור פעיל'}</div>
            ${status.activeSources.realtime ? `<div class="active-source">מקור: ${status.activeSources.realtime}</div>` : ''}
          </div>
        </div>

        <div class="card">
          <h2>התרעות פעילות (${client.lastAlerts.length})</h2>
          <div class="alerts-list">
            ${client.lastAlerts.length === 0
              ? '<div class="no-alerts">אין התרעות פעילות כרגע</div>'
              : client.lastAlerts.map(a => `
                  <div class="alert-item">
                    <div class="cities">${(a.cities || a.data || [a.title || JSON.stringify(a)]).toString()}</div>
                    ${a.type ? `<div>סוג: ${a.type}</div>` : ''}
                    ${a.instructions ? `<div>${a.instructions}</div>` : ''}
                  </div>
                `).join('')
            }
          </div>
        </div>

        <div class="card">
          <h2>סטטוס מקורות</h2>
          ${renderSourceRows(status.sources)}
        </div>

        <div class="card">
          <h2>API Endpoints</h2>
          <div class="endpoints">
            <a href="/api/alerts">/api/alerts</a> - התרעות בזמן אמת (JSON)<br>
            <a href="/api/history">/api/history</a> - היסטוריית התרעות (JSON)<br>
            <a href="/api/status">/api/status</a> - סטטוס כל המקורות (JSON)<br>
            <a href="/health">/health</a> - Health check
          </div>
        </div>

        <div class="note">
          <strong>שים לב:</strong> ${status.geoBlockNote}<br>
          <strong>טיפ:</strong> ${status.tip}
        </div>

        <div class="refresh">
          <a href="/">רענן</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/api/alerts', (req, res) => {
  res.json({
    alerts: client.lastAlerts,
    activeSource: client.status.activeSources.realtime,
    sources: client.status.sources
  });
});

app.get('/api/history', async (req, res) => {
  const history = await client.fetchHistory();
  res.json({
    history,
    activeSource: client.status.activeSources.history,
    sources: client.status.sources
  });
});

app.get('/api/status', (req, res) => {
  res.json(client.getStatus());
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`[Hosen] Server running on port ${PORT}`);
  console.log(`[Hosen] Multi-source polling every ${POLL_INTERVAL / 1000}s`);
});
