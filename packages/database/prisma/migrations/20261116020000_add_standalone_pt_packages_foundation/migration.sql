-- Additive foundation for standalone PT packages and controlled legacy PT conversion.
-- Pure DDL only: no eager backfill or catalog seed rows are written by this migration.

-- CreateEnum
CREATE TYPE "PtPurchaseOrigin" AS ENUM ('STANDALONE', 'LEGACY_BUNDLED');

-- CreateEnum
CREATE TYPE "PtPurchaseStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "pt_package_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "session_count" INTEGER NOT NULL,
    "session_minutes" INTEGER NOT NULL DEFAULT 60,
    "price" DECIMAL(14,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pt_package_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pt_package_purchases" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "origin" "PtPurchaseOrigin" NOT NULL,
    "pt_plan_id" UUID,
    "source_subscription_id" UUID,
    "legacy_quota_id" UUID,
    "package_code_snapshot" TEXT,
    "package_name_snapshot" TEXT NOT NULL,
    "session_count_snapshot" INTEGER,
    "session_minutes_snapshot" INTEGER NOT NULL DEFAULT 60,
    "allocated" INTEGER,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "used" INTEGER NOT NULL DEFAULT 0,
    "agreed_price" DECIMAL(14,2),
    "currency" VARCHAR(3),
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "status" "PtPurchaseStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "original_start_date" TIMESTAMPTZ(3),
    "original_end_date" TIMESTAMPTZ(3),
    "cutover_at" TIMESTAMPTZ(3),
    "cutover_eligible" BOOLEAN,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pt_package_purchases_pkey" PRIMARY KEY ("id")
);

-- AlterTable: additive nullable PT purchase link while keeping existing required fields intact.
ALTER TABLE "payment_records" ADD COLUMN "pt_purchase_id" UUID;

-- AlterTable
ALTER TABLE "quota_transactions" ADD COLUMN "pt_purchase_id" UUID;

-- AlterTable
ALTER TABLE "pt_bookings" ADD COLUMN "pt_purchase_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "pt_package_plans_code_key" ON "pt_package_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pt_package_purchases_source_subscription_id_key" ON "pt_package_purchases"("source_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "pt_package_purchases_legacy_quota_id_key" ON "pt_package_purchases"("legacy_quota_id");

-- CreateIndex
CREATE UNIQUE INDEX "pt_package_purchases_id_member_id_key" ON "pt_package_purchases"("id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "pt_package_purchases_id_legacy_quota_id_key" ON "pt_package_purchases"("id", "legacy_quota_id");

-- CreateIndex
CREATE UNIQUE INDEX "pt_package_purchases_id_legacy_source_key" ON "pt_package_purchases"("id", "legacy_quota_id", "source_subscription_id");

-- CreateIndex
CREATE INDEX "pt_package_purchases_member_id_status_idx" ON "pt_package_purchases"("member_id", "status");

-- CreateIndex
CREATE INDEX "pt_package_purchases_member_id_origin_status_idx" ON "pt_package_purchases"("member_id", "origin", "status");

-- CreateIndex
CREATE INDEX "pt_package_purchases_pt_plan_id_idx" ON "pt_package_purchases"("pt_plan_id");

-- CreateIndex
CREATE INDEX "pt_package_purchases_created_by_idx" ON "pt_package_purchases"("created_by");

-- Enforce at most one open standalone PT purchase per member, including pending payments and reserved>0 lifecycles.
CREATE UNIQUE INDEX "pt_package_purchases_one_open_standalone_idx"
ON "pt_package_purchases"("member_id")
WHERE "origin" = 'STANDALONE' AND "status" IN ('PENDING_PAYMENT', 'ACTIVE');

-- CreateIndex
CREATE INDEX "payment_records_pt_purchase_id_status_idx" ON "payment_records"("pt_purchase_id", "status");

-- CreateIndex
CREATE INDEX "quota_transactions_pt_purchase_id_created_at_idx" ON "quota_transactions"("pt_purchase_id", "created_at");

-- CreateIndex
CREATE INDEX "pt_bookings_pt_purchase_id_status_idx" ON "pt_bookings"("pt_purchase_id", "status");

-- AddForeignKey
ALTER TABLE "pt_package_purchases" ADD CONSTRAINT "pt_package_purchases_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "member_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_package_purchases" ADD CONSTRAINT "pt_package_purchases_pt_plan_id_fkey"
FOREIGN KEY ("pt_plan_id") REFERENCES "pt_package_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_package_purchases" ADD CONSTRAINT "pt_package_purchases_source_subscription_id_member_id_fkey"
FOREIGN KEY ("source_subscription_id", "member_id") REFERENCES "subscriptions"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_package_purchases" ADD CONSTRAINT "pt_package_purchases_legacy_quota_id_source_subscription_id_fkey"
FOREIGN KEY ("legacy_quota_id", "source_subscription_id") REFERENCES "subscription_quotas"("id", "subscription_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_package_purchases" ADD CONSTRAINT "pt_package_purchases_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_pt_purchase_id_fkey"
FOREIGN KEY ("pt_purchase_id") REFERENCES "pt_package_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_transactions" ADD CONSTRAINT "quota_transactions_pt_purchase_id_fkey"
FOREIGN KEY ("pt_purchase_id") REFERENCES "pt_package_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: when quota_id, subscription_id, and pt_purchase_id are all present, enforce exact legacy source match.
ALTER TABLE "quota_transactions" ADD CONSTRAINT "quota_transactions_purchase_legacy_source_fkey"
FOREIGN KEY ("pt_purchase_id", "quota_id", "subscription_id") REFERENCES "pt_package_purchases"("id", "legacy_quota_id", "source_subscription_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_pt_purchase_id_member_id_fkey"
FOREIGN KEY ("pt_purchase_id", "member_id") REFERENCES "pt_package_purchases"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: when quota_id and pt_purchase_id are both present, enforce exact legacy quota match.
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_pt_purchase_id_quota_id_fkey"
FOREIGN KEY ("pt_purchase_id", "quota_id") REFERENCES "pt_package_purchases"("id", "legacy_quota_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants (explicit IS NOT NULL / IS NULL guards prevent SQL three-valued UNKNOWN bypasses).
ALTER TABLE "pt_package_plans" ADD CONSTRAINT "pt_package_plans_valid_terms" CHECK (
  length(btrim("code")) > 0
  AND length(btrim("name")) > 0
  AND "session_count" > 0
  AND "session_minutes" = 60
  AND "price" >= 0
);

ALTER TABLE "pt_package_purchases" ADD CONSTRAINT "pt_package_purchases_origin_shape" CHECK (
  (
    "origin" = 'STANDALONE'
    AND "pt_plan_id" IS NOT NULL
    AND "source_subscription_id" IS NULL
    AND "legacy_quota_id" IS NULL
    AND "package_code_snapshot" IS NOT NULL
    AND length(btrim("package_code_snapshot")) > 0
    AND length(btrim("package_name_snapshot")) > 0
    AND "session_minutes_snapshot" = 60
    AND "session_count_snapshot" IS NOT NULL
    AND "session_count_snapshot" > 0
    AND "allocated" IS NOT NULL
    AND "allocated" > 0
    AND "agreed_price" IS NOT NULL
    AND "agreed_price" >= 0
    AND "currency" IS NOT NULL
    AND "currency" = 'VND'
    AND "original_start_date" IS NULL
    AND "original_end_date" IS NULL
    AND "cutover_at" IS NULL
    AND "cutover_eligible" IS NULL
  )
  OR (
    "origin" = 'LEGACY_BUNDLED'
    AND "pt_plan_id" IS NULL
    AND "source_subscription_id" IS NOT NULL
    AND "legacy_quota_id" IS NOT NULL
    AND ("package_code_snapshot" IS NULL OR ("package_code_snapshot" IS NOT NULL AND length(btrim("package_code_snapshot")) > 0))
    AND length(btrim("package_name_snapshot")) > 0
    AND "session_minutes_snapshot" > 0
    AND (
      ("allocated" IS NULL AND "session_count_snapshot" IS NULL)
      OR (
        "allocated" IS NOT NULL
        AND "allocated" >= 0
        AND "session_count_snapshot" IS NOT NULL
        AND "session_count_snapshot" >= 0
      )
    )
    AND "agreed_price" IS NULL
    AND "currency" IS NULL
    AND "original_start_date" IS NOT NULL
    AND "original_end_date" IS NOT NULL
    AND "original_end_date" > "original_start_date"
    AND "cutover_at" IS NOT NULL
    AND "cutover_eligible" IS NOT NULL
  )
);

ALTER TABLE "pt_package_purchases" ADD CONSTRAINT "pt_package_purchases_valid_balances" CHECK (
  "reserved" >= 0
  AND "used" >= 0
  AND (
    "allocated" IS NULL
    OR ("allocated" IS NOT NULL AND "allocated" >= 0 AND "reserved" + "used" <= "allocated")
  )
);

ALTER TABLE "pt_package_purchases" ADD CONSTRAINT "pt_package_purchases_valid_lifecycle" CHECK (
  NOT (
    "origin" = 'LEGACY_BUNDLED'
    AND "allocated" IS NOT NULL
    AND "allocated" = 0
    AND "cutover_eligible" IS NOT NULL
    AND "cutover_eligible" = true
  )
  AND (
    (
      "status" = 'PENDING_PAYMENT'
      AND "payment_status" = 'PENDING'
      AND ("origin" <> 'STANDALONE' OR ("reserved" = 0 AND "used" = 0))
      AND ("origin" <> 'LEGACY_BUNDLED' OR ("cutover_eligible" IS NOT NULL AND "cutover_eligible" = true))
    )
    OR (
      "status" = 'ACTIVE'
      AND "payment_status" = 'PAID'
      AND ("allocated" IS NULL OR ("allocated" IS NOT NULL AND ("used" < "allocated" OR "reserved" > 0)))
      AND ("origin" <> 'LEGACY_BUNDLED' OR ("cutover_eligible" IS NOT NULL AND "cutover_eligible" = true))
    )
    OR (
      "status" = 'EXHAUSTED'
      AND "allocated" IS NOT NULL
      AND "reserved" = 0
      AND "used" = "allocated"
    )
    OR (
      "status" = 'EXPIRED'
      AND "origin" = 'LEGACY_BUNDLED'
      AND (("cutover_eligible" IS NOT NULL AND "cutover_eligible" = false) OR "allocated" IS NULL)
    )
    OR (
      "status" = 'CANCELLED'
      AND ("origin" <> 'STANDALONE' OR "reserved" = 0)
    )
    OR (
      "status" = 'REFUNDED'
      AND "payment_status" = 'REFUNDED'
      AND ("origin" <> 'STANDALONE' OR "reserved" = 0)
    )
  )
);

ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_valid_credit_source" CHECK (
  "quota_id" IS NOT NULL OR "pt_purchase_id" IS NOT NULL
);

ALTER TABLE "quota_transactions" ADD CONSTRAINT "quota_transactions_valid_source_links" CHECK (
  ("quota_id" IS NOT NULL AND "subscription_id" IS NOT NULL)
  OR ("pt_purchase_id" IS NOT NULL AND "quota_id" IS NULL AND "subscription_id" IS NULL)
);

ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_single_target_xor" CHECK (
  ("subscription_id" IS NOT NULL) <> ("pt_purchase_id" IS NOT NULL)
);
