-- CreateTable
CREATE TABLE "RiskAlert" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "intake" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "timePct" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uupdatedAt" TIMESTAMP(3),

    CONSTRAINT "RiskAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskAlert_moduleCode_intake_year_idx" ON "RiskAlert"("moduleCode", "intake", "year");

-- CreateIndex
CREATE INDEX "RiskAlert_studentId_idx" ON "RiskAlert"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAlert_studentId_moduleCode_intake_year_sessionCount_key" ON "RiskAlert"("studentId", "moduleCode", "intake", "year", "sessionCount");

-- AddForeignKey
ALTER TABLE "RiskAlert" ADD CONSTRAINT "RiskAlert_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
