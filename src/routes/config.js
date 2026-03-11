const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { prisma } = require('../lib/prisma');

const router = Router();
router.use(authMiddleware);

// Cached cities list from Pikud HaOref
let citiesCache = null;
let citiesCacheTime = 0;
const CITIES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const CITIES_URLS = [
  'https://alerts-history.oref.org.il/Shared/Ajax/GetCitiesMix.aspx?lang=he',
  'https://www.oref.org.il/districts/cities_heb.json',
];

async function fetchCities() {
  if (citiesCache && Date.now() - citiesCacheTime < CITIES_CACHE_TTL) {
    return citiesCache;
  }
  for (const url of CITIES_URLS) {
    try {
      const res = await fetch(url, {
        headers: { 'Referer': 'https://www.oref.org.il/', 'X-Requested-With': 'XMLHttpRequest' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      citiesCache = data.map((c) => ({
        label: c.label_he || c.label,
        area: (c.mixname || '').replace(/<[^>]*>/g, '').replace(c.label_he || c.label, '').replace('|', '').trim(),
        migunTime: c.migun_time,
      }));
      citiesCacheTime = Date.now();
      console.log(`[Config] Loaded ${citiesCache.length} cities from ${url}`);
      return citiesCache;
    } catch { /* try next */ }
  }
  return citiesCache || [];
}

// Get cities list for autocomplete
router.get('/cities', async (_req, res) => {
  try {
    const cities = await fetchCities();
    res.json({ cities });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה בטעינת ערים' });
  }
});

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
