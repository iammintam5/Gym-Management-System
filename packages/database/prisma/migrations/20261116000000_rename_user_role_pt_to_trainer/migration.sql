-- AlterEnum
ALTER TYPE "UserRole" RENAME VALUE 'PT' TO 'TRAINER';

-- Update role display names while preserving role IDs, user_roles assignments, and auth_sessions
UPDATE "roles"
SET "name" = CASE "code"::text
  WHEN 'ADMIN' THEN 'Quản trị viên'
  WHEN 'STAFF' THEN 'Nhân viên'
  WHEN 'TRAINER' THEN 'Huấn luyện viên'
  WHEN 'MEMBER' THEN 'Hội viên'
  ELSE "name"
END
WHERE "code"::text = 'TRAINER'
   OR "name" IN ('ADMIN', 'STAFF', 'PT', 'TRAINER', 'MEMBER');
