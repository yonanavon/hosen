const { prisma } = require('../lib/prisma');

/**
 * Prisma-based auth state for Baileys.
 * Stores authentication credentials and signal keys in PostgreSQL.
 */
async function usePrismaAuthState() {
  const baileys = await import('baileys');
  const { initAuthCreds, proto, BufferJSON } = baileys;

  const writeData = async (key, data) => {
    const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    await prisma.whatsappSession.upsert({
      where: { key },
      update: { value: serialized },
      create: { key, value: serialized },
    });
  };

  const readData = async (key) => {
    const row = await prisma.whatsappSession.findUnique({ where: { key } });
    if (!row) return null;
    return JSON.parse(JSON.stringify(row.value), BufferJSON.reviver);
  };

  const removeData = async (key) => {
    await prisma.whatsappSession.deleteMany({ where: { key } });
  };

  // Load or create creds
  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData('creds', creds);
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const result = {};
        for (const id of ids) {
          const data = await readData(`${type}-${id}`);
          if (data) {
            if (type === 'app-state-sync-key') {
              result[id] = proto.Message.AppStateSyncKeyData.fromObject(data);
            } else {
              result[id] = data;
            }
          }
        }
        return result;
      },
      set: async (data) => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            if (value) {
              await writeData(`${type}-${id}`, value);
            } else {
              await removeData(`${type}-${id}`);
            }
          }
        }
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await writeData('creds', state.creds);
    },
  };
}

module.exports = { usePrismaAuthState };
