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

// --- Routes ---

app.get('/', (req, res) => {
  const status = client.getStatus();
  res.send(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>התרעות פיקוד העורף - בדיקת חיבור</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { text-align: center; margin-bottom: 30px; color: #f8fafc; }
        .card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 20px; border: 1px solid #334155; }
        .card h2 { margin-bottom: 16px; font-size: 1.2em; }
        .status-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #334155; }
        .status-row:last-child { border-bottom: none; }
        .badge { padding: 4px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 600; }
        .badge.ok { background: #065f46; color: #6ee7b7; }
        .badge.err { background: #7f1d1d; color: #fca5a5; }
        .badge.pending { background: #78350f; color: #fcd34d; }
        .note { background: #1e1b4b; border: 1px solid #3730a3; border-radius: 8px; padding: 16px; margin-top: 20px; font-size: 0.9em; color: #c7d2fe; }
        .endpoints { margin-top: 10px; }
        .endpoint { font-family: monospace; font-size: 0.85em; color: #94a3b8; margin: 4px 0; }
        a { color: #60a5fa; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .refresh { text-align: center; margin-top: 20px; }
        .refresh a { background: #3b82f6; color: white; padding: 10px 24px; border-radius: 8px; display: inline-block; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>התרעות פיקוד העורף</h1>
        <div class="card">
          <h2>סטטוס חיבור</h2>
          <div class="status-row">
            <span>התרעות בזמן אמת</span>
            <span class="badge ${status.realtime.ok ? 'ok' : status.realtime.lastCheck ? 'err' : 'pending'}">
              ${status.realtime.ok ? 'מחובר' : status.realtime.lastCheck ? 'שגיאה' : 'ממתין...'}
            </span>
          </div>
          <div class="status-row">
            <span>HTTP Status</span>
            <span>${status.realtime.httpStatus ?? 'N/A'}</span>
          </div>
          <div class="status-row">
            <span>שגיאה אחרונה</span>
            <span>${status.realtime.lastError || 'אין'}</span>
          </div>
          <div class="status-row">
            <span>בדיקה אחרונה</span>
            <span style="direction:ltr">${status.realtime.lastCheck || 'N/A'}</span>
          </div>
        </div>

        <div class="card">
          <h2>סטטוס היסטוריה</h2>
          <div class="status-row">
            <span>היסטוריית התרעות</span>
            <span class="badge ${status.history.ok ? 'ok' : status.history.lastCheck ? 'err' : 'pending'}">
              ${status.history.ok ? 'מחובר' : status.history.lastCheck ? 'שגיאה' : 'ממתין...'}
            </span>
          </div>
          <div class="status-row">
            <span>HTTP Status</span>
            <span>${status.history.httpStatus ?? 'N/A'}</span>
          </div>
          <div class="status-row">
            <span>שגיאה אחרונה</span>
            <span>${status.history.lastError || 'אין'}</span>
          </div>
        </div>

        <div class="card">
          <h2>API Endpoints</h2>
          <div class="endpoints">
            <a href="/api/alerts">/api/alerts</a> - התרעות בזמן אמת (JSON)<br>
            <a href="/api/history">/api/history</a> - היסטוריית התרעות (JSON)<br>
            <a href="/api/status">/api/status</a> - סטטוס חיבור (JSON)
          </div>
        </div>

        <div class="note">
          <strong>שים לב:</strong> ${status.geoBlockNote}
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
    status: client.status.realtime
  });
});

app.get('/api/history', async (req, res) => {
  const history = await client.fetchHistory();
  res.json({
    history,
    status: client.status.history
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
  console.log(`[Hosen] Polling Pikud HaOref API every ${POLL_INTERVAL / 1000}s`);
});
