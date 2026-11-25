import { APP_GUARD } from '@nestjs/core';
import { GymScopeGuard } from './common/gym-scope.guard';
import { PtAssignmentsModule } from './modules/pt-assignments/pt-assignments.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnvironment } from './config/environment';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MembersModule } from './modules/members/members.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { MembershipPlansModule } from './modules/membership-plans/membership-plans.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { SubscriptionFreezesModule } from './modules/subscription-freezes/subscription-freezes.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CheckinsModule } from './modules/checkins/checkins.module';
import { ClassesModule } from './modules/classes/classes.module';
import { ClassSchedulesModule } from './modules/class-schedules/class-schedules.module';
import { ClassBookingsModule } from './modules/class-bookings/class-bookings.module';
import { TrainersModule } from './modules/trainers/trainers.module';
import { PtBookingsModule } from './modules/pt-bookings/pt-bookings.module';
import { PtPackagesModule } from './modules/pt-packages/pt-packages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './modules/database/database.module';
import { JobsModule } from './modules/jobs/jobs.module';
@Module({
  providers: [
    GymScopeGuard,
    { provide: APP_GUARD, useExisting: GymScopeGuard },
  ],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../../.env'),
      validate: validateEnvironment,
    }),
    AuthModule,
    UsersModule,
    MembersModule,
    EmployeesModule,
    MembershipPlansModule,
    SubscriptionsModule,
    QuotasModule,
    SubscriptionFreezesModule,
    PaymentsModule,
    CheckinsModule,
    ClassesModule,
    ClassSchedulesModule,
    ClassBookingsModule,
    TrainersModule,
    PtBookingsModule,
    PtPackagesModule,
    PtAssignmentsModule,
    NotificationsModule,
    ReportsModule,
    AuditLogsModule,
    HealthModule,
    DatabaseModule,
    JobsModule,
  ],
})
export class AppModule {}
