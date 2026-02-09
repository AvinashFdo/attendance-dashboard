import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ModuleRow = {
  ModuleCode?: string | number;
  ModuleName?: string | number;
  Program?: string | number;
};

type ModuleOption = {
  code: string;
  name: string;
  program: string | null; // aggregated: "Prog1, Prog2"
};

function toStr(v: string | number | undefined): string {
  return String(v ?? "").trim();
}
function normCode(v: string): string {
  return v.trim().toUpperCase();
}
function normProgram(v: string): string {
  return v.trim();
}

/**
 * GET /api/import/modules
 * Returns modules for dropdown
 */
export async function GET() {
  try {
    const modules = await prisma.module.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        programs: {
          select: {
            program: { select: { name: true } },
          },
        },
      },
    });

    const result: ModuleOption[] = modules.map((m) => {
      const names = m.programs
        .map((x) => x.program.name)
        .filter((n) => typeof n === "string" && n.length > 0)
        .sort((a, b) => a.localeCompare(b));

      return {
        code: m.code,
        name: m.name,
        program: names.length ? names.join(", ") : null,
      };
    });

    return NextResponse.json({ ok: true, modules: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load modules";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/import/modules
 * Imports Module Master XLSX with duplicates (same module in multiple programs)
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded (field name must be 'file')" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json<ModuleRow>(ws, { defval: "" });

    let rowsRead = 0;
    let skipped = 0;

    let modulesCreated = 0;
    let modulesUpdated = 0;
    let programsCreated = 0;
    let linksCreated = 0;

    // Skip exact duplicate “module+program” rows within the same upload
    const seenRowKeys = new Set<string>();

    for (const r of rows) {
      rowsRead++;

      const code = normCode(toStr(r.ModuleCode));
      const name = toStr(r.ModuleName);
      const programName = normProgram(toStr(r.Program));

      if (!code || !name || !programName) {
        skipped++;
        continue;
      }

      const rowKey = `${code}||${programName.toLowerCase()}`;
      if (seenRowKeys.has(rowKey)) {
        skipped++;
        continue;
      }
      seenRowKeys.add(rowKey);

      // 1) Upsert Module (code is unique)
      const existingModule = await prisma.module.findUnique({
        where: { code },
        select: { code: true, name: true },
      });

      await prisma.module.upsert({
        where: { code },
        update: { name },
        create: { code, name },
      });

      if (existingModule) {
        if (existingModule.name !== name) modulesUpdated++;
      } else {
        modulesCreated++;
      }

      // 2) Upsert Program
      const existingProgram = await prisma.program.findUnique({
        where: { name: programName },
        select: { id: true },
      });

      const program =
        existingProgram ??
        (await prisma.program.create({
          data: { name: programName },
          select: { id: true },
        }));

      if (!existingProgram) programsCreated++;

      // 3) Create ProgramModule link (unique [programId, moduleCode])
      const existingLink = await prisma.programModule.findUnique({
        where: {
          programId_moduleCode: {
            programId: program.id,
            moduleCode: code,
          },
        },
        select: { id: true },
      });

      if (!existingLink) {
        await prisma.programModule.create({
          data: {
            programId: program.id,
            moduleCode: code,
          },
        });
        linksCreated++;
      }
    }

    return NextResponse.json({
      ok: true,
      rowsRead,
      skipped,
      modulesCreated,
      modulesUpdated,
      programsCreated,
      linksCreated,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}