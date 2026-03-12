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

// State per AlertConfig+AlertType: IDLE | ALERTING | CLEARING
// key: `${configId}:${alertType}`
const configStates = new Map();

function stateKey(configId, alertType) {
  return `${configId}:${alertType}`;
}

function getConfigState(configId, alertType) {
  const key = stateKey(configId, alertType);
  if (!configStates.has(key)) {
    configStates.set(key, {
      state: 'IDLE',
      leaveTimer: null,
      lastEnterTime: 0,
      staySent: false,
    });
  }
  return configStates.get(key);
}

function isStayInstruction(instructions) {
  if (!instructions) return false;
  return STAY_PHRASES.some((phrase) => instructions.includes(phrase));
}

async function sendStickerForPhase(config, alertType, phase) {
  const mapping = await prisma.stickerMapping.findUnique({
    where: { alertConfigId_alertType_phase: { alertConfigId: config.id, alertType, phase } },
  });
  if (!mapping) {
    debug.log('AlertProcessor', 'warn', `לא נמצא מיפוי סטיקר לאירוע "${alertType}" פאזה "${phase}" בהגדרה "${config.name}" (id=${config.id})`);
    return;
  }

  const sticker = await getStickerWithBuffer(mapping.stickerTag);
  if (!sticker) {
    debug.log('AlertProcessor', 'error', `סטיקר "${mapping.stickerTag}" לא נמצא בDB עבור "${alertType}/${phase}" בהגדרה "${config.name}"`);
    console.log(`[AlertProcessor] Sticker "${mapping.stickerTag}" not found for ${alertType}/${phase}`);
    return;
  }

  try {
    const wa = getWhatsAppService();
    const buffer = Buffer.from(sticker.buffer, 'base64');
    await wa.sendSticker(config.groupJid, buffer);
    debug.log('AlertProcessor', 'send', `נשלח סטיקר "${mapping.stickerTag}" (${alertType}/${phase}) לקבוצה ${config.groupJid}`, { config: config.name, alertType, phase, stickerTag: mapping.stickerTag, groupJid: config.groupJid });
    console.log(`[AlertProcessor] Sent "${alertType}/${phase}" sticker (${mapping.stickerTag}) to ${config.groupJid}`);

    // Log it
    await prisma.alertLog.create({
      data: {
        alertConfigId: config.id,
        alertType,
        phase,
        stickerTag: mapping.stickerTag,
        groupJid: config.groupJid,
        cities: config.cities,
      },
    });
  } catch (err) {
    debug.log('AlertProcessor', 'error', `שגיאה בשליחת סטיקר "${mapping.stickerTag}" לקבוצה ${config.groupJid}: ${err.message}`, { error: err.message, config: config.name, alertType, phase });
    console.error(`[AlertProcessor] Error sending sticker:`, err);
  }
}

async function processAlerts(alerts) {
  const configs = await prisma.alertConfig.findMany({
    where: { enabled: true },
  });

  // Build map of alertType -> Set of cities, and alertType -> instructions
  const alertsByCityType = new Map(); // alertType -> Set<city>
  const instructionsByType = new Map(); // alertType -> instructions string

  if (Array.isArray(alerts)) {
    for (const alert of alerts) {
      const alertType = alert.type || 'missiles';
      if (!alertsByCityType.has(alertType)) {
        alertsByCityType.set(alertType, new Set());
      }
      const citySet = alertsByCityType.get(alertType);

      const cities = alert.cities || alert.data || [];
      if (Array.isArray(cities)) {
        cities.forEach((c) => citySet.add(c.trim()));
      } else if (typeof cities === 'string') {
        cities.split(',').forEach((c) => citySet.add(c.trim()));
      }
      if (alert.instructions) instructionsByType.set(alertType, alert.instructions);
      if (alert.desc) instructionsByType.set(alertType, alert.desc);
    }
  }

  // Log raw alert data when there are active alerts
  if (alertsByCityType.size > 0) {
    const summary = {};
    for (const [type, cities] of alertsByCityType) {
      summary[type] = [...cities];
    }
    debug.log('OrefAlerts', 'alert', `התקבלו התרעות: ${[...alertsByCityType.keys()].join(', ')}`, {
      alertsByType: summary,
      rawAlerts: alerts,
    });
  }

  if (!configs.length && alertsByCityType.size > 0) {
    debug.log('AlertProcessor', 'warn', 'יש התרעות פעילות אבל אין הגדרות פעילות (enabled) בDB');
  }

  // Collect all alert types that have mappings for any config
  const allMappedTypes = new Set();
  for (const config of configs) {
    const mappings = await prisma.stickerMapping.findMany({
      where: { alertConfigId: config.id },
      select: { alertType: true },
    });
    mappings.forEach((m) => allMappedTypes.add(m.alertType));
  }

  // Process each config against each alert type
  for (const config of configs) {
    const configCities = config.cities.split(',').map((c) => c.trim()).filter(Boolean);

    // Check all alert types that are either active OR have a running state
    const typesToCheck = new Set([...alertsByCityType.keys()]);
    // Also check types that have a non-IDLE state (to handle CLEARING)
    for (const [key] of configStates) {
      if (key.startsWith(`${config.id}:`)) {
        const type = key.slice(`${config.id}:`.length);
        typesToCheck.add(type);
      }
    }

    for (const alertType of typesToCheck) {
      const activeCities = alertsByCityType.get(alertType) || new Set();
      const cs = getConfigState(config.id, alertType);
      const instructions = instructionsByType.get(alertType) || '';

      const hasMatch = configCities.some((city) => activeCities.has(city));
      const matchedCities = configCities.filter((city) => activeCities.has(city));

      // Log matching analysis when there are active alerts for this type
      if (activeCities.size > 0) {
        debug.log('AlertProcessor', 'match', `הגדרה "${config.name}" אירוע "${alertType}" (${cs.state}): ${hasMatch ? 'יש התאמה' : 'אין התאמה'}`, {
          configId: config.id,
          configName: config.name,
          alertType,
          configCities,
          matchedCities,
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
            debug.log('AlertProcessor', 'warn', `הגדרה "${config.name}" אירוע "${alertType}" בקולדאון (נותרו ${remainingSec} שניות)`, { configName: config.name, alertType, remainingSec });
            console.log(`[AlertProcessor] Config "${config.name}" ${alertType} in cooldown, skipping enter`);
            continue;
          }
          cs.state = 'ALERTING';
          cs.lastEnterTime = now;
          cs.staySent = false;
          debug.log('AlertProcessor', 'info', `הגדרה "${config.name}" אירוע "${alertType}" → ALERTING (ערים: ${matchedCities.join(', ')})`, { configName: config.name, alertType, matchedCities });
          console.log(`[AlertProcessor] Config "${config.name}" ${alertType} → ALERTING`);
          await sendStickerForPhase(config, alertType, 'enter');
        }
      } else if (cs.state === 'ALERTING') {
        // Check for "stay" instruction
        if (!cs.staySent && isStayInstruction(instructions)) {
          cs.staySent = true;
          console.log(`[AlertProcessor] Config "${config.name}" ${alertType} → stay instruction detected`);
          await sendStickerForPhase(config, alertType, 'stay');
        }

        // Check if alert cleared
        if (!hasMatch) {
          cs.state = 'CLEARING';
          console.log(`[AlertProcessor] Config "${config.name}" ${alertType} → CLEARING`);
          cs.leaveTimer = setTimeout(async () => {
            if (cs.state === 'CLEARING') {
              cs.state = 'IDLE';
              console.log(`[AlertProcessor] Config "${config.name}" ${alertType} → IDLE (leave)`);
              await sendStickerForPhase(config, alertType, 'leave');
            }
          }, LEAVE_DELAY_MS);
        }
      } else if (cs.state === 'CLEARING') {
        if (hasMatch) {
          if (cs.leaveTimer) {
            clearTimeout(cs.leaveTimer);
            cs.leaveTimer = null;
          }
          cs.state = 'ALERTING';
          console.log(`[AlertProcessor] Config "${config.name}" ${alertType} → back to ALERTING (leave cancelled)`);
        }
      }
    }
  }
}

function getConfigStates() {
  const result = {};
  for (const [key, cs] of configStates) {
    result[key] = {
      state: cs.state,
      lastEnterTime: cs.lastEnterTime ? new Date(cs.lastEnterTime).toISOString() : null,
      staySent: cs.staySent,
      hasLeaveTimer: !!cs.leaveTimer,
    };
  }
  return result;
}

module.exports = { processAlerts, getConfigStates };
