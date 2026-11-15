CREATE TABLE "member_face_descriptors" (
  "member_id" UUID PRIMARY KEY REFERENCES "member_profiles"("id") ON DELETE CASCADE,
  "model_version" TEXT NOT NULL,
  "photo_version" TEXT NOT NULL,
  "descriptor" DOUBLE PRECISION[] NOT NULL,
  "mirrored_descriptor" DOUBLE PRECISION[] NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "face_descriptor_dimensions" CHECK (
    cardinality("descriptor") = 128 AND cardinality("mirrored_descriptor") = 128
  )
);
