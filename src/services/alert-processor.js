const { prisma } = require('../lib/prisma');
const { getWhatsAppService } = require('./whatsapp.service');
const { getStickerWithBuffer } = require('./sticker.service');
const debug = require('./debug-log');

const LEAVE_DELAY_MS = parseInt(process.env.LEAVE_DELAY_MS || '10000', 10);
const COOLDOWN_MS = parseInt(process.env.COOLDOWN_MS || '300000', 10);

// Hebrew phrases indicating "stay near shelter"
const STAY_PHRASES = [
  'הישארו במרחב המוגן',
  'המתינו במרחב המוגן',
  'יש להישאר',
  'הישארו בתוך',
];

// State per AlertConfig: IDLE | ALERTING | CLEARING
const configStates = new Map();

function getConfigState(configId) {
  if (!configStates.has(configId)) {
    configStates.set(configId, {
      state: 'IDLE',
      leaveTimer: null,
      lastEnterTime: 0,
      staySent: false,
    });
  }
  return configStates.get(configId);
}

function isStayInstruction(instructions) {
  if (!instructions) return false;
  return STAY_PHRASES.some((phrase) => instructions.includes(phrase));
}

async function sendStickerForPhase(config, phase) {
  const mapping = await prisma.stickerMapping.findUnique({
    where: { alertConfigId_phase: { alertConfigId: config.id, phase } },
  });
  if (!mapping) {
    debug.log('AlertProcessor', 'warn', `לא נמצא מיפוי סטיקר לפאזה "${phase}" בהגדרה "${config.name}" (id=${config.id})`);
    return;
  }

  const sticker = await getStickerWithBuffer(mapping.stickerTag);
  if (!sticker) {
    debug.log('AlertProcessor', 'error', `סטיקר "${mapping.stickerTag}" לא נמצא בDB עבור פאזה "${phase}" בהגדרה "${config.name}"`);
    console.log(`[AlertProcessor] Sticker "${mapping.stickerTag}" not found for phase "${phase}"`);
    return;
  }

  try {
    const wa = getWhatsAppService();
    const buffer = Buffer.from(sticker.buffer, 'base64');
    await wa.sendSticker(config.groupJid, buffer);
    debug.log('AlertProcessor', 'send', `נשלח סטיקר "${mapping.stickerTag}" (${phase}) לקבוצה ${config.groupJid}`, { config: config.name, phase, stickerTag: mapping.stickerTag, groupJid: config.groupJid });
    console.log(`[AlertProcessor] Sent "${phase}" sticker (${mapping.stickerTag}) to ${config.groupJid}`);

    // Log it
    await prisma.alertLog.create({
      data: {
        alertConfigId: config.id,
        phase,
        stickerTag: mapping.stickerTag,
        groupJid: config.groupJid,
        cities: config.cities,
      },
    });
  } catch (err) {
    debug.log('AlertProcessor', 'error', `שגיאה בשליחת סטיקר "${mapping.stickerTag}" לקבוצה ${config.groupJid}: ${err.message}`, { error: err.message, config: config.name, phase });
    console.error(`[AlertProcessor] Error sending sticker:`, err);
  }
}

async function processAlerts(alerts) {
  const configs = await prisma.alertConfig.findMany({
    where: { enabled: true },
  });

  // Build set of currently alerting cities from API
  const activeCities = new Set();
  let instructions = '';
  if (Array.isArray(alerts)) {
    for (const alert of alerts) {
      // Tzeva Adom API format: alert.cities is array or alert.data is string
      const cities = alert.cities || alert.data || [];
      if (Array.isArray(cities)) {
        cities.forEach((c) => activeCities.add(c.trim()));
      } else if (typeof cities === 'string') {
        cities.split(',').forEach((c) => activeCities.add(c.trim()));
      }
      if (alert.instructions) instructions = alert.instructions;
      if (alert.desc) instructions = alert.desc;
    }
  }

  // Log raw alert data when there are active alerts
  if (activeCities.size > 0) {
    debug.log('OrefAlerts', 'alert', `התקבלו ${activeCities.size} ערים בהתרעה`, {
      cities: [...activeCities],
      rawAlerts: alerts,
      instructions: instructions || null,
    });
  }

  if (!configs.length && activeCities.size > 0) {
    debug.log('AlertProcessor', 'warn', 'יש התרעות פעילות אבל אין הגדרות פעילות (enabled) בDB');
  }

  for (const config of configs) {
    const configCities = config.cities.split(',').map((c) => c.trim()).filter(Boolean);
    const cs = getConfigState(config.id);

    // Check if any configured city is in active alerts
    const hasMatch = configCities.some((city) => activeCities.has(city));
    const matchedCities = configCities.filter((city) => activeCities.has(city));
    const unmatchedConfigCities = configCities.filter((city) => !activeCities.has(city));

    // Log matching analysis when there are active alerts
    if (activeCities.size > 0) {
      debug.log('AlertProcessor', 'match', `הגדרה "${config.name}" (${cs.state}): ${hasMatch ? 'יש התאמה' : 'אין התאמה'}`, {
        configId: config.id,
        configName: config.name,
        configCities,
        matchedCities,
        unmatchedConfigCities,
        activeCities: [...activeCities],
        currentState: cs.state,
        hasMatch,
      });
    }

    if (cs.state === 'IDLE') {
      if (hasMatch) {
        const now = Date.now();
        if (now - cs.lastEnterTime < COOLDOWN_MS) {
          const remainingSec = Math.round((COOLDOWN_MS - (now - cs.lastEnterTime)) / 1000);
          debug.log('AlertProcessor', 'warn', `הגדרה "${config.name}" בקולדאון (נותרו ${remainingSec} שניות), דילוג על enter`, { configName: config.name, remainingSec });
          console.log(`[AlertProcessor] Config "${config.name}" in cooldown, skipping enter`);
          continue;
        }
        cs.state = 'ALERTING';
        cs.lastEnterTime = now;
        cs.staySent = false;
        debug.log('AlertProcessor', 'info', `הגדרה "${config.name}" → ALERTING (ערים: ${matchedCities.join(', ')})`, { configName: config.name, matchedCities });
        console.log(`[AlertProcessor] Config "${config.name}" → ALERTING`);
        await sendStickerForPhase(config, 'enter');
      }
    } else if (cs.state === 'ALERTING') {
      // Check for "stay" instruction
      if (!cs.staySent && isStayInstruction(instructions)) {
        cs.staySent = true;
        console.log(`[AlertProcessor] Config "${config.name}" → stay instruction detected`);
        await sendStickerForPhase(config, 'stay');
      }

      // Check if alert cleared
      if (!hasMatch) {
        cs.state = 'CLEARING';
        console.log(`[AlertProcessor] Config "${config.name}" → CLEARING`);
        cs.leaveTimer = setTimeout(async () => {
          // Double-check still clearing (wasn't re-entered)
          if (cs.state === 'CLEARING') {
            cs.state = 'IDLE';
            console.log(`[AlertProcessor] Config "${config.name}" → IDLE (leave)`);
            await sendStickerForPhase(config, 'leave');
          }
        }, LEAVE_DELAY_MS);
      }
    } else if (cs.state === 'CLEARING') {
      if (hasMatch) {
        // Alert reappeared — cancel leave
        if (cs.leaveTimer) {
          clearTimeout(cs.leaveTimer);
          cs.leaveTimer = null;
        }
        cs.state = 'ALERTING';
        console.log(`[AlertProcessor] Config "${config.name}" → back to ALERTING (leave cancelled)`);
      }
    }
  }
}

function getConfigStates() {
  const result = {};
  for (const [id, cs] of configStates) {
    result[id] = {
      state: cs.state,
      lastEnterTime: cs.lastEnterTime ? new Date(cs.lastEnterTime).toISOString() : null,
      staySent: cs.staySent,
      hasLeaveTimer: !!cs.leaveTimer,
    };
  }
  return result;
}

module.exports = { processAlerts, getConfigStates };
