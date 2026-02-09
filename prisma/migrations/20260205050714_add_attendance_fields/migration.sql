-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "firstJoin" TIMESTAMP(3),
ADD COLUMN     "lastLeave" TIMESTAMP(3),
ADD COLUMN     "role" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "meetingName" TEXT;
