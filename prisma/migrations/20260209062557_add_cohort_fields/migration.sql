/*
  Warnings:

  - You are about to drop the column `cohort` on the `Enrollment` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[studentId,moduleCode,intake,year]` on the table `Enrollment` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `intake` to the `Enrollment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `year` to the `Enrollment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `intake` to the `Session` table without a default value. This is not possible if the table is not empty.
  - Added the required column `year` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Enrollment_studentId_moduleCode_key";

-- AlterTable
ALTER TABLE "Enrollment" DROP COLUMN "cohort",
ADD COLUMN     "intake" TEXT NOT NULL,
ADD COLUMN     "year" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "intake" TEXT NOT NULL,
ADD COLUMN     "year" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_moduleCode_intake_year_key" ON "Enrollment"("studentId", "moduleCode", "intake", "year");

-- CreateIndex
CREATE INDEX "Session_moduleCode_intake_year_idx" ON "Session"("moduleCode", "intake", "year");
