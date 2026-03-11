const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = await prisma.adminUser.findUnique({ where: { username } });
  if (existing) {
    console.log(`[Seed] Admin user "${username}" already exists, skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.create({
    data: { username, passwordHash },
  });
  console.log(`[Seed] Created admin user "${username}".`);
}

main()
  .catch((e) => {
    console.error('[Seed] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
