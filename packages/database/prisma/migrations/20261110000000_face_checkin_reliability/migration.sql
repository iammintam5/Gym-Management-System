BEGIN;
ALTER TABLE "member_profiles" ADD COLUMN "face_photo_version" TEXT;
UPDATE "member_profiles" SET "face_photo_version" = md5("id_photo_url") WHERE "id_photo_url" IS NOT NULL;
ALTER TABLE "checkins" ADD COLUMN "request_id" TEXT, ADD COLUMN "gate_identifier" TEXT;
CREATE UNIQUE INDEX "checkins_request_id_key" ON "checkins"("request_id");
CREATE TABLE "auth_sessions" (
 "id" UUID PRIMARY KEY, "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "token_hash" TEXT NOT NULL, "expires_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
COMMIT;
