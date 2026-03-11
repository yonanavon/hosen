const { getIO } = require('../socket');

const MAX_ENTRIES = 500;
const entries = [];

/**
 * Severity levels: info, warn, error, alert, match, send
 */
function log(source, level, message, data = null) {
  const entry = {
    id: entries.length,
    ts: new Date().toISOString(),
    source,
    level,
    message,
    data,
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.pop();

  // Push to connected debug clients in real-time
  const io = getIO();
  if (io) io.emit('debug:log', entry);
}

function getEntries(limit = 200, filter = null) {
  let result = entries;
  if (filter) {
    result = result.filter(
      (e) =>
        (filter.source ? e.source === filter.source : true) &&
        (filter.level ? e.level === filter.level : true)
    );
  }
  return result.slice(0, limit);
}

function clear() {
  entries.length = 0;
}

module.exports = { log, getEntries, clear };
