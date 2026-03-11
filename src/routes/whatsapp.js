const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { getWhatsAppService } = require('../services/whatsapp.service');

const router = Router();
router.use(authMiddleware);

router.get('/status', (_req, res) => {
  const wa = getWhatsAppService();
  res.json({ status: wa.getStatus() });
});

router.get('/qr', (_req, res) => {
  const wa = getWhatsAppService();
  const qr = wa.getQR();
  res.json({ qr: qr || null, status: wa.getStatus() });
});

router.post('/restart', async (_req, res) => {
  try {
    const wa = getWhatsAppService();
    await wa.restart();
    res.json({ success: true, status: wa.getStatus() });
  } catch (error) {
    console.error('[WA Route] Restart error:', error);
    res.status(500).json({ error: 'שגיאה בהפעלה מחדש' });
  }
});

router.post('/logout', async (_req, res) => {
  try {
    const wa = getWhatsAppService();
    await wa.logout();
    res.json({ success: true });
  } catch (error) {
    console.error('[WA Route] Logout error:', error);
    res.status(500).json({ error: 'שגיאה בניתוק' });
  }
});

router.get('/groups', async (_req, res) => {
  try {
    const wa = getWhatsAppService();
    const groups = await wa.getGroups();
    res.json({ groups });
  } catch (error) {
    console.error('[WA Route] Groups error:', error);
    res.status(500).json({ error: error.message || 'שגיאה בטעינת קבוצות' });
  }
});

module.exports = router;
