import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createPrismaClient } from '../src/prisma';
import { UserRole } from '../src/generated/prisma/enums';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const prisma = createPrismaClient(process.env.DATABASE_URL);
async function seed() {
  await prisma.$transaction([
    ...Object.values(UserRole).map((code) =>
      prisma.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      }),
    ),
    ...['GYM_ACCESS', 'CLASS', 'PT'].map((code) =>
      prisma.serviceType.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      }),
    ),
  ]);
  console.log('Seeded roles and service types; no demo accounts or passwords.');
}
seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
