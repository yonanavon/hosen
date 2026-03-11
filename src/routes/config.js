const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { prisma } = require('../lib/prisma');

const router = Router();
router.use(authMiddleware);

// List all alert configs with their mappings
router.get('/', async (_req, res) => {
  try {
    const configs = await prisma.alertConfig.findMany({
      include: { mappings: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ configs });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה בטעינת הגדרות' });
  }
});

// Create alert config
router.post('/', async (req, res) => {
  try {
    const { name, cities, groupJid, enabled } = req.body;
    if (!name || !cities || !groupJid) {
      return res.status(400).json({ error: 'נדרש שם, ערים ו-groupJid' });
    }
    const config = await prisma.alertConfig.create({
      data: { name, cities, groupJid, enabled: enabled !== false },
    });
    res.json({ config });
  } catch (error) {
    console.error('[Config] Create error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הגדרה' });
  }
});

// Update alert config
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, cities, groupJid, enabled } = req.body;
    const config = await prisma.alertConfig.update({
      where: { id },
      data: { name, cities, groupJid, enabled },
    });
    res.json({ config });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה בעדכון הגדרה' });
  }
});

// Delete alert config
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.alertConfig.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה במחיקת הגדרה' });
  }
});

// Set sticker mapping for a config
router.post('/:id/mappings', async (req, res) => {
  try {
    const alertConfigId = parseInt(req.params.id);
    const { phase, stickerTag } = req.body;
    if (!phase || !stickerTag) {
      return res.status(400).json({ error: 'נדרש phase ו-stickerTag' });
    }
    if (!['enter', 'stay', 'leave'].includes(phase)) {
      return res.status(400).json({ error: 'phase חייב להיות enter, stay, או leave' });
    }

    const mapping = await prisma.stickerMapping.upsert({
      where: { alertConfigId_phase: { alertConfigId, phase } },
      update: { stickerTag },
      create: { alertConfigId, phase, stickerTag },
    });
    res.json({ mapping });
  } catch (error) {
    console.error('[Config] Mapping error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון מיפוי' });
  }
});

// Delete sticker mapping
router.delete('/:id/mappings/:phase', async (req, res) => {
  try {
    const alertConfigId = parseInt(req.params.id);
    const phase = req.params.phase;
    await prisma.stickerMapping.delete({
      where: { alertConfigId_phase: { alertConfigId, phase } },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה במחיקת מיפוי' });
  }
});

module.exports = router;
