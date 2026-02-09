import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import iconv from "iconv-lite";

const prisma = new PrismaClient();

function parseModuleCodeFromFilename(name: string): string | null {
  const m = name.match(/\b[A-Z]{2}\d{4}NU\b/i);
  return m ? m[0].toUpperCase() : null;
}

function parseMinutes(value: string): number | null {
  const v = value.trim();
  if (!v) return null;

  // HH:MM:SS
  const hms = v.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) {
    const h = Number(hms[1]);
    const m = Number(hms[2]);
    const s = Number(hms[3]);
    return Math.round(h * 60 + m + s / 60);
  }

  // "2h 25m", "2h25m", "49m 21s", "1h", "55m"
  const hr = v.match(/(\d+)\s*h/i);
  const mr = v.match(/(\d+)\s*m/i);
  const sr = v.match(/(\d+)\s*s/i);

  let mins = 0;
  if (hr) mins += Number(hr[1]) * 60;
  if (mr) mins += Number(mr[1]);
  if (sr) mins += Number(sr[1]) / 60;

  if (mins > 0) return Math.round(mins);

  const n = Number(v);
  if (!Number.isNaN(n)) return Math.round(n);

  return null;
}

function parseDate(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function findIndex(
  lines: string[],
  predicate: (line: string) => boolean,
  start = 0
): number {
  for (let i = start; i < lines.length; i++) {
    if (predicate(lines[i])) return i;
  }
  return -1;
}

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

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    const intakeRaw = String(form.get("intake") ?? "");
    const yearRaw = String(form.get("year") ?? "");
    const moduleFromFormRaw = String(form.get("moduleCode") ?? "");

    const intake = normIntake(intakeRaw);
    const year = Number(yearRaw);

    if (!intake || !year || Number.isNaN(year)) {
      return NextResponse.json(
        { error: "Missing or invalid intake/year. Please select Intake + Year." },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // ✅ Prefer posted moduleCode; fallback to filename only if missing
    const moduleFromForm = normModuleCode(moduleFromFormRaw);
    const moduleFromFilename = parseModuleCodeFromFilename(file.name);
    const moduleCode = moduleFromForm || moduleFromFilename;

    if (!moduleCode) {
      return NextResponse.json(
        {
          error:
            "Missing Module Code. Please select a Module Code (or include it in the filename).",
        },
        { status: 400 }
      );
    }

    // Teams export is typically UTF-16 LE + tab-separated
    const buf = Buffer.from(await file.arrayBuffer());
    const text = iconv.decode(buf, "utf16-le");
    const lines = text.split(/\r?\n/);

    // ---------- 1) Summary (for sessionKey) ----------
    const summary: Record<string, string> = {};
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const key = parts[0]?.trim();
        const val = parts[1]?.trim();
        if (key && val) summary[key] = val;
      }
      if (line.trim() === "2. Participants") break;
    }

    const meetingName = summary["Meeting title"] ?? null;
    const startTime = parseDate(summary["Start time"] ?? "");
    const endTime = parseDate(summary["End time"] ?? "");

    const durationMin =
      parseMinutes(summary["Meeting duration"] ?? "") ??
      parseMinutes(summary["Duration"] ?? "") ??
      null;

    // cohort-aware sessionKey (prevents cross-intake collisions)
    const sessionKey =
      `${intake}|${year}|${moduleCode}|${startTime?.toISOString() ?? ""}|${
        endTime?.toISOString() ?? ""
      }|${meetingName ?? ""}`.toLowerCase();

    // ✅ Ensure module exists (NEW schema: Module has NO "program" field)
    await prisma.module.upsert({
      where: { code: moduleCode },
      update: {},
      create: { code: moduleCode, name: moduleCode },
    });

    const session = await prisma.session.upsert({
      where: { sessionKey },
      update: { meetingName, startTime, endTime, durationMin, intake, year, moduleCode },
      create: {
        sessionKey,
        moduleCode,
        meetingName,
        startTime,
        endTime,
        durationMin,
        intake,
        year,
      },
    });

    // ---------- 2) STRICTLY parse Section 2 only ----------
    const idxSection2 = findIndex(lines, (l) => l.trim() === "2. Participants");
    if (idxSection2 === -1) {
      return NextResponse.json(
        { error: "Could not find '2. Participants' section." },
        { status: 400 }
      );
    }

    const idxSection3 = findIndex(
      lines,
      (l) => /^3\.\s*In-Meeting Activities/i.test(l.trim()),
      idxSection2 + 1
    );
    const section2End = idxSection3 === -1 ? lines.length : idxSection3;

    const headerIndex = findIndex(
      lines,
      (l) =>
        l.startsWith("Name\t") &&
        l.includes("\tEmail\t") &&
        l.includes("In-Meeting Duration"),
      idxSection2 + 1
    );

    if (headerIndex === -1 || headerIndex >= section2End) {
      return NextResponse.json(
        {
          error:
            "Could not find Participants table header for Section 2 (with 'In-Meeting Duration').",
        },
        { status: 400 }
      );
    }

    const header = lines[headerIndex].split("\t").map((h) => h.trim());
    const colIndex = (name: string) => header.findIndex((h) => h === name);

    const idxName = colIndex("Name");
    const idxEmail = colIndex("Email");
    const idxFirstJoin = colIndex("First Join");
    const idxLastLeave = colIndex("Last Leave");
    const idxDuration = colIndex("In-Meeting Duration");
    const idxRole = colIndex("Role");

    if (idxName === -1 || idxEmail === -1 || idxDuration === -1) {
      return NextResponse.json(
        {
          error:
            "Missing required columns in Section 2 (need Name, Email, In-Meeting Duration).",
        },
        { status: 400 }
      );
    }

    let rowsRead = 0;
    let attendanceUpserted = 0;
    let eligibleCount = 0;

    for (let i = headerIndex + 1; i < section2End; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const parts = line.split("\t");
      if (parts.length < 2) continue;

      const name = (parts[idxName] ?? "").trim() || null;
      const emailRaw = (parts[idxEmail] ?? "").trim();
      const email = emailRaw.toLowerCase();

      rowsRead++;

      const student = await prisma.student.upsert({
        where: { email: email || `unknown-${i}@invalid.local` },
        update: { name: name ?? undefined },
        create: { email: email || `unknown-${i}@invalid.local`, name },
      });

      const isEligible = email.endsWith("@stu.nexteducationgroup.com");
      if (isEligible) eligibleCount++;

      const firstJoin =
        idxFirstJoin >= 0 ? parseDate(parts[idxFirstJoin] ?? "") : null;
      const lastLeave =
        idxLastLeave >= 0 ? parseDate(parts[idxLastLeave] ?? "") : null;

      const minutes = parseMinutes(parts[idxDuration] ?? "");
      const role = idxRole >= 0 ? (parts[idxRole] ?? "").trim() || null : null;

      await prisma.attendance.upsert({
        where: {
          sessionId_studentId: { sessionId: session.id, studentId: student.id },
        },
        update: { emailRaw, firstJoin, lastLeave, minutes, role, isEligible },
        create: {
          sessionId: session.id,
          studentId: student.id,
          emailRaw,
          firstJoin,
          lastLeave,
          minutes,
          role,
          isEligible,
        },
      });

      attendanceUpserted++;
    }

    return NextResponse.json({
      ok: true,
      moduleCode,
      intake,
      year,
      sessionId: session.id,
      rowsRead,
      attendanceUpserted,
      eligibleCount,
      durationMin,
      sourceUsed: "section2_only",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}