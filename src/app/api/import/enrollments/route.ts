import { NextResponse } from "next/server";
import Papa from "papaparse";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type EnrollmentRow = {
  StudentEmail?: string;
  StudentName?: string;
  Program?: string;
  ModuleCode?: string;
  Intake?: string; // optional
  Year?: string | number; // optional
};

function normIntake(v: string): string {
  const s = v.trim().toLowerCase();
  if (s === "spring") return "Spring";
  if (s === "summer") return "Summer";
  if (s === "autumn" || s === "fall") return "Autumn";
  return v.trim();
}

function normModuleCode(v: string): string {
  return v.trim().toUpperCase();
}

function parseIntakeYearFromFilename(filename: string): { intake: string; year: number } | null {
  // Example: "Spring 2026 ... MN5070NU.csv"
  const m = filename.match(/\b(Spring|Summer|Autumn)\b.*?\b(20\d{2})\b/i);
  if (!m) return null;
  return { intake: normIntake(m[1]), year: Number(m[2]) };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const inferred = parseIntakeYearFromFilename(file.name);

    const text = await file.text();
    const parsed = Papa.parse<EnrollmentRow>(text, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors?.length) {
      return NextResponse.json(
        { error: parsed.errors[0]?.message ?? "CSV parse error" },
        { status: 400 }
      );
    }

    const rows = parsed.data ?? [];

    let studentsUpserted = 0;
    let enrollmentsUpserted = 0;
    let rowsSkipped = 0;

    for (const r of rows) {
      if (!r) continue;

      const email = (r.StudentEmail ?? "").trim().toLowerCase();
      const name = (r.StudentName ?? "").trim() || null;
      const program = (r.Program ?? "").trim() || null;
      const moduleCode = normModuleCode(r.ModuleCode ?? "");

      if (!email || !moduleCode) {
        rowsSkipped++;
        continue;
      }

      // intake/year priority: CSV columns > filename inference
      const intakeRaw = (r.Intake ?? inferred?.intake ?? "").trim();
      const intake = normIntake(intakeRaw);

      const yearRaw = r.Year ?? inferred?.year;
      const year = typeof yearRaw === "string" ? Number(yearRaw) : yearRaw;

      if (!intake || !year || Number.isNaN(year)) {
        rowsSkipped++;
        continue;
      }

      // ✅ Ensure module exists (NEW schema: Module has NO "program" field)
      await prisma.module.upsert({
        where: { code: moduleCode },
        update: {},
        create: { code: moduleCode, name: moduleCode },
      });

      const student = await prisma.student.upsert({
        where: { email },
        update: { name, program },
        create: { email, name, program },
      });
      studentsUpserted++;

      await prisma.enrollment.upsert({
        where: {
          studentId_moduleCode_intake_year: {
            studentId: student.id,
            moduleCode,
            intake,
            year,
          },
        },
        update: {},
        create: {
          studentId: student.id,
          moduleCode,
          intake,
          year,
        },
      });
      enrollmentsUpserted++;
    }

    return NextResponse.json({
      ok: true,
      studentsUpserted,
      enrollmentsUpserted,
      rowsSkipped,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}