import { NextResponse } from "next/server";
import iconv from "iconv-lite";
import { prisma } from "@/lib/prisma";
import {
  buildAttendanceAlertBody,
  buildAttendanceAlertSubject,
  buildManagerConsecutiveAbsenceBody,
  buildManagerConsecutiveAbsenceSubject,
  sendEmail,
} from "@/lib/email";

function parseModuleCodeFromFilename(name: string): string | null {
  const m = name.match(/\b[A-Z]{2}\d{4}NU\b/i);
  return m ? m[0].toUpperCase() : null;
}

function parseMinutes(value: string): number | null {
  const v = value.trim();
  if (!v) return null;

  const hms = v.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) {
    const h = Number(hms[1]);
    const m = Number(hms[2]);
    const s = Number(hms[3]);
    return Math.round(h * 60 + m + s / 60);
  }

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

function clampMinutes(value: number | null, max: number): number | null {
  if (value == null) return null;
  return Math.max(0, Math.min(value, max));
}

function pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    const intakeRaw = String(form.get("intake") ?? "");
    const yearRaw = String(form.get("year") ?? "");
    const moduleFromFormRaw = String(form.get("moduleCode") ?? "");
    const scheduledDurationRaw = String(form.get("scheduledDuration") ?? "");

    const intake = normIntake(intakeRaw);
    const year = Number(yearRaw);
    const scheduledDurationMin = Number(scheduledDurationRaw);

    if (!intake || !year || Number.isNaN(year)) {
      return NextResponse.json(
        { error: "Missing or invalid intake/year. Please select Intake + Year." },
        { status: 400 }
      );
    }

    if (
      !scheduledDurationRaw ||
      Number.isNaN(scheduledDurationMin) ||
      scheduledDurationMin <= 0
    ) {
      return NextResponse.json(
        { error: "Missing or invalid scheduled class duration." },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

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

    const buf = Buffer.from(await file.arrayBuffer());
    const text = iconv.decode(buf, "utf16-le");
    const lines = text.split(/\r?\n/);

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

    const reportedDurationMin =
      parseMinutes(summary["Meeting duration"] ?? "") ??
      parseMinutes(summary["Duration"] ?? "") ??
      null;

    const sessionKey =
      `${intake}|${year}|${moduleCode}|${startTime?.toISOString() ?? ""}|${
        endTime?.toISOString() ?? ""
      }|${meetingName ?? ""}`.toLowerCase();

    await prisma.module.upsert({
      where: { code: moduleCode },
      update: {},
      create: { code: moduleCode, name: moduleCode },
    });

    const session = await prisma.session.upsert({
      where: { sessionKey },
      update: {
        meetingName,
        startTime,
        endTime,
        durationMin: scheduledDurationMin,
        reportedDurationMin,
        scheduledDurationMin,
        intake,
        year,
        moduleCode,
      },
      create: {
        sessionKey,
        moduleCode,
        meetingName,
        startTime,
        endTime,
        durationMin: scheduledDurationMin,
        reportedDurationMin,
        scheduledDurationMin,
        intake,
        year,
      },
    });

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
    let cappedCount = 0;

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

      const rawMinutes = parseMinutes(parts[idxDuration] ?? "");
      const countedMinutes = clampMinutes(rawMinutes, scheduledDurationMin);

      if (
        rawMinutes != null &&
        countedMinutes != null &&
        rawMinutes > countedMinutes
      ) {
        cappedCount++;
      }

      const role = idxRole >= 0 ? (parts[idxRole] ?? "").trim() || null : null;

      await prisma.attendance.upsert({
        where: {
          sessionId_studentId: { sessionId: session.id, studentId: student.id },
        },
        update: {
          emailRaw,
          firstJoin,
          lastLeave,
          minutes: countedMinutes,
          rawMinutes,
          countedMinutes,
          role,
          isEligible,
        },
        create: {
          sessionId: session.id,
          studentId: student.id,
          emailRaw,
          firstJoin,
          lastLeave,
          minutes: countedMinutes,
          rawMinutes,
          countedMinutes,
          role,
          isEligible,
        },
      });

      attendanceUpserted++;
    }

    // ---------- 3) Risk detection + email flow ----------
    let riskEvaluationRun = false;
    let sessionCountForCohort = 0;
    let highRiskCount = 0;
    let alertsCreated = 0;
    let alertsAlreadyExisting = 0;
    let managerAlertsCreated = 0;
    let managerAlertsAlreadyExisting = 0;
    let emailDisabledCount = 0;
    let emailTestModeCount = 0;
    let emailSentCount = 0;
    let emailFailedCount = 0;

    const sessions = await prisma.session.findMany({
      where: { moduleCode, intake, year },
      select: {
        id: true,
        startTime: true,
        scheduledDurationMin: true,
        durationMin: true,
        attendance: {
          where: { isEligible: true },
          select: {
            studentId: true,
            countedMinutes: true,
            minutes: true,
          },
        },
      },
      orderBy: { startTime: "asc" },
    });

    sessionCountForCohort = sessions.length;

    const studentAlertCheckpoints = new Set([3, 6, 9]);

    const moduleRecord = await prisma.module.findUnique({
      where: { code: moduleCode },
      select: {
        name: true,
        programs: {
          select: {
            program: {
              select: { name: true },
            },
          },
        },
      },
    });

    const moduleName = moduleRecord?.name ?? moduleCode;
    const programName =
      moduleRecord?.programs
        ?.map((x) => x.program.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join(", ") || null;

    const enrollments = await prisma.enrollment.findMany({
      where: {
        moduleCode,
        intake,
        year,
        student: {
          email: { endsWith: "@stu.nexteducationgroup.com", mode: "insensitive" },
        },
      },
      select: {
        studentId: true,
        student: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    const enrolledStudentIds = enrollments.map((e) => e.studentId);

    const totalScheduledMin = sessions.reduce((sum, s) => {
      const dur =
        typeof s.scheduledDurationMin === "number" && s.scheduledDurationMin > 0
          ? s.scheduledDurationMin
          : typeof s.durationMin === "number" && s.durationMin > 0
          ? s.durationMin
          : 0;
      return sum + dur;
    }, 0);

    // ---------- 3A) Student threshold alerts at 3 / 6 / 9 ----------
    if (studentAlertCheckpoints.has(sessionCountForCohort)) {
      riskEvaluationRun = true;

      if (enrolledStudentIds.length > 0 && totalScheduledMin > 0) {
        const attendedMap = new Map<string, number>();

        for (const s of sessions) {
          const dur =
            typeof s.scheduledDurationMin === "number" && s.scheduledDurationMin > 0
              ? s.scheduledDurationMin
              : typeof s.durationMin === "number" && s.durationMin > 0
              ? s.durationMin
              : 0;

          for (const a of s.attendance) {
            if (!enrolledStudentIds.includes(a.studentId)) continue;

            const counted =
              typeof a.countedMinutes === "number"
                ? a.countedMinutes
                : typeof a.minutes === "number"
                ? a.minutes
                : 0;

            const safeCounted = Math.max(0, Math.min(counted, dur));
            attendedMap.set(a.studentId, (attendedMap.get(a.studentId) ?? 0) + safeCounted);
          }
        }

        for (const e of enrollments) {
          const attendedMin = attendedMap.get(e.studentId) ?? 0;
          const timePct = pct(attendedMin, totalScheduledMin);

          if (timePct < 70) {
            highRiskCount++;

            const existing = await prisma.riskAlert.findFirst({
              where: {
                studentId: e.studentId,
                moduleCode,
                intake,
                year,
                alertType: "student_threshold",
                milestone: sessionCountForCohort,
              },
            });

            if (existing) {
              alertsAlreadyExisting++;
              continue;
            }

            const createdAlert = await prisma.riskAlert.create({
              data: {
                studentId: e.studentId,
                moduleCode,
                intake,
                year,
                alertType: "student_threshold",
                milestone: sessionCountForCohort,
                sessionCount: sessionCountForCohort,
                timePct,
                status: "pending",
              },
            });

            alertsCreated++;

            const subject = buildAttendanceAlertSubject();

            const text = buildAttendanceAlertBody({
              studentName: e.student.name,
              programName,
              moduleName,
              sessionCount: sessionCountForCohort,
              timePct,
              attendedMin,
              totalMin: totalScheduledMin,
            });

            const emailResult = await sendEmail({
              to: e.student.email,
              subject,
              text,
            });

            if (emailResult.ok) {
              if (emailResult.status === "disabled") {
                emailDisabledCount++;
                await prisma.riskAlert.update({
                  where: { id: createdAlert.id },
                  data: { status: "disabled" },
                });
              } else if (emailResult.status === "test_mode") {
                emailTestModeCount++;
                await prisma.riskAlert.update({
                  where: { id: createdAlert.id },
                  data: { status: "test_mode" },
                });
              } else if (emailResult.status === "sent") {
                emailSentCount++;
                await prisma.riskAlert.update({
                  where: { id: createdAlert.id },
                  data: { status: "sent" },
                });
              }
            } else {
              emailFailedCount++;
              console.error("[email-send-failed]", {
                type: "student_threshold",
                studentEmail: e.student.email,
                moduleCode,
                intake,
                year,
                sessionCount: sessionCountForCohort,
                error: emailResult.error,
              });

              await prisma.riskAlert.update({
                where: { id: createdAlert.id },
                data: { status: "failed" },
              });
            }
          }
        }
      }
    }

    // ---------- 3B) Program manager alert: 2 consecutive absences ----------
    const managerEmail = (process.env.PROGRAM_MANAGER_EMAIL ?? "").trim();

    if (managerEmail && sessions.length >= 2 && enrollments.length > 0) {
      for (const e of enrollments) {
        let prevAbsent: { id: string; date: Date | null } | null = null;

        for (const s of sessions) {
          const dur =
            typeof s.scheduledDurationMin === "number" && s.scheduledDurationMin > 0
              ? s.scheduledDurationMin
              : typeof s.durationMin === "number" && s.durationMin > 0
              ? s.durationMin
              : 0;

          const a = s.attendance.find((x) => x.studentId === e.studentId);

          const counted =
            typeof a?.countedMinutes === "number"
              ? a.countedMinutes
              : typeof a?.minutes === "number"
              ? a.minutes
              : 0;

          const attended = a != null && Math.max(0, Math.min(counted, dur)) > 0;

          if (!attended) {
            if (prevAbsent) {
              const existing = await prisma.riskAlert.findFirst({
                where: {
                  studentId: e.studentId,
                  moduleCode,
                  intake,
                  year,
                  alertType: "manager_consecutive_absence",
                  triggerSessionId: s.id,
                },
              });

              if (existing) {
                managerAlertsAlreadyExisting++;
              } else {
                const createdAlert = await prisma.riskAlert.create({
                  data: {
                    studentId: e.studentId,
                    moduleCode,
                    intake,
                    year,
                    alertType: "manager_consecutive_absence",
                    triggerSessionId: s.id,
                    sessionCount: sessionCountForCohort,
                    status: "pending",
                  },
                });

                managerAlertsCreated++;

                const subject = buildManagerConsecutiveAbsenceSubject();

                const text = buildManagerConsecutiveAbsenceBody({
                  studentName: e.student.name,
                  studentEmail: e.student.email,
                  programName,
                  moduleName,
                  moduleCode,
                  intake,
                  year,
                  firstMissedDate: prevAbsent.date,
                  secondMissedDate: s.startTime ?? null,
                });

                const emailResult = await sendEmail({
                  to: managerEmail,
                  subject,
                  text,
                });

                if (emailResult.ok) {
                  if (emailResult.status === "disabled") {
                    emailDisabledCount++;
                    await prisma.riskAlert.update({
                      where: { id: createdAlert.id },
                      data: { status: "disabled" },
                    });
                  } else if (emailResult.status === "test_mode") {
                    emailTestModeCount++;
                    await prisma.riskAlert.update({
                      where: { id: createdAlert.id },
                      data: { status: "test_mode" },
                    });
                  } else if (emailResult.status === "sent") {
                    emailSentCount++;
                    await prisma.riskAlert.update({
                      where: { id: createdAlert.id },
                      data: { status: "sent" },
                    });
                  }
                } else {
                  emailFailedCount++;
                  console.error("[email-send-failed]", {
                    type: "manager_consecutive_absence",
                    managerEmail,
                    studentEmail: e.student.email,
                    moduleCode,
                    intake,
                    year,
                    triggerSessionId: s.id,
                    error: emailResult.error,
                  });

                  await prisma.riskAlert.update({
                    where: { id: createdAlert.id },
                    data: { status: "failed" },
                  });
                }
              }
            }

            prevAbsent = { id: s.id, date: s.startTime ?? null };
          } else {
            prevAbsent = null;
          }
        }
      }
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
      reportedDurationMin,
      scheduledDurationMin,
      cappedCount,
      sourceUsed: "section2_only",

      // Student threshold summary
      riskEvaluationRun,
      sessionCountForCohort,
      highRiskCount,
      alertsCreated,
      alertsAlreadyExisting,

      // Manager consecutive-absence summary
      managerAlertsCreated,
      managerAlertsAlreadyExisting,

      // Email summary
      emailSending: "dev_safe",
      emailDisabledCount,
      emailTestModeCount,
      emailSentCount,
      emailFailedCount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}