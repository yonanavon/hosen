const { Router } = require('express');
const { authMiddleware } = require('../middleware/auth');
const { prisma } = require('../lib/prisma');

const router = Router();
router.use(authMiddleware);

// Get recent alert logs
router.get('/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50');
    const logs = await prisma.alertLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה בטעינת לוגים' });
  }
});

module.exports = router;
