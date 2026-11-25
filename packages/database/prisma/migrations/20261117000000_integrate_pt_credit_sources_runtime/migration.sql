-- Batch 3C: Separate PT credit source subscription from covering Gym subscription,
-- and enable nullable legacy links for standalone PT bookings, transactions, and payments
-- while preserving strict member/source composite ownership invariants.

-- 1. Separate credit source subscription from covering Gym subscription on pt_bookings
ALTER TABLE "pt_bookings" ADD COLUMN "source_subscription_id" UUID;

-- Backfill existing pre-3C PT bookings from their referenced legacy SubscriptionQuota
UPDATE "pt_bookings" AS pb
SET "source_subscription_id" = sq."subscription_id"
FROM "subscription_quotas" AS sq
WHERE pb."quota_id" = sq."id"
  AND pb."source_subscription_id" IS NULL;

-- Drop old conflated FK (quota_id, subscription_id) and allow nullable quota_id for standalone PT bookings
ALTER TABLE "pt_bookings" DROP CONSTRAINT "pt_bookings_quota_id_subscription_id_fkey";
ALTER TABLE "pt_bookings" ALTER COLUMN "quota_id" DROP NOT NULL;

-- 2. Allow nullable legacy quota/subscription links on quota_transactions and payment_records for standalone PT
ALTER TABLE "quota_transactions" ALTER COLUMN "quota_id" DROP NOT NULL;
ALTER TABLE "quota_transactions" ALTER COLUMN "subscription_id" DROP NOT NULL;
ALTER TABLE "payment_records" ALTER COLUMN "subscription_id" DROP NOT NULL;

-- 3. Index & owner-consistent composite FKs on pt_bookings
CREATE INDEX "pt_bookings_source_subscription_id_status_idx" ON "pt_bookings"("source_subscription_id", "status");

ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_source_subscription_id_member_id_fkey"
FOREIGN KEY ("source_subscription_id", "member_id") REFERENCES "subscriptions"("id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_quota_id_source_subscription_id_fkey"
FOREIGN KEY ("quota_id", "source_subscription_id") REFERENCES "subscription_quotas"("id", "subscription_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_purchase_legacy_source_fkey"
FOREIGN KEY ("pt_purchase_id", "quota_id", "source_subscription_id") REFERENCES "pt_package_purchases"("id", "legacy_quota_id", "source_subscription_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Strengthen credit source shape invariant on pt_bookings (explicit IS NOT NULL / IS NULL guards)
ALTER TABLE "pt_bookings" DROP CONSTRAINT "pt_bookings_valid_credit_source";
ALTER TABLE "pt_bookings" ADD CONSTRAINT "pt_bookings_valid_credit_source" CHECK (
  (
    "quota_id" IS NOT NULL
    AND "source_subscription_id" IS NOT NULL
  )
  OR (
    "pt_purchase_id" IS NOT NULL
    AND "quota_id" IS NULL
    AND "source_subscription_id" IS NULL
  )
);

-- 5. Enforce cross-row origin consistency (prevent LEGACY_BUNDLED purchase with NULL legacy links)
-- and preserve compatibility for legacy single-subscription inserts when quota_id is provided.
CREATE OR REPLACE FUNCTION "pt_bookings_enforce_credit_source_integrity"()
RETURNS TRIGGER AS $$
DECLARE
  v_origin "PtPurchaseOrigin";
BEGIN
  IF TG_OP = 'INSERT' AND NEW."source_subscription_id" IS NULL AND NEW."quota_id" IS NOT NULL THEN
    NEW."source_subscription_id" := NEW."subscription_id";
  END IF;

  IF NEW."pt_purchase_id" IS NOT NULL AND (NEW."quota_id" IS NULL OR NEW."source_subscription_id" IS NULL) THEN
    SELECT "origin" INTO v_origin
    FROM "pt_package_purchases"
    WHERE "id" = NEW."pt_purchase_id";

    IF v_origin = 'LEGACY_BUNDLED' THEN
      RAISE EXCEPTION 'LEGACY_BUNDLED PT purchase booking must specify quota_id and source_subscription_id'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pt_bookings_credit_source_integrity_trg"
BEFORE INSERT OR UPDATE ON "pt_bookings"
FOR EACH ROW
EXECUTE FUNCTION "pt_bookings_enforce_credit_source_integrity"();

CREATE OR REPLACE FUNCTION "quota_transactions_enforce_credit_source_integrity"()
RETURNS TRIGGER AS $$
DECLARE
  v_origin "PtPurchaseOrigin";
BEGIN
  IF NEW."pt_purchase_id" IS NOT NULL AND (NEW."quota_id" IS NULL OR NEW."subscription_id" IS NULL) THEN
    SELECT "origin" INTO v_origin
    FROM "pt_package_purchases"
    WHERE "id" = NEW."pt_purchase_id";

    IF v_origin = 'LEGACY_BUNDLED' THEN
      RAISE EXCEPTION 'LEGACY_BUNDLED PT purchase transaction must specify quota_id and subscription_id'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quota_transactions_credit_source_integrity_trg"
BEFORE INSERT OR UPDATE ON "quota_transactions"
FOR EACH ROW
EXECUTE FUNCTION "quota_transactions_enforce_credit_source_integrity"();
