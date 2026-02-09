/*
  Warnings:

  - You are about to drop the column `program` on the `Module` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Module" DROP COLUMN "program";

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramModule" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,

    CONSTRAINT "ProgramModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Program_name_key" ON "Program"("name");

-- CreateIndex
CREATE INDEX "ProgramModule_moduleCode_idx" ON "ProgramModule"("moduleCode");

-- CreateIndex
CREATE INDEX "ProgramModule_programId_idx" ON "ProgramModule"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramModule_programId_moduleCode_key" ON "ProgramModule"("programId", "moduleCode");

-- AddForeignKey
ALTER TABLE "ProgramModule" ADD CONSTRAINT "ProgramModule_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramModule" ADD CONSTRAINT "ProgramModule_moduleCode_fkey" FOREIGN KEY ("moduleCode") REFERENCES "Module"("code") ON DELETE CASCADE ON UPDATE CASCADE;
