-- Additive: existing subscriptions remain unassigned until Staff/Admin explicitly assigns a PT.
-- Do not infer a fixed trainer from historical appointments or rewrite purchased rights.
ALTER TABLE "subscriptions"
  ADD COLUMN "assigned_trainer_id" UUID,
  ADD COLUMN "pt_assignment_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_assigned_trainer_id_fkey"
  FOREIGN KEY ("assigned_trainer_id") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_pt_assignment_version_check" CHECK ("pt_assignment_version" >= 0);
CREATE INDEX "subscriptions_assigned_trainer_id_end_date_idx" ON "subscriptions"("assigned_trainer_id", "end_date");
