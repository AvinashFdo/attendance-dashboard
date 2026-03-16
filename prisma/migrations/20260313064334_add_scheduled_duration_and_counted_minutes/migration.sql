-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "countedMinutes" INTEGER,
ADD COLUMN     "rawMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reportedDurationMin" INTEGER,
ADD COLUMN     "scheduledDurationMin" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3);
