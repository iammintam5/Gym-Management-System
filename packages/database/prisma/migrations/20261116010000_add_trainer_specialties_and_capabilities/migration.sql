-- AlterTable
ALTER TABLE "employee_profiles"
  ADD COLUMN "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "can_teach_classes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "can_coach_pt" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing TRAINER employees to preserve both service capabilities
-- and seed structured specialties from nonempty specialization text without guessing disciplines.
UPDATE "employee_profiles" AS ep
SET
  "can_teach_classes" = true,
  "can_coach_pt" = true,
  "specialties" = CASE
    WHEN ep."specialization" IS NOT NULL AND btrim(ep."specialization") <> ''
      THEN ARRAY[btrim(ep."specialization")]
    ELSE ARRAY[]::TEXT[]
  END
WHERE EXISTS (
  SELECT 1
  FROM "user_roles" AS ur
  INNER JOIN "roles" AS r ON r."id" = ur."role_id"
  WHERE ur."user_id" = ep."user_id"
    AND r."code"::text = 'TRAINER'
);
