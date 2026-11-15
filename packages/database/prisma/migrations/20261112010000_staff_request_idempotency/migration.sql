CREATE TABLE "staff_requests" (
  "idempotency_key" UUID PRIMARY KEY,
  "operation" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
