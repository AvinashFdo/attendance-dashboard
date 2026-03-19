import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import AppShell from "@/components/AppShell";
import RiskAlertsFilters from "./RiskAlertsFilters";

type SearchParams = {
  program?: string;
  intake?: string;
  year?: string;
  module?: string;
};

type ProgramOption = { id: string; name: string };

type ModuleOption = {
  code: string;
  name: string;
  programsText: string;
  programIds: string[];
};

type CohortKey = {
  moduleCode: string;
  intake: string;
  year: number;
};

function normIntake(v: string): string {
  const s = v.trim().toLowerCase();
  if (s === "spring") return "Spring";
  if (s === "summer") return "Summer";
  if (s === "autumn" || s === "fall") return "Autumn";
  return v.trim();
}

function cohortKeyString(k: CohortKey) {
  return `${k.moduleCode}|${k.intake}|${k.year}`;
}

function fmtPct(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function fmtDateTimeUtc(d: Date) {
  const year = d.getUTCFullYear();
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hour}:${minute}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default async function RiskAlertsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const programId = (sp.program ?? "").trim();
  const intake = (sp.intake ?? "").trim() ? normIntake(sp.intake ?? "") : "";
  const moduleFilter = (sp.module ?? "").trim().toUpperCase();
  const yearNum = (sp.year ?? "").trim() ? Number((sp.year ?? "").trim()) : NaN;
  const year = Number.isFinite(yearNum) ? yearNum : null;

  const programs: ProgramOption[] = await prisma.program.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const allModules = await prisma.module.findMany({
    orderBy: { code: "asc" },
    select: {
      code: true,
      name: true,
      programs: { select: { program: { select: { id: true, name: true } } } },
    },
  });

  const moduleOptions: ModuleOption[] = allModules.map((m) => {
    const progNames = m.programs
      .map((x) => x.program.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const programIds = m.programs.map((x) => x.program.id);

    return {
      code: m.code,
      name: m.name,
      programsText: progNames.join(", "),
      programIds,
    };
  });

  const filteredModuleOptions = programId
    ? moduleOptions
        .filter((m) => m.programIds.includes(programId))
        .map(({ code, name, programsText }) => ({ code, name, programsText }))
    : moduleOptions.map(({ code, name, programsText }) => ({ code, name, programsText }));

  const moduleMap = new Map(
    moduleOptions.map((m) => [
      m.code,
      {
        name: m.name,
        programIds: m.programIds,
        programsText: m.programsText,
      },
    ])
  );

  const alertWhere: Prisma.RiskAlertWhereInput = {
    ...(moduleFilter ? { moduleCode: moduleFilter } : {}),
    ...(intake ? { intake } : {}),
    ...(year ? { year } : {}),
  };

  const rawAlerts = await prisma.riskAlert.findMany({
    where: alertWhere,
    orderBy: [{ createdAt: "desc" }],
    include: {
      student: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  const latestAlertMap = new Map<string, (typeof rawAlerts)[number]>();

  for (const alert of rawAlerts) {
    const moduleMeta = moduleMap.get(alert.moduleCode);
    if (programId && !moduleMeta?.programIds.includes(programId)) continue;

    const key = `${alert.studentId}|${alert.moduleCode}|${alert.intake}|${alert.year}`;
    if (!latestAlertMap.has(key)) {
      latestAlertMap.set(key, alert);
    }
  }

  const latestAlerts = Array.from(latestAlertMap.values()).map((alert) => {
    const moduleMeta = moduleMap.get(alert.moduleCode);
    return {
      id: alert.id,
      studentName: alert.student.name,
      studentEmail: alert.student.email,
      moduleCode: alert.moduleCode,
      moduleName: moduleMeta?.name ?? alert.moduleCode,
      intake: alert.intake,
      year: alert.year,
      sessionCount: alert.sessionCount,
      timePct: alert.timePct,
      status: alert.status,
      createdAt: alert.createdAt,
    };
  });

  const enrollmentWhere: Prisma.EnrollmentWhereInput = {
    ...(moduleFilter ? { moduleCode: moduleFilter } : {}),
    ...(intake ? { intake } : {}),
    ...(year ? { year } : {}),
    ...(programId
      ? {
          module: {
            programs: {
              some: { programId },
            },
          },
        }
      : {}),
    student: {
      email: { endsWith: "@stu.nexteducationgroup.com", mode: "insensitive" },
    },
  };

  const enrollments = await prisma.enrollment.findMany({
    where: enrollmentWhere,
    select: {
      studentId: true,
      moduleCode: true,
      intake: true,
      year: true,
      student: {
        select: {
          name: true,
          email: true,
        },
      },
      module: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ moduleCode: "asc" }, { year: "desc" }, { intake: "asc" }],
  });

  const cohortKeys = new Map<string, CohortKey>();
  for (const e of enrollments) {
    const k = { moduleCode: e.moduleCode, intake: e.intake, year: e.year };
    cohortKeys.set(cohortKeyString(k), k);
  }

  const sessionOr = Array.from(cohortKeys.values()).map((k) => ({
    moduleCode: k.moduleCode,
    intake: k.intake,
    year: k.year,
  }));

  const sessions = sessionOr.length
    ? await prisma.session.findMany({
        where: { OR: sessionOr },
        orderBy: [{ startTime: "asc" }],
        select: {
          id: true,
          moduleCode: true,
          intake: true,
          year: true,
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
      })
    : [];

  const sessionsByCohort = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = cohortKeyString({
      moduleCode: s.moduleCode,
      intake: s.intake,
      year: s.year,
    });
    const list = sessionsByCohort.get(key) ?? [];
    list.push(s);
    sessionsByCohort.set(key, list);
  }

  const watchlistRows: Array<{
    studentName: string | null;
    studentEmail: string;
    moduleCode: string;
    moduleName: string;
    intake: string;
    year: number;
    sessionCount: number;
    timePct: number;
  }> = [];

  for (const e of enrollments) {
    const key = cohortKeyString({
      moduleCode: e.moduleCode,
      intake: e.intake,
      year: e.year,
    });

    const cohortSessions = sessionsByCohort.get(key) ?? [];
    const sessionCount = cohortSessions.length;

    if (sessionCount < 5) continue;

    let totalScheduledMin = 0;
    let attendedMin = 0;

    for (const s of cohortSessions) {
      const dur =
        typeof s.scheduledDurationMin === "number" && s.scheduledDurationMin > 0
          ? s.scheduledDurationMin
          : typeof s.durationMin === "number" && s.durationMin > 0
          ? s.durationMin
          : 0;

      totalScheduledMin += dur;

      const a = s.attendance.find((x) => x.studentId === e.studentId);
      if (!a || dur <= 0) continue;

      const counted =
        typeof a.countedMinutes === "number"
          ? a.countedMinutes
          : typeof a.minutes === "number"
          ? a.minutes
          : 0;

      attendedMin += clamp(counted, 0, dur);
    }

    if (totalScheduledMin <= 0) continue;

    const timePct = Math.round((attendedMin / totalScheduledMin) * 1000) / 10;

    if (timePct >= 70 && timePct < 80) {
      watchlistRows.push({
        studentName: e.student.name,
        studentEmail: e.student.email,
        moduleCode: e.moduleCode,
        moduleName: e.module.name,
        intake: e.intake,
        year: e.year,
        sessionCount,
        timePct,
      });
    }
  }

  watchlistRows.sort((a, b) => {
    if (a.timePct !== b.timePct) return a.timePct - b.timePct;
    return a.studentEmail.localeCompare(b.studentEmail);
  });

  const studentsAlertedCount = latestAlerts.length;
  const failedEmailsCount = latestAlerts.filter((a) => a.status === "failed").length;
  const watchlistCount = watchlistRows.length;

  const cardClass = "rounded-2xl border border-slate-200 bg-white shadow-sm";

  return (
    <AppShell
      title="Attendance Alerts"
      subtitle="Review latest attendance alerts and students on the watchlist."
    >
      <section className={cardClass}>
        <div className="p-4 md:p-6">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">Filters</h2>
            <p className="text-sm text-slate-600">
              Narrow the alert dashboard by program, module, intake and year.
            </p>
          </div>

          <div className="mt-4">
            <RiskAlertsFilters
              programId={programId}
              moduleFilter={moduleFilter}
              intake={intake}
              year={year ? String(year) : ""}
              programs={programs}
              moduleOptions={filteredModuleOptions}
            />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={cardClass}>
          <div className="p-4 md:p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Students alerted</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{studentsAlertedCount}</div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="p-4 md:p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Failed emails</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{failedEmailsCount}</div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="p-4 md:p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Watchlist students</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{watchlistCount}</div>
          </div>
        </div>
      </section>

      <section className={cardClass}>
        <div className="p-4 md:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">Risk Emails Sent</h2>
            <p className="text-sm text-slate-600">
              Only the latest alert per student is shown.
            </p>
          </div>

          {latestAlerts.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No alerts found for the current filters.
            </div>
          ) : (
            <div className="overflow-auto rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="py-3 px-4 text-left font-medium">Student</th>
                    <th className="py-3 px-4 text-left font-medium">Email</th>
                    <th className="py-3 px-4 text-left font-medium">Module</th>
                    <th className="py-3 px-4 text-left font-medium">Intake</th>
                    <th className="py-3 px-4 text-left font-medium">Year</th>
                    <th className="py-3 px-4 text-right font-medium">Sessions</th>
                    <th className="py-3 px-4 text-right font-medium">Time %</th>
                    <th className="py-3 px-4 text-left font-medium">Email status</th>
                    <th className="py-3 px-4 text-left font-medium">Alert date</th>
                  </tr>
                </thead>
                <tbody>
                  {latestAlerts.map((r, idx) => (
                    <tr
                      key={r.id}
                      className={`border-b border-slate-100 ${
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                      } hover:bg-slate-50`}
                    >
                      <td className="py-3 px-4 text-slate-900">{r.studentName ?? "(no name)"}</td>
                      <td className="py-3 px-4 text-slate-700">{r.studentEmail}</td>
                      <td className="py-3 px-4 text-slate-900">
                        <div className="font-medium">{r.moduleName}</div>
                        <div className="text-xs text-slate-500">{r.moduleCode}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">{r.intake}</td>
                      <td className="py-3 px-4 text-slate-700 tabular-nums">{r.year}</td>
                      <td className="py-3 px-4 text-right text-slate-900 tabular-nums">{r.sessionCount}</td>
                      <td className="py-3 px-4 text-right text-slate-900 tabular-nums">{fmtPct(r.timePct)}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                            r.status === "failed"
                              ? "bg-rose-50 text-rose-700 ring-rose-200"
                              : r.status === "sent"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : r.status === "test_mode"
                              ? "bg-amber-50 text-amber-800 ring-amber-200"
                              : "bg-slate-50 text-slate-700 ring-slate-200"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {fmtDateTimeUtc(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className={cardClass}>
        <div className="p-4 md:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">Watchlist (70% to below 80%)</h2>
            <p className="text-sm text-slate-600">
              Students are shown only after at least 5 completed sessions.
            </p>
          </div>

          {watchlistRows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No watchlist students found for the current filters.
            </div>
          ) : (
            <div className="overflow-auto rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="py-3 px-4 text-left font-medium">Student</th>
                    <th className="py-3 px-4 text-left font-medium">Email</th>
                    <th className="py-3 px-4 text-left font-medium">Module</th>
                    <th className="py-3 px-4 text-left font-medium">Intake</th>
                    <th className="py-3 px-4 text-left font-medium">Year</th>
                    <th className="py-3 px-4 text-right font-medium">Sessions</th>
                    <th className="py-3 px-4 text-right font-medium">Time %</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlistRows.map((r, idx) => (
                    <tr
                      key={`${r.studentEmail}|${r.moduleCode}|${r.intake}|${r.year}`}
                      className={`border-b border-slate-100 ${
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                      } hover:bg-slate-50`}
                    >
                      <td className="py-3 px-4 text-slate-900">{r.studentName ?? "(no name)"}</td>
                      <td className="py-3 px-4 text-slate-700">{r.studentEmail}</td>
                      <td className="py-3 px-4 text-slate-900">
                        <div className="font-medium">{r.moduleName}</div>
                        <div className="text-xs text-slate-500">{r.moduleCode}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">{r.intake}</td>
                      <td className="py-3 px-4 text-slate-700 tabular-nums">{r.year}</td>
                      <td className="py-3 px-4 text-right text-slate-900 tabular-nums">{r.sessionCount}</td>
                      <td className="py-3 px-4 text-right text-slate-900 tabular-nums">{fmtPct(r.timePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}