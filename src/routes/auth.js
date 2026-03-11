const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { prisma } = require('../lib/prisma');
const { generateToken } = require('../middleware/auth');

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'שם משתמש וסיסמה נדרשים' });
    }

    const user = await prisma.adminUser.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const token = generateToken({ userId: user.id, username: user.username });
    res.json({ token, username: user.username });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
