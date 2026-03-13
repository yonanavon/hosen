const { prisma } = require('../lib/prisma');
const { getWhatsAppService } = require('./whatsapp.service');
const { getStickerWithBuffer } = require('./sticker.service');
const debug = require('./debug-log');
const alertTypes = require('../data/alert-types.json');

const COOLDOWN_MS = parseInt(process.env.COOLDOWN_MS || '60000', 10);

// Track last sent per config+alertKey to avoid spamming
// key: `${configId}:${alertKey}` → timestamp
const lastSent = new Map();

/**
 * Classify an oref alert into one of our 4 keys:
 *   incoming, missiles, aircraft, resolved
 * Returns null if unrecognized.
 */
function classifyAlert(alert) {
  if (!alert || !alert.cat) return null;
  const cat = String(alert.cat);
  const title = alert.title || '';

  if (cat === '1') return 'missiles';
  if (cat === '6') return 'aircraft';
  if (cat === '10') {
    if (title.includes('בדקות הקרובות')) return 'incoming';
    if (title.includes('האירוע הסתיים')) return 'resolved';
    // Unknown cat 10 variant
    debug.log('AlertProcessor', 'warn', `cat 10 לא מוכר: "${title}"`, { cat, title });
    return null;
  }

  debug.log('AlertProcessor', 'warn', `קטגוריה לא מוכרת: cat=${cat} title="${title}"`, { cat, title });
  return null;
}

async function sendStickerForAlert(config, alertKey, cities) {
  const cooldownKey = `${config.id}:${alertKey}`;
  const now = Date.now();
  const last = lastSent.get(cooldownKey) || 0;

  if (now - last < COOLDOWN_MS) {
    const remainingSec = Math.round((COOLDOWN_MS - (now - last)) / 1000);
    debug.log('AlertProcessor', 'warn', `הגדרה "${config.name}" ${alertKey} בקולדאון (${remainingSec}s)`, { configName: config.name, alertKey, remainingSec });
    return;
  }

  const mapping = await prisma.stickerMapping.findUnique({
    where: { alertConfigId_alertType_phase: { alertConfigId: config.id, alertType: alertKey, phase: 'enter' } },
  });
  if (!mapping) {
    debug.log('AlertProcessor', 'warn', `לא נמצא מיפוי סטיקר ל-"${alertKey}" בהגדרה "${config.name}"`);
    return;
  }

  const sticker = await getStickerWithBuffer(mapping.stickerTag);
  if (!sticker) {
    debug.log('AlertProcessor', 'error', `סטיקר "${mapping.stickerTag}" לא נמצא בDB`);
    return;
  }

  try {
    const wa = getWhatsAppService();
    const buffer = Buffer.from(sticker.buffer, 'base64');
    await wa.sendSticker(config.groupJid, buffer);
    lastSent.set(cooldownKey, now);

    const typeLabel = alertTypes.find(t => t.key === alertKey)?.label || alertKey;
    debug.log('AlertProcessor', 'send', `נשלח סטיקר "${mapping.stickerTag}" (${typeLabel}) לקבוצה ${config.groupJid}`, {
      config: config.name, alertKey, stickerTag: mapping.stickerTag, groupJid: config.groupJid, cities
    });
    console.log(`[AlertProcessor] Sent "${alertKey}" sticker (${mapping.stickerTag}) to ${config.groupJid}`);

    await prisma.alertLog.create({
      data: {
        alertConfigId: config.id,
        alertType: alertKey,
        phase: 'enter',
        stickerTag: mapping.stickerTag,
        groupJid: config.groupJid,
        cities: cities.join(', '),
      },
    });
  } catch (err) {
    debug.log('AlertProcessor', 'error', `שגיאה בשליחת סטיקר: ${err.message}`, { error: err.message, config: config.name, alertKey });
    console.error(`[AlertProcessor] Error sending sticker:`, err);
  }
}

/**
 * Process a single oref alert object (or null when no alert).
 */
async function processAlert(alert) {
  if (!alert) return;

  const alertKey = classifyAlert(alert);
  if (!alertKey) return;

  const alertCities = new Set();
  const data = alert.data || [];
  if (Array.isArray(data)) {
    data.forEach((c) => alertCities.add(c.trim()));
  } else if (typeof data === 'string') {
    data.split(',').forEach((c) => alertCities.add(c.trim()));
  }

  if (alertCities.size === 0) return;

  const typeLabel = alertTypes.find(t => t.key === alertKey)?.label || alertKey;
  debug.log('OrefAlerts', 'alert', `${typeLabel} — ${alertCities.size} ערים`, {
    alertKey, cat: alert.cat, title: alert.title, cities: [...alertCities],
  });

  const configs = await prisma.alertConfig.findMany({
    where: { enabled: true },
  });

  if (!configs.length) {
    debug.log('AlertProcessor', 'warn', 'יש התרעה פעילה אבל אין הגדרות פעילות בDB');
    return;
  }

  for (const config of configs) {
    const configCities = config.cities.split(',').map((c) => c.trim()).filter(Boolean);
    const matchedCities = configCities.filter((city) => alertCities.has(city));

    debug.log('AlertProcessor', 'match', `הגדרה "${config.name}" — ${matchedCities.length ? 'יש התאמה' : 'אין התאמה'}`, {
      configName: config.name, alertKey, configCities, matchedCities, activeCities: [...alertCities],
    });

    if (matchedCities.length > 0) {
      await sendStickerForAlert(config, alertKey, matchedCities);
    }
  }
}

function getLastSentTimes() {
  const result = {};
  for (const [key, ts] of lastSent) {
    result[key] = new Date(ts).toISOString();
  }
  return result;
}

module.exports = { processAlert, getLastSentTimes };
