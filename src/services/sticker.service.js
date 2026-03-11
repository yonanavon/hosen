const { prisma } = require('../lib/prisma');

// In-memory pending queue for recently received stickers (max 20)
const pendingStickers = [];
const MAX_PENDING = 20;

function addPending(sticker) {
  pendingStickers.unshift(sticker);
  if (pendingStickers.length > MAX_PENDING) {
    pendingStickers.pop();
  }
}

function getPending() {
  return pendingStickers;
}

function removePending(index) {
  if (index >= 0 && index < pendingStickers.length) {
    return pendingStickers.splice(index, 1)[0];
  }
  return null;
}

async function saveSticker(tag, base64, mimetype = 'image/webp') {
  return prisma.sticker.upsert({
    where: { tag },
    update: { buffer: base64, mimetype },
    create: { tag, buffer: base64, mimetype },
  });
}

async function getSticker(tag) {
  return prisma.sticker.findUnique({ where: { tag } });
}

async function getAllStickers() {
  return prisma.sticker.findMany({
    select: { id: true, tag: true, mimetype: true, createdAt: true, updatedAt: true },
    orderBy: { tag: 'asc' },
  });
}

async function getStickerWithBuffer(tag) {
  return prisma.sticker.findUnique({ where: { tag } });
}

async function deleteSticker(tag) {
  return prisma.sticker.delete({ where: { tag } });
}

module.exports = {
  addPending,
  getPending,
  removePending,
  saveSticker,
  getSticker,
  getAllStickers,
  getStickerWithBuffer,
  deleteSticker,
};
