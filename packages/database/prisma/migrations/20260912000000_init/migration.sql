-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEMBER', 'PT', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PENDING', 'PRESENT', 'ABSENT', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "QuotaTransactionType" AS ENUM ('RESERVE', 'USE', 'REFUND', 'ADJUST');

-- CreateEnum
CREATE TYPE "CheckinStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FreezeStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" "UserRole" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "member_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "date_of_birth" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "specialization" TEXT,
    "hired_at" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_days" INTEGER NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlements" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "allocated" INTEGER,

    CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "previous_subscription_id" UUID,
    "start_date" TIMESTAMPTZ(3) NOT NULL,
    "end_date" TIMESTAMPTZ(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "agreed_price" DECIMAL(14,2) NOT NULL,
    "activated_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_quotas" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "allocated" INTEGER,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_freezes" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "freeze_days" INTEGER NOT NULL,
    "status" "FreezeStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "approved_by" UUID,
    "restored_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "note" TEXT,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_transactions" (
    "id" UUID NOT NULL,
    "quota_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "type" "QuotaTransactionType" NOT NULL,
    "allocated_delta" INTEGER NOT NULL DEFAULT 0,
    "reserved_delta" INTEGER NOT NULL DEFAULT 0,
    "used_delta" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkins" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "subscription_id" UUID,
    "quota_id" UUID,
    "status" "CheckinStatus" NOT NULL,
    "rejection_reason" TEXT,
    "checked_in_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedules" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "class_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_bookings" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "quota_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "attendance" "AttendanceStatus" NOT NULL DEFAULT 'PENDING',
    "cancelled_at" TIMESTAMPTZ(3),
    "attended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pt_availability" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "pt_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pt_bookings" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "quota_id" UUID NOT NULL,
    "availability_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "attendance" "AttendanceStatus" NOT NULL DEFAULT 'PENDING',
    "cancelled_at" TIMESTAMPTZ(3),
    "attended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pt_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_profiles_user_id_key" ON "member_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_user_id_key" ON "employee_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_types_code_key" ON "service_types"("code");

-- CreateIndex
CREATE INDEX "plan_entitlements_service_type_id_idx" ON "plan_entitlements"("service_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_entitlements_plan_id_service_type_id_key" ON "plan_entitlements"("plan_id", "service_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_previous_subscription_id_key" ON "subscriptions"("previous_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_member_id_status_idx" ON "subscriptions"("member_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_start_date_idx" ON "subscriptions"("status", "start_date");

-- CreateIndex
CREATE INDEX "subscriptions_status_end_date_idx" ON "subscriptions"("status", "end_date");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "subscriptions_created_by_idx" ON "subscriptions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_id_member_id_key" ON "subscriptions"("id", "member_id");

-- CreateIndex
CREATE INDEX "subscription_quotas_service_type_id_idx" ON "subscription_quotas"("service_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_quotas_subscription_id_service_type_id_key" ON "subscription_quotas"("subscription_id", "service_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_quotas_id_subscription_id_key" ON "subscription_quotas"("id", "subscription_id");

-- CreateIndex
CREATE INDEX "subscription_freezes_subscription_id_status_idx" ON "subscription_freezes"("subscription_id", "status");

-- CreateIndex
CREATE INDEX "subscription_freezes_status_ends_at_idx" ON "subscription_freezes"("status", "ends_at");

-- CreateIndex
CREATE INDEX "subscription_freezes_approved_by_idx" ON "subscription_freezes"("approved_by");

-- CreateIndex
CREATE INDEX "payment_records_subscription_id_status_idx" ON "payment_records"("subscription_id", "status");

-- CreateIndex
CREATE INDEX "payment_records_confirmed_by_idx" ON "payment_records"("confirmed_by");

-- CreateIndex
CREATE UNIQUE INDEX "quota_transactions_idempotency_key_key" ON "quota_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "quota_transactions_quota_id_created_at_idx" ON "quota_transactions"("quota_id", "created_at");

-- CreateIndex
CREATE INDEX "quota_transactions_subscription_id_idx" ON "quota_transactions"("subscription_id");

-- CreateIndex
CREATE INDEX "quota_transactions_created_by_idx" ON "quota_transactions"("created_by");

-- CreateIndex
CREATE INDEX "checkins_member_id_checked_in_at_idx" ON "checkins"("member_id", "checked_in_at");

-- CreateIndex
CREATE INDEX "checkins_subscription_id_idx" ON "checkins"("subscription_id");

-- CreateIndex
CREATE INDEX "checkins_quota_id_idx" ON "checkins"("quota_id");

-- CreateIndex
CREATE INDEX "checkins_recorded_by_idx" ON "checkins"("recorded_by");

-- CreateIndex
CREATE INDEX "class_schedules_class_id_starts_at_idx" ON "class_schedules"("class_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_schedules_trainer_id_starts_at_idx" ON "class_schedules"("trainer_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_bookings_member_id_status_idx" ON "class_bookings"("member_id", "status");

-- CreateIndex
CREATE INDEX "class_bookings_subscription_id_idx" ON "class_bookings"("subscription_id");

-- CreateIndex
CREATE INDEX "class_bookings_quota_id_idx" ON "class_bookings"("quota_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_bookings_schedule_id_member_id_key" ON "class_bookings"("schedule_id", "member_id");

-- CreateIndex
CREATE INDEX "pt_availability_trainer_id_starts_at_idx" ON "pt_availability"("trainer_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "pt_availability_id_trainer_id_key" ON "pt_availability"("id", "trainer_id");

-- CreateIndex
CREATE INDEX "pt_bookings_trainer_id_starts_at_ends_at_idx" ON "pt_bookings"("trainer_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "pt_bookings_member_id_starts_at_idx" ON "pt_bookings"("member_id", "starts_at");

-- CreateIndex
CREATE INDEX "pt_bookings_subscription_id_status_idx" ON "pt_bookings"("subscription_id", "status");

-- CreateIndex
CREATE INDEX "pt_bookings_quota_id_idx" ON "pt_bookings"("quota_id");

-- CreateIndex
CREATE INDEX "pt_bookings_availability_id_idx" ON "pt_bookings"("availability_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_previous_subscription_id_fkey" FOREIGN KEY ("previous_subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_quotas" ADD CONSTRAINT "subscription_quotas_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_quotas" ADD CONSTRAINT "subscription_quotas_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_freezes" ADD CONSTRAINT "subscription_freezes_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_freezes" ADD CONSTRAINT "subscription_freezes_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_transactions" ADD CONSTRAINT "quota_transactions_quota_id_subscription_id_fkey" FOREIGN KEY ("quota_id", "subscription_id") REFERENCES "subscription_quotas"("id", "subscription_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_transactions" ADD CONSTRAINT "quota_transactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_transactions" ADD CONSTRAINT "quota_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_subscription_id_member_id_fkey" FOREIGN KEY ("subscription_id", "member_id") REFERENCES "subscriptions"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_quota_id_subscription_id_fkey" FOREIGN KEY ("quota_id", "subscription_id") REFERENCES "subscription_quotas"("id", "subscription_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "class_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_subscription_id_member_id_fkey" FOREIGN KEY ("subscription_id", "member_id") REFERENCES "subscriptions"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_quota_id_subscription_id_fkey" FOREIGN KEY ("quota_id", "subscription_id") REFERENCES "subscription_quotas"("id", "subscription_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_availability" ADD CONSTRAINT "pt_availability_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_subscription_id_member_id_fkey" FOREIGN KEY ("subscription_id", "member_id") REFERENCES "subscriptions"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_quota_id_subscription_id_fkey" FOREIGN KEY ("quota_id", "subscription_id") REFERENCES "subscription_quotas"("id", "subscription_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_availability_id_trainer_id_fkey" FOREIGN KEY ("availability_id", "trainer_id") REFERENCES "pt_availability"("id", "trainer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants that Prisma schema cannot express.
ALTER TABLE "membership_plans" ADD CONSTRAINT "plans_valid_terms" CHECK ("duration_days" > 0 AND "price" >= 0);
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "entitlements_nonnegative" CHECK ("allocated" IS NULL OR "allocated" >= 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_valid_terms" CHECK ("end_date" > "start_date" AND "agreed_price" >= 0 AND ("previous_subscription_id" IS NULL OR "previous_subscription_id" <> "id"));
ALTER TABLE "subscription_quotas" ADD CONSTRAINT "quota_valid_balances" CHECK ("reserved" >= 0 AND "used" >= 0 AND ("allocated" IS NULL OR ("allocated" >= 0 AND "reserved" + "used" <= "allocated")));
ALTER TABLE "subscription_freezes" ADD CONSTRAINT "freeze_valid_period" CHECK ("ends_at" > "starts_at" AND "freeze_days" > 0);
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "checkins" ADD CONSTRAINT "checkin_valid_result" CHECK (("status" = 'ACCEPTED' AND "subscription_id" IS NOT NULL AND "quota_id" IS NOT NULL AND "rejection_reason" IS NULL) OR ("status" = 'REJECTED' AND length(trim("rejection_reason")) > 0 AND "rejection_reason" IS NOT NULL));
ALTER TABLE "checkins" ADD CONSTRAINT "checkin_quota_has_subscription" CHECK ("quota_id" IS NULL OR "subscription_id" IS NOT NULL);
ALTER TABLE "class_schedules" ADD CONSTRAINT "schedule_valid_period_capacity" CHECK ("ends_at" > "starts_at" AND "capacity" > 0);
ALTER TABLE "pt_availability" ADD CONSTRAINT "availability_valid_period" CHECK ("ends_at" > "starts_at");
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_booking_valid_period" CHECK ("ends_at" > "starts_at");
