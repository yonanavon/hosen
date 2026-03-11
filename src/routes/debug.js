const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { prisma } = require('../lib/prisma');
const debug = require('../services/debug-log');
const { getWhatsAppService } = require('../services/whatsapp.service');
const { getConfigStates } = require('../services/alert-processor');

const router = Router();
router.use(authMiddleware);

// Get debug log entries
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit || '200');
  const source = req.query.source || null;
  const level = req.query.level || null;
  const filter = source || level ? { source, level } : null;
  res.json({ logs: debug.getEntries(limit, filter) });
});

// Clear debug logs
router.post('/logs/clear', (_req, res) => {
  debug.clear();
  res.json({ success: true });
});

// Full system diagnostic snapshot
router.get('/diagnostic', async (_req, res) => {
  try {
    const wa = getWhatsAppService();

    // Get all configs with mappings
    const configs = await prisma.alertConfig.findMany({
      include: { mappings: true },
    });

    // Get all stickers (tags only)
    const stickers = await prisma.sticker.findMany({
      select: { tag: true },
    });
    const stickerTags = new Set(stickers.map((s) => s.tag));

    // Check each config for issues
    const configDiagnostics = configs.map((c) => {
      const issues = [];
      if (!c.enabled) issues.push('ההגדרה מושבתת');
      if (!c.cities || !c.cities.trim()) issues.push('לא הוגדרו ערים');
      if (!c.groupJid) issues.push('לא הוגדרה קבוצת וואטסאפ');

      const phases = ['enter', 'stay', 'leave'];
      for (const phase of phases) {
        const mapping = c.mappings.find((m) => m.phase === phase);
        if (!mapping) {
          issues.push(`חסר מיפוי סטיקר לפאזה "${phase}"`);
        } else if (!stickerTags.has(mapping.stickerTag)) {
          issues.push(`סטיקר "${mapping.stickerTag}" (${phase}) לא נמצא בDB`);
        }
      }

      return {
        id: c.id,
        name: c.name,
        enabled: c.enabled,
        cities: c.cities,
        groupJid: c.groupJid,
        mappings: c.mappings.map((m) => ({
          phase: m.phase,
          stickerTag: m.stickerTag,
          stickerExists: stickerTags.has(m.stickerTag),
        })),
        issues,
        ok: issues.length === 0,
      };
    });

    res.json({
      whatsapp: {
        status: wa.getStatus(),
        ok: wa.getStatus() === 'connected',
      },
      configs: configDiagnostics,
      stickers: stickers.map((s) => s.tag),
      configStates: getConfigStates(),
      totalConfigs: configs.length,
      enabledConfigs: configs.filter((c) => c.enabled).length,
    });
  } catch (error) {
    console.error('[Debug] Diagnostic error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
