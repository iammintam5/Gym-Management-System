import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { createPrismaClient } from '../src/prisma';
import {
  AttendanceStatus,
  BookingStatus,
  CheckinStatus,
  FreezeStatus,
  Gender,
  PaymentStatus,
  QuotaTransactionType,
  ScheduleStatus,
  SubscriptionStatus,
  UserRole,
} from '../src/generated/prisma/enums';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const prisma = createPrismaClient(process.env.DATABASE_URL);

function startOfCurrentWeekMonday(now = new Date()): Date {
  const d = new Date(now);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDaysWithTime(
  base: Date,
  daysOffset: number,
  hours: number,
  minutes = 0,
): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

async function seed() {
  console.log('🧹 Cleaning existing database records...');

  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.checkin.deleteMany(),
    prisma.classBooking.deleteMany(),
    prisma.ptBooking.deleteMany(),
    prisma.ptAvailability.deleteMany(),
    prisma.classSchedule.deleteMany(),
    prisma.gymClass.deleteMany(),
    prisma.subscriptionFreeze.deleteMany(),
    prisma.quotaTransaction.deleteMany(),
    prisma.subscriptionQuota.deleteMany(),
    prisma.paymentRecord.deleteMany(),
    prisma.subscription.updateMany({ data: { previousSubscriptionId: null } }),
    prisma.subscription.deleteMany(),
    prisma.planEntitlement.deleteMany(),
    prisma.membershipPlan.deleteMany(),
    prisma.memberProfile.deleteMany(),
    prisma.employeeProfile.deleteMany(),
    prisma.userRoleAssignment.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  console.log('🌱 Starting clean database seeding...');

  // 1. Seed 4 Roles
  const roles = await Promise.all(
    Object.values(UserRole).map((code) =>
      prisma.role.upsert({
        where: { code },
        update: { name: code },
        create: { code, name: code },
      }),
    ),
  );
  const roleMap = new Map(roles.map((r) => [r.code, r.id]));
  console.log('✅ Roles seeded (ADMIN, STAFF, PT, MEMBER)');

  // 2. Seed 3 Service Types with human-readable names
  const serviceTypeSpecs = [
    { code: 'GYM_ACCESS', name: 'Full Gym' },
    { code: 'CLASS', name: 'Group Class' },
    { code: 'PT', name: 'PT 1-1' },
  ] as const;

  const serviceTypes = await Promise.all(
    serviceTypeSpecs.map((st) =>
      prisma.serviceType.upsert({
        where: { code: st.code },
        update: { name: st.name },
        create: { code: st.code, name: st.name },
      }),
    ),
  );
  const serviceTypeMap = new Map(serviceTypes.map((st) => [st.code, st.id]));
  console.log('✅ Service types seeded (GYM_ACCESS, CLASS, PT)');

  // 3. Hash passwords for accounts
  const saltRounds = 10;
  const [
    adminPasswordHash,
    staffPasswordHash,
    ptPasswordHash,
    memberPasswordHash,
  ] = await Promise.all([
    bcrypt.hash('Admin@123456', saltRounds),
    bcrypt.hash('Staff@123456', saltRounds),
    bcrypt.hash('Pt@123456', saltRounds),
    bcrypt.hash('Member@123456', saltRounds),
  ]);

  // 4. Seed Admin + Staff + 4 PT Coaches
  const adminUser = await prisma.user.create({
    data: {
      id: '10000100-0000-4000-8000-000000000100',
      email: 'admin@gym.com',
      passwordHash: adminPasswordHash,
      isActive: true,
      roles: {
        create: { roleId: roleMap.get(UserRole.ADMIN)! },
      },
      employeeProfile: {
        create: {
          id: '00000100-0000-4000-8000-000000000100',
          fullName: 'Nguyễn Quản Trị',
          phone: '0901112233',
          specialization: 'Quản trị viên hệ thống',
          hiredAt: new Date('2023-01-10'),
        },
      },
    },
    include: { employeeProfile: true },
  });

  const staffUser = await prisma.user.create({
    data: {
      id: '10000201-0000-4000-8000-000000000201',
      email: 'staff@gym.com',
      passwordHash: staffPasswordHash,
      isActive: true,
      roles: {
        create: { roleId: roleMap.get(UserRole.STAFF)! },
      },
      employeeProfile: {
        create: {
          id: '00000201-0000-4000-8000-000000000201',
          fullName: 'Vũ Thị Mai Anh',
          phone: '0902223344',
          specialization: 'Lễ tân & Thu ngân',
          hiredAt: new Date('2024-01-15'),
        },
      },
    },
    include: { employeeProfile: true },
  });

  await prisma.user.create({
    data: {
      id: '10000202-0000-4000-8000-000000000202',
      email: 'cashier@gym.com',
      passwordHash: staffPasswordHash,
      isActive: true,
      roles: {
        create: { roleId: roleMap.get(UserRole.STAFF)! },
      },
      employeeProfile: {
        create: {
          id: '00000202-0000-4000-8000-000000000202',
          fullName: 'Hoàng Gia Huy',
          phone: '0902223388',
          specialization: 'Chăm sóc hội viên & Thu ngân',
          hiredAt: new Date('2024-06-01'),
        },
      },
    },
  });

  const ptSpecs = [
    {
      userId: '10000101-0000-4000-8000-000000000101',
      empId: '00000101-0000-4000-8000-000000000101',
      email: 'pt@gym.com',
      fullName: 'Trần Quốc Bảo',
      phone: '0903334455',
      specialization: 'Boxing & Conditioning',
      hiredAt: new Date('2022-03-15'),
    },
    {
      userId: '10000102-0000-4000-8000-000000000102',
      empId: '00000102-0000-4000-8000-000000000102',
      email: 'nam.pt@gym.com',
      fullName: 'Nguyễn Hoàng Nam',
      phone: '0903334466',
      specialization: 'Bodybuilding & Hypertrophy',
      hiredAt: new Date('2021-06-10'),
    },
    {
      userId: '10000103-0000-4000-8000-000000000103',
      empId: '00000103-0000-4000-8000-000000000103',
      email: 'ngoc.pt@gym.com',
      fullName: 'Lê Bảo Ngọc',
      phone: '0903334477',
      specialization: 'Power Yoga & Mobility',
      hiredAt: new Date('2022-09-01'),
    },
    {
      userId: '10000104-0000-4000-8000-000000000104',
      empId: '00000104-0000-4000-8000-000000000104',
      email: 'tuan.pt@gym.com',
      fullName: 'Phạm Minh Tuấn',
      phone: '0903334488',
      specialization: 'Strength & Powerlifting',
      hiredAt: new Date('2020-02-20'),
    },
  ] as const;

  const createdTrainers = [];
  for (const pt of ptSpecs) {
    const u = await prisma.user.create({
      data: {
        id: pt.userId,
        email: pt.email,
        passwordHash: ptPasswordHash,
        isActive: true,
        roles: {
          create: { roleId: roleMap.get(UserRole.PT)! },
        },
        employeeProfile: {
          create: {
            id: pt.empId,
            fullName: pt.fullName,
            phone: pt.phone,
            specialization: pt.specialization,
            hiredAt: pt.hiredAt,
          },
        },
      },
      include: { employeeProfile: true },
    });
    createdTrainers.push(u.employeeProfile!);
  }
  console.log('✅ Employees & Trainers seeded (EMP-00000100 .. EMP-00000202)');

  // 5. Seed 6 Members (including primary demo account member@gym.com)
  const memberSpecs = [
    {
      userId: '20001024-0000-4000-8000-000000001024',
      memberId: '00001024-0000-4000-8000-000000001024',
      email: 'member@gym.com',
      fullName: 'Lê Minh Khôi',
      phone: '0908112233',
      gender: Gender.MALE,
      dateOfBirth: new Date('1998-05-20'),
      idPhotoUrl:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=400&auto=format&fit=crop',
    },
    {
      userId: '20001025-0000-4000-8000-000000001025',
      memberId: '00001025-0000-4000-8000-000000001025',
      email: 'vy.pham@gmail.com',
      fullName: 'Phạm Thảo Vy',
      phone: '0912445566',
      gender: Gender.FEMALE,
      dateOfBirth: new Date('2001-08-14'),
      idPhotoUrl:
        'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=400&auto=format&fit=crop',
    },
    {
      userId: '20001026-0000-4000-8000-000000001026',
      memberId: '00001026-0000-4000-8000-000000001026',
      email: 'long.tran@gmail.com',
      fullName: 'Trần Hoàng Long',
      phone: '0987654321',
      gender: Gender.MALE,
      dateOfBirth: new Date('1995-11-02'),
      idPhotoUrl:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=400&auto=format&fit=crop',
    },
    {
      userId: '20001027-0000-4000-8000-000000001027',
      memberId: '00001027-0000-4000-8000-000000001027',
      email: 'ha.dang@gmail.com',
      fullName: 'Đặng Thu Hà',
      phone: '0933778899',
      gender: Gender.FEMALE,
      dateOfBirth: new Date('1999-03-25'),
      idPhotoUrl: null, // Chờ chụp ảnh định danh tại quầy lễ tân
    },
    {
      userId: '20001028-0000-4000-8000-000000001028',
      memberId: '00001028-0000-4000-8000-000000001028',
      email: 'huy.vu@gmail.com',
      fullName: 'Vũ Quốc Huy',
      phone: '0977123456',
      gender: Gender.MALE,
      dateOfBirth: new Date('1997-07-19'),
      idPhotoUrl:
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=400&auto=format&fit=crop',
    },
  ] as const;

  const createdMembers = [];
  for (const m of memberSpecs) {
    const u = await prisma.user.create({
      data: {
        id: m.userId,
        email: m.email,
        passwordHash: memberPasswordHash,
        isActive: true,
        roles: {
          create: { roleId: roleMap.get(UserRole.MEMBER)! },
        },
        memberProfile: {
          create: {
            id: m.memberId,
            fullName: m.fullName,
            phone: m.phone,
            gender: m.gender,
            dateOfBirth: m.dateOfBirth,
            idPhotoUrl: m.idPhotoUrl,
            facePhotoVersion: m.idPhotoUrl
              ? createHash('md5').update(m.idPhotoUrl).digest('hex')
              : null,
          },
        },
      },
      include: { memberProfile: true },
    });
    createdMembers.push(u.memberProfile!);
  }
  console.log('✅ Members seeded (MEM-00001024 .. MEM-00001028)');

  // 6. Seed 3 Membership Plans + Entitlements
  const basicPlan = await prisma.membershipPlan.create({
    data: {
      id: '30000001-0000-4000-8000-000000000001',
      name: 'AURA BASIC',
      description:
        'Gói tập tiêu chuẩn 1 tháng gồm toàn bộ khu vực Full Gym, 8 buổi Group Class và 1 buổi PT 1-1.',
      durationDays: 30,
      price: 590000,
      isActive: true,
      entitlements: {
        create: [
          { serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!, allocated: null },
          { serviceTypeId: serviceTypeMap.get('CLASS')!, allocated: 8 },
          { serviceTypeId: serviceTypeMap.get('PT')!, allocated: 1 },
        ],
      },
    },
  });

  const proPlan = await prisma.membershipPlan.create({
    data: {
      id: '30000002-0000-4000-8000-000000000002',
      name: 'AURA PRO',
      description:
        'Gói tập 3 tháng không giới hạn Check-in Full Gym, 16 buổi Group Class và 8 buổi kèm riêng PT 1-1.',
      durationDays: 90,
      price: 1490000,
      isActive: true,
      entitlements: {
        create: [
          { serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!, allocated: null },
          { serviceTypeId: serviceTypeMap.get('CLASS')!, allocated: 16 },
          { serviceTypeId: serviceTypeMap.get('PT')!, allocated: 8 },
        ],
      },
    },
  });

  const elitePlan = await prisma.membershipPlan.create({
    data: {
      id: '30000003-0000-4000-8000-000000000003',
      name: 'AURA ELITE',
      description:
        'Đặc quyền VIP 12 tháng toàn diện với 36 buổi Group Class và 24 buổi kèm riêng PT 1-1.',
      durationDays: 365,
      price: 4500000,
      isActive: true,
      entitlements: {
        create: [
          { serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!, allocated: null },
          { serviceTypeId: serviceTypeMap.get('CLASS')!, allocated: 36 },
          { serviceTypeId: serviceTypeMap.get('PT')!, allocated: 24 },
        ],
      },
    },
  });
  console.log('✅ Membership plans seeded (Basic, Pro, Elite)');

  // 7. Seed Subscriptions, Quotas, Payments, and Freezes relative to current date
  const now = new Date();
  const sub1Start = addDaysWithTime(now, -25, 8, 0);
  const sub1End = addDaysWithTime(now, 65, 23, 59);
  const sub1RenewalStart = new Date(sub1End);
  const sub1RenewalEnd = addDaysWithTime(sub1RenewalStart, 365, 23, 59);

  // Member 1 (Lê Minh Khôi - member@gym.com): Active Pro Plan + Queued Upcoming Elite Renewal
  const sub1 = await prisma.subscription.create({
    data: {
      id: '40000001-0000-4000-8000-000000000001',
      memberId: createdMembers[0]!.id,
      planId: proPlan.id,
      startDate: sub1Start,
      endDate: sub1End,
      status: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      agreedPrice: 1490000,
      activatedAt: sub1Start,
      createdBy: staffUser.id,
      quotas: {
        create: [
          {
            id: '50000001-0000-4000-8000-000000000001',
            serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!,
            allocated: null,
            reserved: 0,
            used: 12,
          },
          {
            id: '50000002-0000-4000-8000-000000000002',
            serviceTypeId: serviceTypeMap.get('CLASS')!,
            allocated: 16,
            reserved: 2,
            used: 9,
          },
          {
            id: '50000003-0000-4000-8000-000000000003',
            serviceTypeId: serviceTypeMap.get('PT')!,
            allocated: 8,
            reserved: 1,
            used: 4,
          },
        ],
      },
      payments: {
        create: {
          id: '60000042-0000-4000-8000-000000000042',
          amount: 1490000,
          currency: 'VND',
          status: PaymentStatus.PAID,
          method: 'TRANSFER',
          note: 'Thanh toán chuyển khoản gói Pro Plan 90 ngày',
          confirmedBy: staffUser.id,
          confirmedAt: sub1Start,
          createdAt: sub1Start,
        },
      },
    },
    include: { quotas: true },
  });

  // Member 1 Queued Renewal (UPCOMING)
  await prisma.subscription.create({
    data: {
      id: '40000002-0000-4000-8000-000000000002',
      memberId: createdMembers[0]!.id,
      planId: elitePlan.id,
      previousSubscriptionId: sub1.id,
      startDate: sub1RenewalStart,
      endDate: sub1RenewalEnd,
      status: SubscriptionStatus.UPCOMING,
      paymentStatus: PaymentStatus.PAID,
      agreedPrice: 4500000,
      createdBy: staffUser.id,
      quotas: {
        create: [
          {
            serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!,
            allocated: null,
            reserved: 0,
            used: 0,
          },
          {
            serviceTypeId: serviceTypeMap.get('CLASS')!,
            allocated: 36,
            reserved: 0,
            used: 0,
          },
          {
            serviceTypeId: serviceTypeMap.get('PT')!,
            allocated: 24,
            reserved: 0,
            used: 0,
          },
        ],
      },
      payments: {
        create: {
          id: '60000043-0000-4000-8000-000000000043',
          amount: 4500000,
          currency: 'VND',
          status: PaymentStatus.PAID,
          method: 'CARD',
          note: 'Gia hạn nối đuôi gói Elite Plan 365 ngày',
          confirmedBy: staffUser.id,
          confirmedAt: addDaysWithTime(now, -2, 10, 15),
          createdAt: addDaysWithTime(now, -2, 10, 15),
        },
      },
    },
  });

  // Historical completed freeze for sub1
  await prisma.subscriptionFreeze.create({
    data: {
      id: '70000118-0000-4000-8000-000000000118',
      subscriptionId: sub1.id,
      startsAt: addDaysWithTime(now, -20, 0, 0),
      endsAt: addDaysWithTime(now, -10, 23, 59),
      freezeDays: 10,
      status: FreezeStatus.COMPLETED,
      reason: 'Đi công tác nước ngoài 10 ngày',
      approvedBy: adminUser.id,
      restoredAt: addDaysWithTime(now, -10, 9, 0),
    },
  });

  // Member 2 (Phạm Thảo Vy): Active Basic Plan expiring in 4 days
  const sub2Start = addDaysWithTime(now, -26, 9, 0);
  const sub2End = addDaysWithTime(now, 4, 23, 59);
  const sub2 = await prisma.subscription.create({
    data: {
      id: '40000003-0000-4000-8000-000000000003',
      memberId: createdMembers[1]!.id,
      planId: basicPlan.id,
      startDate: sub2Start,
      endDate: sub2End,
      status: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      agreedPrice: 590000,
      activatedAt: sub2Start,
      createdBy: staffUser.id,
      quotas: {
        create: [
          {
            id: '50000004-0000-4000-8000-000000000004',
            serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!,
            allocated: null,
            reserved: 0,
            used: 8,
          },
          {
            id: '50000005-0000-4000-8000-000000000005',
            serviceTypeId: serviceTypeMap.get('CLASS')!,
            allocated: 8,
            reserved: 1,
            used: 5,
          },
          {
            id: '50000006-0000-4000-8000-000000000006',
            serviceTypeId: serviceTypeMap.get('PT')!,
            allocated: 1,
            reserved: 0,
            used: 1,
          },
        ],
      },
      payments: {
        create: {
          id: '60000044-0000-4000-8000-000000000044',
          amount: 590000,
          currency: 'VND',
          status: PaymentStatus.PAID,
          method: 'CASH',
          note: 'Thu tiền mặt tại quầy lễ tân',
          confirmedBy: staffUser.id,
          confirmedAt: sub2Start,
          createdAt: sub2Start,
        },
      },
    },
  });

  // Member 3 (Trần Hoàng Long): Suspended Pro Plan (currently on approved freeze)
  const sub3Start = addDaysWithTime(now, -40, 8, 0);
  const sub3End = addDaysWithTime(now, 50, 23, 59);
  const sub3 = await prisma.subscription.create({
    data: {
      id: '40000004-0000-4000-8000-000000000004',
      memberId: createdMembers[2]!.id,
      planId: proPlan.id,
      startDate: sub3Start,
      endDate: sub3End,
      status: SubscriptionStatus.SUSPENDED,
      paymentStatus: PaymentStatus.PAID,
      agreedPrice: 1490000,
      activatedAt: sub3Start,
      createdBy: staffUser.id,
      quotas: {
        create: [
          {
            serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!,
            allocated: null,
            reserved: 0,
            used: 10,
          },
          {
            serviceTypeId: serviceTypeMap.get('CLASS')!,
            allocated: 16,
            reserved: 0,
            used: 6,
          },
          {
            serviceTypeId: serviceTypeMap.get('PT')!,
            allocated: 8,
            reserved: 0,
            used: 2,
          },
        ],
      },
      payments: {
        create: {
          id: '60000045-0000-4000-8000-000000000045',
          amount: 1490000,
          currency: 'VND',
          status: PaymentStatus.PAID,
          method: 'TRANSFER',
          note: 'Thanh toán gói Pro Plan 90 ngày',
          confirmedBy: staffUser.id,
          confirmedAt: sub3Start,
          createdAt: sub3Start,
        },
      },
    },
  });

  await prisma.subscriptionFreeze.create({
    data: {
      id: '70000204-0000-4000-8000-000000000204',
      subscriptionId: sub3.id,
      startsAt: addDaysWithTime(now, -3, 0, 0),
      endsAt: addDaysWithTime(now, 11, 23, 59),
      freezeDays: 14,
      status: FreezeStatus.APPROVED,
      reason: 'Bảo lưu 14 ngày phục hồi chấn thương cổ chân',
      approvedBy: staffUser.id,
    },
  });

  // Member 4 (Đặng Thu Hà): Active Elite Plan
  const sub4Start = addDaysWithTime(now, -15, 8, 0);
  const sub4End = addDaysWithTime(now, 350, 23, 59);
  const sub4 = await prisma.subscription.create({
    data: {
      id: '40000005-0000-4000-8000-000000000005',
      memberId: createdMembers[3]!.id,
      planId: elitePlan.id,
      startDate: sub4Start,
      endDate: sub4End,
      status: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      agreedPrice: 4500000,
      activatedAt: sub4Start,
      createdBy: staffUser.id,
      quotas: {
        create: [
          {
            id: '50000007-0000-4000-8000-000000000007',
            serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!,
            allocated: null,
            reserved: 0,
            used: 7,
          },
          {
            id: '50000008-0000-4000-8000-000000000008',
            serviceTypeId: serviceTypeMap.get('CLASS')!,
            allocated: 36,
            reserved: 1,
            used: 4,
          },
          {
            id: '50000009-0000-4000-8000-000000000009',
            serviceTypeId: serviceTypeMap.get('PT')!,
            allocated: 24,
            reserved: 1,
            used: 3,
          },
        ],
      },
      payments: {
        create: {
          id: '60000046-0000-4000-8000-000000000046',
          amount: 4500000,
          currency: 'VND',
          status: PaymentStatus.PAID,
          method: 'CARD',
          note: 'Thanh toán thẻ tín dụng gói Elite Plan',
          confirmedBy: adminUser.id,
          confirmedAt: sub4Start,
          createdAt: sub4Start,
        },
      },
    },
  });

  // Member 5 (Vũ Quốc Huy): Active Basic Plan expiring in 6 days
  const sub5Start = addDaysWithTime(now, -24, 8, 0);
  const sub5End = addDaysWithTime(now, 6, 23, 59);
  await prisma.subscription.create({
    data: {
      id: '40000006-0000-4000-8000-000000000006',
      memberId: createdMembers[4]!.id,
      planId: basicPlan.id,
      startDate: sub5Start,
      endDate: sub5End,
      status: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.PAID,
      agreedPrice: 590000,
      activatedAt: sub5Start,
      createdBy: staffUser.id,
      quotas: {
        create: [
          {
            serviceTypeId: serviceTypeMap.get('GYM_ACCESS')!,
            allocated: null,
            reserved: 0,
            used: 5,
          },
          {
            serviceTypeId: serviceTypeMap.get('CLASS')!,
            allocated: 8,
            reserved: 0,
            used: 3,
          },
          {
            serviceTypeId: serviceTypeMap.get('PT')!,
            allocated: 1,
            reserved: 0,
            used: 0,
          },
        ],
      },
      payments: {
        create: {
          id: '60000047-0000-4000-8000-000000000047',
          amount: 590000,
          currency: 'VND',
          status: PaymentStatus.PAID,
          method: 'CASH',
          note: 'Thanh toán tiền mặt gói Basic Plan',
          confirmedBy: staffUser.id,
          confirmedAt: sub5Start,
          createdAt: sub5Start,
        },
      },
    },
  });
  console.log('✅ Subscriptions, Quotas, Payments, and Freezes seeded');

  // 8. Seed Quota Transactions for sub1
  await prisma.quotaTransaction.createMany({
    data: [
      {
        quotaId: '50000003-0000-4000-8000-000000000003',
        subscriptionId: sub1.id,
        type: QuotaTransactionType.RESERVE,
        allocatedDelta: 0,
        reservedDelta: 1,
        usedDelta: 0,
        idempotencyKey: 'seed:qtx:pt-reserve-1',
        referenceType: 'PT_BOOKING',
        reason: 'Giữ chỗ ca tập PT 1-1 với HLV Trần Quốc Bảo',
        createdBy: '20001024-0000-4000-8000-000000001024',
      },
      {
        quotaId: '50000002-0000-4000-8000-000000000002',
        subscriptionId: sub1.id,
        type: QuotaTransactionType.USE,
        allocatedDelta: 0,
        reservedDelta: -1,
        usedDelta: 1,
        idempotencyKey: 'seed:qtx:class-use-1',
        referenceType: 'CLASS_BOOKING',
        reason: 'Điểm danh hoàn thành lớp Boxing Conditioning',
        createdBy: '10000101-0000-4000-8000-000000000101',
      },
    ],
  });

  // 9. Seed 4 Gym Classes + Current Week Class Schedules
  const boxingClass = await prisma.gymClass.create({
    data: {
      id: '80000001-0000-4000-8000-000000000001',
      name: 'Boxing Conditioning',
      description:
        'Lớp đấm bốc phản xạ, đốt mỡ cường độ cao và rèn sức bền tim mạch.',
      isActive: true,
    },
  });

  const hiitClass = await prisma.gymClass.create({
    data: {
      id: '80000002-0000-4000-8000-000000000002',
      name: 'HIIT Burn',
      description:
        'Tập luyện ngắt quãng cường độ cao giúp tối ưu chuyển hóa năng lượng.',
      isActive: true,
    },
  });

  const yogaClass = await prisma.gymClass.create({
    data: {
      id: '80000003-0000-4000-8000-000000000003',
      name: 'Power Yoga',
      description:
        'Cân bằng hơi thở, tăng độ dẻo dai khớp và sức mạnh vùng cơ lõi.',
      isActive: true,
    },
  });

  const strengthClass = await prisma.gymClass.create({
    data: {
      id: '80000004-0000-4000-8000-000000000004',
      name: 'Strength & Core',
      description:
        'Xây dựng sức mạnh nền tảng với tạ đòn, Kettlebell và bài tập Compound.',
      isActive: true,
    },
  });

  const monday = startOfCurrentWeekMonday(now);

  const scheduleSpecs = [
    {
      id: '81000001-0000-4000-8000-000000000001',
      classId: boxingClass.id,
      trainerId: createdTrainers[0]!.id, // Trần Quốc Bảo
      startsAt: addDaysWithTime(monday, 0, 7, 0),
      endsAt: addDaysWithTime(monday, 0, 8, 0),
      capacity: 15,
    },
    {
      id: '81000002-0000-4000-8000-000000000002',
      classId: yogaClass.id,
      trainerId: createdTrainers[2]!.id, // Lê Bảo Ngọc
      startsAt: addDaysWithTime(monday, 1, 9, 0),
      endsAt: addDaysWithTime(monday, 1, 10, 0),
      capacity: 15,
    },
    {
      id: '81000003-0000-4000-8000-000000000003',
      classId: hiitClass.id,
      trainerId: createdTrainers[1]!.id, // Nguyễn Hoàng Nam
      startsAt: addDaysWithTime(monday, 2, 17, 30),
      endsAt: addDaysWithTime(monday, 2, 18, 30),
      capacity: 18,
    },
    {
      id: '81000004-0000-4000-8000-000000000004',
      classId: strengthClass.id,
      trainerId: createdTrainers[3]!.id, // Phạm Minh Tuấn
      startsAt: addDaysWithTime(monday, 3, 18, 0),
      endsAt: addDaysWithTime(monday, 3, 19, 30),
      capacity: 12,
    },
    {
      id: '81000005-0000-4000-8000-000000000005',
      classId: boxingClass.id,
      trainerId: createdTrainers[0]!.id, // Trần Quốc Bảo
      startsAt: addDaysWithTime(monday, 4, 18, 0),
      endsAt: addDaysWithTime(monday, 4, 19, 0),
      capacity: 15,
    },
    {
      id: '81000006-0000-4000-8000-000000000006',
      classId: yogaClass.id,
      trainerId: createdTrainers[2]!.id, // Lê Bảo Ngọc
      startsAt: addDaysWithTime(monday, 5, 8, 30),
      endsAt: addDaysWithTime(monday, 5, 9, 30),
      capacity: 15,
    },
    // Future class guaranteed to be >24h ahead for testing member cancellation
    {
      id: '81000007-0000-4000-8000-000000000007',
      classId: boxingClass.id,
      trainerId: createdTrainers[0]!.id,
      startsAt: addDaysWithTime(now, 2, 18, 0),
      endsAt: addDaysWithTime(now, 2, 19, 0),
      capacity: 15,
    },
    {
      id: '81000008-0000-4000-8000-000000000008',
      classId: hiitClass.id,
      trainerId: createdTrainers[1]!.id,
      startsAt: addDaysWithTime(now, 3, 17, 30),
      endsAt: addDaysWithTime(now, 3, 18, 30),
      capacity: 18,
    },
  ] as const;

  for (const sch of scheduleSpecs) {
    await prisma.classSchedule.create({
      data: {
        id: sch.id,
        classId: sch.classId,
        trainerId: sch.trainerId,
        startsAt: sch.startsAt,
        endsAt: sch.endsAt,
        capacity: sch.capacity,
        status: ScheduleStatus.SCHEDULED,
      },
    });
  }

  // 10. Seed Class Bookings
  await prisma.classBooking.createMany({
    data: [
      {
        id: '82000001-0000-4000-8000-000000000001',
        scheduleId: '81000007-0000-4000-8000-000000000007',
        memberId: createdMembers[0]!.id,
        subscriptionId: sub1.id,
        quotaId: '50000002-0000-4000-8000-000000000002',
        status: BookingStatus.BOOKED,
        attendance: AttendanceStatus.PENDING,
      },
      {
        id: '82000002-0000-4000-8000-000000000002',
        scheduleId: '81000008-0000-4000-8000-000000000008',
        memberId: createdMembers[0]!.id,
        subscriptionId: sub1.id,
        quotaId: '50000002-0000-4000-8000-000000000002',
        status: BookingStatus.BOOKED,
        attendance: AttendanceStatus.PENDING,
      },
      {
        id: '82000003-0000-4000-8000-000000000003',
        scheduleId: '81000007-0000-4000-8000-000000000007',
        memberId: createdMembers[1]!.id,
        subscriptionId: sub2.id,
        quotaId: '50000005-0000-4000-8000-000000000005',
        status: BookingStatus.BOOKED,
        attendance: AttendanceStatus.PENDING,
      },
      {
        id: '82000004-0000-4000-8000-000000000004',
        scheduleId: '81000007-0000-4000-8000-000000000007',
        memberId: createdMembers[3]!.id,
        subscriptionId: sub4.id,
        quotaId: '50000008-0000-4000-8000-000000000008',
        status: BookingStatus.BOOKED,
        attendance: AttendanceStatus.PENDING,
      },
    ],
  });

  // 11. Seed PT Availabilities & PT Bookings
  const ptSlot1Start = addDaysWithTime(now, 1, 9, 0);
  const ptSlot1End = addDaysWithTime(now, 1, 10, 0);
  const ptSlot2Start = addDaysWithTime(now, 1, 15, 0);
  const ptSlot2End = addDaysWithTime(now, 1, 16, 0);
  const ptSlot3Start = addDaysWithTime(now, 2, 10, 0);
  const ptSlot3End = addDaysWithTime(now, 2, 11, 0);

  const avail1 = await prisma.ptAvailability.create({
    data: {
      id: '83000001-0000-4000-8000-000000000001',
      trainerId: createdTrainers[0]!.id, // Trần Quốc Bảo
      startsAt: ptSlot1Start,
      endsAt: ptSlot1End,
      isAvailable: false,
      note: 'Tập phản xạ đích đấm & bộ pháp Boxing 1-1',
    },
  });

  await prisma.ptAvailability.createMany({
    data: [
      {
        id: '83000002-0000-4000-8000-000000000002',
        trainerId: createdTrainers[0]!.id,
        startsAt: ptSlot2Start,
        endsAt: ptSlot2End,
        isAvailable: true,
        note: 'Slot trống PT 1-1 buổi chiều',
      },
      {
        id: '83000003-0000-4000-8000-000000000003',
        trainerId: createdTrainers[1]!.id, // Nguyễn Hoàng Nam
        startsAt: ptSlot3Start,
        endsAt: ptSlot3End,
        isAvailable: true,
        note: 'Tư vấn hình thể & đo chỉ số InBody 1-1',
      },
    ],
  });

  await prisma.ptBooking.create({
    data: {
      id: '84000001-0000-4000-8000-000000000001',
      memberId: createdMembers[0]!.id,
      trainerId: createdTrainers[0]!.id,
      subscriptionId: sub1.id,
      quotaId: '50000003-0000-4000-8000-000000000003',
      availabilityId: avail1.id,
      startsAt: ptSlot1Start,
      endsAt: ptSlot1End,
      status: BookingStatus.BOOKED,
      attendance: AttendanceStatus.PENDING,
    },
  });
  console.log('✅ Classes, Schedules, PT Availabilities, and Bookings seeded');

  // 12. Seed Gate Check-ins (Accepted & Rejected)
  await prisma.checkin.createMany({
    data: [
      {
        id: '85000409-0000-4000-8000-000000000409',
        memberId: createdMembers[0]!.id,
        subscriptionId: sub1.id,
        quotaId: '50000001-0000-4000-8000-000000000001',
        status: CheckinStatus.ACCEPTED,
        checkedInAt: addDaysWithTime(now, 0, 7, 15),
        recordedBy: staffUser.id,
      },
      {
        id: '85000408-0000-4000-8000-000000000408',
        memberId: createdMembers[1]!.id,
        subscriptionId: sub2.id,
        quotaId: '50000004-0000-4000-8000-000000000004',
        status: CheckinStatus.ACCEPTED,
        checkedInAt: addDaysWithTime(now, 0, 8, 5),
        recordedBy: staffUser.id,
      },
      {
        id: '85000407-0000-4000-8000-000000000407',
        memberId: createdMembers[2]!.id,
        subscriptionId: sub3.id,
        status: CheckinStatus.REJECTED,
        rejectionReason: 'Gói tập đang trong thời gian tạm dừng bảo lưu',
        checkedInAt: addDaysWithTime(now, 0, 8, 30),
        recordedBy: staffUser.id,
      },
      {
        id: '85000406-0000-4000-8000-000000000406',
        memberId: createdMembers[3]!.id,
        subscriptionId: sub4.id,
        quotaId: '50000007-0000-4000-8000-000000000007',
        status: CheckinStatus.ACCEPTED,
        checkedInAt: addDaysWithTime(now, -1, 17, 45),
        recordedBy: staffUser.id,
      },
    ],
  });

  // 13. Seed Notifications & Audit Logs
  await prisma.notification.createMany({
    data: [
      {
        userId: adminUser.id,
        title: 'Hội viên sắp hết hạn gói tập',
        body: 'Hội viên Phạm Thảo Vy (MEM-00001025) còn 4 ngày hiệu lực gói AURA BASIC.',
      },
      {
        userId: staffUser.id,
        title: 'Hội viên chưa có ảnh ID Check-in',
        body: 'Hội viên Đặng Thu Hà (MEM-00001027) cần chụp Webcam ảnh ID Check-in tại quầy lễ tân.',
      },
      {
        userId: '20001024-0000-4000-8000-000000001024',
        title: 'Xác nhận đặt lịch PT 1-1',
        body: 'Bạn đã đặt Slot PT 1-1 thành công với Coach Trần Quốc Bảo vào ngày mai lúc 09:00.',
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorId: staffUser.id,
        action: 'CREATE_SUBSCRIPTION',
        entityType: 'SUBSCRIPTION',
        entityId: sub1.id,
        metadata: {
          planName: 'Pro Plan',
          agreedPrice: 1490000,
          memberCode: 'MEM-00001024',
        },
      },
      {
        actorId: staffUser.id,
        action: 'APPROVE_FREEZE',
        entityType: 'SUBSCRIPTION_FREEZE',
        entityId: '70000204-0000-4000-8000-000000000204',
        metadata: { freezeDays: 14, memberCode: 'MEM-00001026' },
      },
      {
        actorId: adminUser.id,
        action: 'CONFIRM_PAYMENT',
        entityType: 'PAYMENT',
        entityId: '60000046-0000-4000-8000-000000000046',
        metadata: {
          amount: 4500000,
          method: 'CARD',
          memberCode: 'MEM-00001027',
        },
      },
    ],
  });

  console.log('🎉 Clean database seeding completed successfully!');
}

seed()
  .catch((error: unknown) => {
    console.error('❌ Seeding error:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
