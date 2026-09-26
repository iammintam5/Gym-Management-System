-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- AlterTable
ALTER TABLE "member_profiles" ADD COLUMN     "gender" "Gender",
ADD COLUMN     "id_photo_url" TEXT;
