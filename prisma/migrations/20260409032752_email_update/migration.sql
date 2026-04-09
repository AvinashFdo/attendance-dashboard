/*
  Warnings:

  - You are about to drop the column `uupdatedAt` on the `RiskAlert` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[studentId,moduleCode,intake,year,alertType,milestone]` on the table `RiskAlert` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[studentId,moduleCode,intake,year,alertType,triggerSessionId]` on the table `RiskAlert` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "RiskAlert_moduleCode_intake_year_idx";

-- DropIndex
DROP INDEX "RiskAlert_studentId_idx";

-- DropIndex
DROP INDEX "RiskAlert_studentId_moduleCode_intake_year_sessionCount_key";

-- AlterTable
ALTER TABLE "RiskAlert" DROP COLUMN "uupdatedAt",
ADD COLUMN     "alertType" TEXT NOT NULL DEFAULT 'student_threshold',
ADD COLUMN     "milestone" INTEGER,
ADD COLUMN     "triggerSessionId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "sessionCount" DROP NOT NULL,
ALTER COLUMN "timePct" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RiskAlert_studentId_moduleCode_intake_year_alertType_milest_key" ON "RiskAlert"("studentId", "moduleCode", "intake", "year", "alertType", "milestone");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAlert_studentId_moduleCode_intake_year_alertType_trigge_key" ON "RiskAlert"("studentId", "moduleCode", "intake", "year", "alertType", "triggerSessionId");
