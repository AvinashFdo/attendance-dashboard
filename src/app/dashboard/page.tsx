import React from "react";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import FiltersForm from "./FiltersForm";

type SearchParams = {
  q?: string;
  student?: string;

  // Filters
  program?: string; // Program.id
  intake?: string; // Spring/Summer/Autumn
  year?: string; // number as string
  module?: string; // moduleCode
};

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10; // 1 decimal
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmtPct1(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  const v = Math.round(value * 10) / 10;
  return `${v}%`;
}

function fmtDate(d: Date | null) {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

function fmtMinutes(min: number | null | undefined) {
  const m =
    typeof min === "number" && Number.isFinite(min) ? Math.max(0, Math.round(min)) : 0;
  const h = Math.floor(m / 60);
  const r = m % 60;

  if (h === 0 && r === 0) return "0m";
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

function normIntake(v: string): string {
  const s = v.trim().toLowerCase();
  if (s === "spring") return "Spring";
  if (s === "summer") return "Summer";
  if (s === "autumn" || s === "fall") return "Autumn";
  return v.trim();
}

type ModuleOption = {
  code: string;
  name: string;
  programsText: string;
};

type ProgramOption = { id: string; name: string };

type CohortKey = {
  moduleCode: string;
  intake: string;
  year: number;
};

function cohortKeyString(k: CohortKey): string {
  return `${k.moduleCode}|${k.intake}|${k.year}`;
}

function buildDashboardUrl(params: {
  q: string;
  student: string;
  program: string;
  module: string;
  intake: string;
  year: string;
}) {
  return `/dashboard?${new URLSearchParams(params).toString()}`;
}

type RiskLevel = "No data" | "High" | "Medium" | "Low";

function calcRiskLevel(sessionPct: number | null, timePct: number | null): RiskLevel {
  // If we have no usable metric (e.g., no sessions held), show No data
  if (sessionPct == null && timePct == null) return "No data";

  const s = sessionPct;
  const t = timePct;

  // High risk if either metric is under 50%
  if ((s != null && s < 50) || (t != null && t < 50)) return "High";

  // Low risk only if BOTH are >= 75% (when available)
  // If one metric is missing, we can’t confidently label Low → keep Medium.
  if (s != null && t != null && s >= 75 && t >= 75) return "Low";

  return "Medium";
}

function riskBadgeClasses(level: RiskLevel) {
  if (level === "High")
    return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  if (level === "Low")
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (level === "Medium")
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  return "bg-slate-50 text-slate-700 ring-1 ring-slate-200";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const q = (sp.q ?? "").trim();
  const selectedStudentId = (sp.student ?? "").trim();

  const programId = (sp.program ?? "").trim(); // Program.id
  const intake = (sp.intake ?? "").trim() ? normIntake(sp.intake ?? "") : "";
  const yearNum = (sp.year ?? "").trim() ? Number((sp.year ?? "").trim()) : NaN;
  const moduleFilter = (sp.module ?? "").trim().toUpperCase();

  const year = Number.isFinite(yearNum) ? yearNum : null;

  const cohortSelected = !!(moduleFilter && intake && year);

  // Programs dropdown
  const programs: ProgramOption[] = await prisma.program.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // ✅ Modules dropdown depends on Program filter (SERVER SIDE, based on URL param)
  const modulesForDropdown = await prisma.module.findMany({
    where: programId
      ? {
          programs: {
            some: { programId },
          },
        }
      : undefined,
    orderBy: { code: "asc" },
    select: {
      code: true,
      name: true,
      programs: { select: { program: { select: { name: true } } } },
    },
  });

  const moduleOptions: ModuleOption[] = modulesForDropdown.map((m) => {
    const progNames = m.programs
      .map((x) => x.program.name)
      .filter((n) => typeof n === "string" && n.length > 0)
      .sort((a, b) => a.localeCompare(b));
    return {
      code: m.code,
      name: m.name,
      programsText: progNames.length ? progNames.join(", ") : "",
    };
  });

  // -----------------------------
  // Option A: Search matches are FILTER-AWARE
  // Only show students (@stu...) who match the selected filter(s)
  // -----------------------------
  const studentSearchWhere: Prisma.StudentWhereInput | null =
    q.length >= 2
      ? {
          email: { endsWith: "@stu.nexteducationgroup.com", mode: "insensitive" },
          AND: [
            {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            },
            ...(programId || moduleFilter || intake || year
              ? [
                  {
                    enrollments: {
                      some: {
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
                      },
                    },
                  },
                ]
              : []),
          ],
        }
      : null;

  const students = studentSearchWhere
    ? await prisma.student.findMany({
        where: studentSearchWhere,
        orderBy: [{ name: "asc" }, { email: "asc" }],
        take: 30,
      })
    : [];

  const selected = selectedStudentId
    ? await prisma.student.findUnique({
        where: { id: selectedStudentId },
      })
    : null;

  // -----------------------------
  // Cohort summary (CEO):
  // if module+intake+year => show cohort list
  // -----------------------------
  let cohortSummary:
    | {
        moduleCode: string;
        moduleName: string;
        programsText: string | null;
        intake: string;
        year: number;
        sessionsHeld: number;
        totalEnrolled: number;
        rows: Array<{
          studentId: string;
          name: string | null;
          email: string;
          sessionsAttended: number;
          attendancePct: number;
        }>;
      }
    | null = null;

  if (cohortSelected) {
    const moduleMeta = await prisma.module.findUnique({
      where: { code: moduleFilter },
      select: {
        code: true,
        name: true,
        programs: { select: { program: { select: { name: true, id: true } } } },
      },
    });

    const programsText = moduleMeta
      ? moduleMeta.programs
          .map((x) => x.program.name)
          .filter((n) => typeof n === "string" && n.length > 0)
          .sort((a, b) => a.localeCompare(b))
          .join(", ")
      : "";

    const enrollments = await prisma.enrollment.findMany({
      where: {
        moduleCode: moduleFilter,
        intake,
        year: year ?? undefined,
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
      },
      select: {
        studentId: true,
        student: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ studentId: "asc" }],
    });

    const sessionsHeld = await prisma.session.count({
      where: { moduleCode: moduleFilter, intake, year: year ?? undefined },
    });

    const studentIds = enrollments.map((e) => e.studentId);

    const attendedCounts =
      studentIds.length > 0
        ? await prisma.attendance.groupBy({
            by: ["studentId"],
            where: {
              isEligible: true,
              studentId: { in: studentIds },
              session: { moduleCode: moduleFilter, intake, year: year ?? undefined },
            },
            _count: { id: true },
          })
        : [];

    const attendedMap = new Map<string, number>();
    for (const r of attendedCounts) attendedMap.set(r.studentId, r._count.id);

    const rows = enrollments
      .map((e) => {
        const attended = attendedMap.get(e.studentId) ?? 0;
        return {
          studentId: e.student.id,
          name: e.student.name,
          email: e.student.email,
          sessionsAttended: attended,
          attendancePct: pct(attended, sessionsHeld),
        };
      })
      .sort((a, b) => {
        const an = (a.name ?? "").toLowerCase();
        const bn = (b.name ?? "").toLowerCase();
        if (an && bn && an !== bn) return an.localeCompare(bn);
        return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
      });

    cohortSummary = {
      moduleCode: moduleFilter,
      moduleName: moduleMeta?.name ?? moduleFilter,
      programsText: programsText || null,
      intake,
      year: year ?? 0,
      sessionsHeld,
      totalEnrolled: enrollments.length,
      rows,
    };
  }

  // -----------------------------
  // Selected student details (cohort-aware)
  // -----------------------------
  let moduleRows: Array<{
    moduleCode: string;
    moduleName: string;
    programsText: string | null;
    intake: string;
    year: number;
    sessionsHeld: number;
    sessionsAttended: number;
    attendancePct: number;
  }> = [];

  const totals = {
    sessionsHeld: 0,
    sessionsAttended: 0,
  };

  // NEW: time-based totals (only sessions with known duration contribute)
  const timeTotals = {
    durationKnownMin: 0,
    attendedMin: 0,
  };

  const sessionsByCohort = new Map<
    string,
    Array<{
      id: string;
      meetingName: string | null;
      startTime: Date | null;
      durationMin: number | null;
      attended: boolean;
      attendedMin: number;
      attendedPct: number | null; // NEW
    }>
  >();

  if (selected) {
    const enrollmentWhere: Prisma.EnrollmentWhereInput = {
      studentId: selected.id,
      ...(intake ? { intake } : {}),
      ...(year ? { year } : {}),
      ...(moduleFilter ? { moduleCode: moduleFilter } : {}),
      ...(programId
        ? {
            module: {
              programs: {
                some: { programId },
              },
            },
          }
        : {}),
    };

    const enrollments = await prisma.enrollment.findMany({
      where: enrollmentWhere,
      include: {
        module: {
          select: {
            code: true,
            name: true,
            programs: { select: { program: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ moduleCode: "asc" }],
    });

    const cohortKeys: CohortKey[] = [];
    const seen = new Set<string>();
    for (const e of enrollments) {
      const k: CohortKey = { moduleCode: e.moduleCode, intake: e.intake, year: e.year };
      const ks = cohortKeyString(k);
      if (!seen.has(ks)) {
        seen.add(ks);
        cohortKeys.push(k);
      }
    }

    if (cohortKeys.length > 0) {
      const sessionOr: Prisma.SessionWhereInput[] = cohortKeys.map((k) => ({
        moduleCode: k.moduleCode,
        intake: k.intake,
        year: k.year,
      }));

      const sessionsHeldCounts = await prisma.session.groupBy({
        by: ["moduleCode", "intake", "year"],
        where: { OR: sessionOr },
        _count: { id: true },
      });

      const heldMap = new Map<string, number>();
      for (const r of sessionsHeldCounts) {
        heldMap.set(
          cohortKeyString({ moduleCode: r.moduleCode, intake: r.intake, year: r.year }),
          r._count.id
        );
      }

      const sessions = await prisma.session.findMany({
        where: { OR: sessionOr },
        orderBy: [{ startTime: "asc" }],
        select: {
          id: true,
          moduleCode: true,
          intake: true,
          year: true,
          meetingName: true,
          startTime: true,
          durationMin: true,
          attendance: {
            where: { studentId: selected.id, isEligible: true },
            select: { minutes: true },
          },
        },
      });

      const attendedCountMap = new Map<string, number>();

      for (const s of sessions) {
        const key = cohortKeyString({ moduleCode: s.moduleCode, intake: s.intake, year: s.year });
        const a = s.attendance[0] ?? null;

        if (a) attendedCountMap.set(key, (attendedCountMap.get(key) ?? 0) + 1);

        const attendedMin = a?.minutes ?? 0;

        // NEW: per-session attended % (only if attended & duration known)
        const dur = typeof s.durationMin === "number" && s.durationMin > 0 ? s.durationMin : null;
        const attendedPct =
          a && dur
            ? clamp((attendedMin / dur) * 100, 0, 100)
            : null;

        // NEW: overall time totals (only sessions with known duration)
        if (dur) {
          timeTotals.durationKnownMin += dur;
          if (a) timeTotals.attendedMin += clamp(attendedMin, 0, dur);
        }

        const row = {
          id: s.id,
          meetingName: s.meetingName,
          startTime: s.startTime,
          durationMin: s.durationMin,
          attended: !!a,
          attendedMin,
          attendedPct,
        };

        const list = sessionsByCohort.get(key) ?? [];
        list.push(row);
        sessionsByCohort.set(key, list);
      }

      moduleRows = enrollments.map((e) => {
        const key = cohortKeyString({ moduleCode: e.moduleCode, intake: e.intake, year: e.year });

        const sessionsHeld = heldMap.get(key) ?? 0;
        const sessionsAttended = attendedCountMap.get(key) ?? 0;

        totals.sessionsHeld += sessionsHeld;
        totals.sessionsAttended += sessionsAttended;

        const progNames = e.module.programs
          .map((x) => x.program.name)
          .filter((n) => typeof n === "string" && n.length > 0)
          .sort((a, b) => a.localeCompare(b));

        return {
          moduleCode: e.moduleCode,
          moduleName: e.module?.name ?? e.moduleCode,
          programsText: progNames.length ? progNames.join(", ") : null,
          intake: e.intake,
          year: e.year,
          sessionsHeld,
          sessionsAttended,
          attendancePct: pct(sessionsAttended, sessionsHeld),
        };
      });
    }
  }

  // NEW: KPIs for selected student
  const sessionsPct = selected && totals.sessionsHeld > 0
    ? pct(totals.sessionsAttended, totals.sessionsHeld)
    : null;

  const timePct = selected && timeTotals.durationKnownMin > 0
    ? pct(timeTotals.attendedMin, timeTotals.durationKnownMin)
    : null;

  const riskLevel = selected ? calcRiskLevel(sessionsPct, timePct) : "No data";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10 space-y-6">
        {/* Page header */}
        <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">
              Attendance Dashboard
            </h1>
            <p className="text-sm text-slate-600">
              Search students and review cohort / student attendance summaries.
            </p>
          </div>

          {/* Import page link */}
          <a
            href="/import"
            className="inline-flex items-center gap-2 h-10 rounded-xl border border-slate-200
                      bg-white px-4 text-sm font-medium text-slate-900 shadow-sm
                      hover:bg-slate-50 hover:border-slate-300
                      focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            Import data
          </a>
        </header>


        {/* Filters block (client) */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="p-4 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">Filters</h2>
                <p className="text-sm text-slate-600">
                  Narrow results by program, module, intake and year.
                </p>
              </div>
            </div>

            <div className="mt-4">
              <FiltersForm
                q={q}
                student={selectedStudentId}
                programId={programId}
                moduleFilter={moduleFilter}
                intake={intake}
                year={year ? String(year) : "2026"}
                programs={programs}
                moduleOptions={moduleOptions}
                cohortSelected={cohortSelected}
              />
            </div>
          </div>
        </section>

        {/* Search */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="p-4 md:p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">Student Search</h2>
              <p className="text-sm text-slate-600">
                Search by name or email (only{" "}
                <span className="font-medium">@stu.nexteducationgroup.com</span> will appear).
              </p>
            </div>

            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
              action="/dashboard#matches"
              method="get"
            >
              <input type="hidden" name="program" value={programId} />
              <input type="hidden" name="module" value={moduleFilter} />
              <input type="hidden" name="intake" value={intake} />
              <input type="hidden" name="year" value={year ? String(year) : ""} />

              <div className="flex-1">
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="e.g. John Doe or john@stu.nexteducationgroup.com"
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm
                             placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <button
                className="h-10 rounded-xl border border-slate-200 bg-slate-900 px-4 text-sm font-medium text-white
                           shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                Search
              </button>
            </form>

            {q.length > 0 && q.length < 2 && (
              <div className="text-sm text-slate-600">
                Type at least <span className="font-medium">2 characters</span>.
              </div>
            )}

            {students.length > 0 && (
              <div id="matches" className="pt-2 scroll-mt-6">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-900">Matches</div>
                  <div className="text-xs text-slate-500">{students.length} shown</div>
                </div>

                <div className="mt-3 grid gap-2">
                  {students.map((s) => (
                    <a
                      key={s.id}
                      className="group rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm
                                 hover:bg-slate-50 hover:border-slate-300"
                      href={buildDashboardUrl({
                        q,
                        student: s.id,
                        program: programId,
                        module: moduleFilter,
                        intake,
                        year: year ? String(year) : "",
                      })+ "#student"
                    }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {s.name ?? "(no name)"}
                          </div>
                          <div className="text-sm text-slate-600 truncate">{s.email}</div>
                        </div>
                        <div className="text-xs text-slate-500 group-hover:text-slate-700">
                          View →
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {q.length >= 2 && students.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                No matches for current filters (only @stu.nexteducationgroup.com are shown).
              </div>
            )}
          </div>
        </section>

        {/* Cohort Summary */}
        {cohortSummary && (
          <section
            id="cohort"
            className="rounded-2xl border border-slate-200 bg-white shadow-sm scroll-mt-6"
          >
            <div className="p-4 md:p-6 space-y-5">
              <div className="space-y-1">
                <h2 className="text-base md:text-lg font-semibold text-slate-900">
                  Cohort Summary
                  <span className="ml-2 text-slate-500 font-medium">
                    - {cohortSummary.intake} {cohortSummary.year}
                  </span>
                </h2>
                <p className="text-sm text-slate-600">
                  {cohortSummary.programsText} · {cohortSummary.moduleCode} · {cohortSummary.moduleName}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Students enrolled</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {cohortSummary.totalEnrolled}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Sessions completed</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {cohortSummary.sessionsHeld}
                  </div>
                </div>
              </div>

              <div className="overflow-auto rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr className="border-b border-slate-200">
                      <th className="py-3 px-4 text-left font-medium">Student</th>
                      <th className="py-3 px-4 text-left font-medium">Email</th>
                      <th className="py-3 px-4 text-right font-medium">Attended</th>
                      <th className="py-3 px-4 text-right font-medium">Sessions</th>
                      <th className="py-3 px-4 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohortSummary.rows.map((r, idx) => (
                      <tr
                        key={r.studentId}
                        className={`border-b border-slate-100 ${
                          idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                        } hover:bg-slate-50`}
                      >
                        <td className="py-3 px-4">
                          <a
                            className="font-medium text-slate-900 hover:underline"
                            href={
                              buildDashboardUrl({
                                q,
                                student: r.studentId,
                                program: programId,
                                module: moduleFilter,
                                intake,
                                year: year ? String(year) : "",
                              }) + "#student"
                            }
                          >
                            {r.name ?? "(no name)"}
                          </a>
                        </td>
                        <td className="py-3 px-4 text-slate-700">{r.email}</td>
                        <td className="py-3 px-4 text-right tabular-nums text-slate-900">
                          {r.sessionsAttended}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-slate-700">
                          {cohortSummary.sessionsHeld}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums font-medium text-slate-900">
                          {r.attendancePct}%
                        </td>
                      </tr>
                    ))}

                    {cohortSummary.rows.length === 0 && (
                      <tr>
                        <td className="py-4 px-4 text-slate-600" colSpan={5}>
                          No students enrolled for this cohort (or none with @stu.nexteducationgroup.com).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {cohortSummary.sessionsHeld === 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  No sessions imported yet for this cohort. Upload attendance CSVs for this cohort to populate.
                </div>
              )}
            </div>
          </section>
        )}

        {/* Selected student summary */}
        {selected && (
          <section
            id="student"
            className="rounded-2xl border border-slate-200 bg-white shadow-sm scroll-mt-6"
          >
            <div className="p-4 md:p-6 space-y-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1 min-w-0">
                  <h2 className="text-base md:text-lg font-semibold text-slate-900 truncate">
                    {selected.name ?? "(no name)"}
                  </h2>
                  <div className="text-sm text-slate-600 truncate">{selected.email}</div>
                  {selected.program && (
                    <div className="text-sm text-slate-600">
                      Program:{" "}
                      <span className="font-medium text-slate-900">{selected.program}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* KPIs (now 4 cards) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Attendance</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {pct(totals.sessionsAttended, totals.sessionsHeld)}%
                  </div>
                  <div className="mt-1 text-xs text-slate-500">By sessions</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Sessions attended</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
                    {totals.sessionsAttended} / {totals.sessionsHeld}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Time attended</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {timePct == null ? "-" : `${timePct}%`}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {timeTotals.durationKnownMin > 0
                      ? `${fmtMinutes(timeTotals.attendedMin)} / ${fmtMinutes(timeTotals.durationKnownMin)}`
                      : "No duration data yet"}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Risk level</div>
                  <div className="mt-2">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${riskBadgeClasses(
                        riskLevel
                      )}`}
                    >
                      {riskLevel}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    High: &lt;50% • Low: ≥75% (sessions + time)
                  </div>
                </div>
              </div>

              <div className="overflow-auto rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr className="border-b border-slate-200">
                      <th className="py-3 px-4 text-left font-medium">Module</th>
                      <th className="py-3 px-4 text-left font-medium">Name</th>
                      <th className="py-3 px-4 text-left font-medium">Program</th>
                      <th className="py-3 px-4 text-left font-medium">Intake</th>
                      <th className="py-3 px-4 text-left font-medium">Year</th>
                      <th className="py-3 px-4 text-right font-medium">Attended</th>
                      <th className="py-3 px-4 text-right font-medium">Scheduled</th>
                      <th className="py-3 px-4 text-right font-medium">%</th>
                    </tr>
                  </thead>

                  <tbody>
                    {moduleRows.map((r, idx) => {
                      const key = cohortKeyString({
                        moduleCode: r.moduleCode,
                        intake: r.intake,
                        year: r.year,
                      });
                      const sessionRows = sessionsByCohort.get(key) ?? [];

                      return (
                        <React.Fragment key={key}>
                          <tr
                            className={`border-b border-slate-100 ${
                              idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                            }`}
                          >
                            <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                              {r.moduleCode}
                            </td>
                            <td className="py-3 px-4 text-slate-900">{r.moduleName}</td>
                            <td className="py-3 px-4 text-slate-700">{r.programsText ?? "-"}</td>
                            <td className="py-3 px-4 text-slate-700">{r.intake}</td>
                            <td className="py-3 px-4 text-slate-700 tabular-nums">{r.year}</td>
                            <td className="py-3 px-4 text-right tabular-nums text-slate-900">
                              {r.sessionsAttended}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums text-slate-700">
                              {r.sessionsHeld}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums font-medium text-slate-900">
                              {r.attendancePct}%
                            </td>
                          </tr>

                          <tr className="border-b border-slate-200 bg-white">
                            <td colSpan={8} className="px-4 py-3">
                              {/* NOTE: add group here so the chevron rotate works */}
                              <details className="group rounded-2xl border border-slate-200 bg-white">
                                <summary className="cursor-pointer px-4 py-3 select-none flex items-center justify-between gap-3 list-none">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-900">Sessions</span>
                                    {/* dropdown icon */}
                                    <svg
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                      className="h-4 w-4 text-slate-500 transition-transform duration-200 group-open:rotate-180"
                                      aria-hidden="true"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  </div>
                                  <span className="text-xs text-slate-500">{sessionRows.length} total</span>
                                </summary>

                                <div className="px-4 pb-4">
                                  <div className="overflow-auto rounded-xl border border-slate-200">
                                    <table className="w-full text-sm">
                                      <thead className="bg-slate-50 text-slate-600">
                                        <tr className="border-b border-slate-200">
                                          <th className="py-3 px-4 text-left font-medium whitespace-nowrap">Date</th>
                                          <th className="py-3 px-4 text-left font-medium">Meeting title</th>
                                          <th className="py-3 px-4 text-left font-medium whitespace-nowrap">Status</th>
                                          <th className="py-3 px-4 text-right font-medium whitespace-nowrap">Meeting duration</th>
                                          <th className="py-3 px-4 text-right font-medium whitespace-nowrap">Attended</th>
                                          <th className="py-3 px-4 text-right font-medium whitespace-nowrap">% attended</th>
                                        </tr>
                                      </thead>

                                      <tbody>
                                        {sessionRows.map((s, sidx) => (
                                          <tr
                                            key={s.id}
                                            className={`border-b border-slate-100 ${
                                              sidx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                                            } hover:bg-slate-50`}
                                          >
                                            <td className="py-3 px-4 whitespace-nowrap text-slate-900">
                                              {fmtDate(s.startTime)}
                                            </td>

                                            {/* ✅ Limit title width so the right-side columns sit closer */}
                                            <td className="py-3 px-4 text-slate-900">
                                              <div className="max-w-[520px] leading-snug">
                                                {s.meetingName ?? "-"}
                                              </div>
                                            </td>

                                            <td className="py-3 px-4 whitespace-nowrap">
                                              {s.attended ? (
                                                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                                                  Attended
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
                                                  Absent
                                                </span>
                                              )}
                                            </td>

                                            <td className="py-3 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                              {fmtMinutes(s.durationMin)}
                                            </td>

                                            <td className="py-3 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                              {s.attended ? fmtMinutes(s.attendedMin) : "-"}
                                            </td>

                                            <td className="py-3 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                              {s.attendedPct == null ? "-" : fmtPct1(s.attendedPct)}
                                            </td>
                                          </tr>
                                        ))}

                                        {sessionRows.length === 0 && (
                                          <tr>
                                            <td className="py-4 px-4 text-slate-600" colSpan={6}>
                                              No sessions found for this cohort yet.
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </details>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}

                    {moduleRows.length === 0 && (
                      <tr>
                        <td className="py-4 px-4 text-slate-600" colSpan={8}>
                          No enrollments found for this student (with current filters).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-slate-500">
                Note: “Attended” counts only rows where email ends with{" "}
                <span className="font-semibold">@stu.nexteducationgroup.com</span>.
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}