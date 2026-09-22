import { config } from 'dotenv';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { createPrismaClient } from '../src/prisma';
import { UserRole } from '../src/generated/prisma/enums';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const prisma = createPrismaClient(process.env.DATABASE_URL);

async function seed() {
  console.log('🌱 Starting database seeding...');

  // 1. Seed 4 Roles
  const roles = await Promise.all(
    Object.values(UserRole).map((code) =>
      prisma.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      }),
    ),
  );
  const roleMap = new Map(roles.map((r) => [r.code, r.id]));
  console.log('✅ Roles seeded (ADMIN, STAFF, PT, MEMBER)');

  // 2. Seed 3 Service Types
  await Promise.all(
    ['GYM_ACCESS', 'CLASS', 'PT'].map((code) =>
      prisma.serviceType.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      }),
    ),
  );
  console.log('✅ Service types seeded (GYM_ACCESS, CLASS, PT)');

  // 3. Hash passwords for demo accounts
  const saltRounds = 10;
  const adminPasswordHash = await bcrypt.hash('Admin@123456', saltRounds);
  const staffPasswordHash = await bcrypt.hash('Staff@123456', saltRounds);
  const ptPasswordHash = await bcrypt.hash('Pt@123456', saltRounds);
  const memberPasswordHash = await bcrypt.hash('Member@123456', saltRounds);

  // 4. Seed Admin Account
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@gym.com' },
    update: { passwordHash: adminPasswordHash, isActive: true },
    create: {
      email: 'admin@gym.com',
      passwordHash: adminPasswordHash,
      isActive: true,
      employeeProfile: {
        create: {
          fullName: 'System Administrator',
          specialization: 'System Management & Operations',
          hiredAt: new Date('2024-01-01'),
        },
      },
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: roleMap.get(UserRole.ADMIN)!,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: roleMap.get(UserRole.ADMIN)!,
    },
  });
  console.log(
    `✅ Admin account seeded: ${adminUser.email} (Password: Admin@123456)`,
  );

  // 5. Seed Staff Account
  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@gym.com' },
    update: { passwordHash: staffPasswordHash, isActive: true },
    create: {
      email: 'staff@gym.com',
      passwordHash: staffPasswordHash,
      isActive: true,
      employeeProfile: {
        create: {
          fullName: 'Reception Staff',
          phone: '0901112233',
          specialization: 'Customer Service & Reception',
          hiredAt: new Date('2024-06-01'),
        },
      },
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: {
      userId_roleId: {
        userId: staffUser.id,
        roleId: roleMap.get(UserRole.STAFF)!,
      },
    },
    update: {},
    create: {
      userId: staffUser.id,
      roleId: roleMap.get(UserRole.STAFF)!,
    },
  });
  console.log(
    `✅ Staff account seeded: ${staffUser.email} (Password: Staff@123456)`,
  );

  // 6. Seed Trainer (PT) Account
  const ptUser = await prisma.user.upsert({
    where: { email: 'pt@gym.com' },
    update: { passwordHash: ptPasswordHash, isActive: true },
    create: {
      email: 'pt@gym.com',
      passwordHash: ptPasswordHash,
      isActive: true,
      employeeProfile: {
        create: {
          fullName: 'Senior Coach Alex',
          phone: '0903334455',
          specialization: 'Fitness & Bodybuilding Coach',
          hiredAt: new Date('2024-03-15'),
        },
      },
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: {
      userId_roleId: {
        userId: ptUser.id,
        roleId: roleMap.get(UserRole.PT)!,
      },
    },
    update: {},
    create: {
      userId: ptUser.id,
      roleId: roleMap.get(UserRole.PT)!,
    },
  });
  console.log(
    `✅ PT Coach account seeded: ${ptUser.email} (Password: Pt@123456)`,
  );

  // 7. Seed Member Account
  const memberUser = await prisma.user.upsert({
    where: { email: 'member@gym.com' },
    update: { passwordHash: memberPasswordHash, isActive: true },
    create: {
      email: 'member@gym.com',
      passwordHash: memberPasswordHash,
      isActive: true,
      memberProfile: {
        create: {
          fullName: 'Nguyen Van A (Hội viên)',
          phone: '0908889999',
          dateOfBirth: new Date('1998-05-20'),
        },
      },
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: {
      userId_roleId: {
        userId: memberUser.id,
        roleId: roleMap.get(UserRole.MEMBER)!,
      },
    },
    update: {},
    create: {
      userId: memberUser.id,
      roleId: roleMap.get(UserRole.MEMBER)!,
    },
  });
  console.log(
    `✅ Member account seeded: ${memberUser.email} (Password: Member@123456)`,
  );

  console.log('\n🎉 All seed data applied successfully!');
}

seed()
  .catch((error: unknown) => {
    console.error('❌ Seeding error:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
