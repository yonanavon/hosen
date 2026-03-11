const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const stickerService = require('../services/sticker.service');

const router = Router();
router.use(authMiddleware);

// List all saved stickers (without buffer data)
router.get('/', async (_req, res) => {
  try {
    const stickers = await stickerService.getAllStickers();
    res.json({ stickers });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה בטעינת סטיקרים' });
  }
});

// Get pending (recently received) stickers
router.get('/pending', (_req, res) => {
  res.json({ pending: stickerService.getPending() });
});

// Save a pending sticker with a tag
router.post('/save', async (req, res) => {
  try {
    const { index, tag } = req.body;
    if (tag == null || index == null) {
      return res.status(400).json({ error: 'נדרש index ו-tag' });
    }

    const pending = stickerService.removePending(index);
    if (!pending) {
      return res.status(404).json({ error: 'סטיקר לא נמצא ברשימת ההמתנה' });
    }

    const sticker = await stickerService.saveSticker(tag, pending.base64, pending.mimetype);
    res.json({ success: true, sticker: { id: sticker.id, tag: sticker.tag } });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'תג זה כבר קיים' });
    }
    console.error('[Stickers] Save error:', error);
    res.status(500).json({ error: 'שגיאה בשמירת סטיקר' });
  }
});

// Get sticker preview (base64)
router.get('/:tag/preview', async (req, res) => {
  try {
    const sticker = await stickerService.getStickerWithBuffer(req.params.tag);
    if (!sticker) {
      return res.status(404).json({ error: 'סטיקר לא נמצא' });
    }
    res.json({ tag: sticker.tag, base64: sticker.buffer, mimetype: sticker.mimetype });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה' });
  }
});

// Delete sticker
router.delete('/:tag', async (req, res) => {
  try {
    await stickerService.deleteSticker(req.params.tag);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה במחיקת סטיקר' });
  }
});

module.exports = router;
