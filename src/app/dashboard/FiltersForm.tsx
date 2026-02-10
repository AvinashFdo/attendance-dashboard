"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

type ProgramOption = { id: string; name: string };

type ModuleOption = {
  code: string;
  name: string;
  programsText: string;
};

function buildDashboardUrl(params: Record<string, string>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && String(v).trim() !== "") sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

export default function FiltersForm(props: {
  q: string;
  student: string;

  programId: string;
  moduleFilter: string;
  intake: string;
  year: string;

  programs: ProgramOption[];
  moduleOptions: ModuleOption[];

  cohortSelected: boolean;
}) {
  const router = useRouter();

  const onProgramChange = useCallback(
    (nextProgramId: string) => {
      // When program changes, clear module (because module list becomes program-scoped)
      router.push(
        buildDashboardUrl({
          q: props.q,
          student: props.student,
          program: nextProgramId,
          module: "", // clear
          intake: props.intake,
          year: props.year,
        })
      );
    },
    [router, props.q, props.student, props.intake, props.year]
  );

  const labelCls = "block text-sm font-medium text-slate-700 mb-1";
  const selectCls =
    "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm " +
    "focus:outline-none focus:ring-2 focus:ring-slate-300";
  const inputCls =
    "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm " +
    "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300";
  const primaryBtnCls =
    "h-10 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white shadow-sm " +
    "hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300";
  const secondaryBtnCls =
    "h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm " +
    "hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-300";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4 md:p-5">
      <form className="grid grid-cols-1 md:grid-cols-2 gap-4" action="/dashboard#cohort" method="get">
        <input type="hidden" name="q" value={props.q} />
        <input type="hidden" name="student" value={props.student} />

        <div>
          <label className={labelCls}>Program</label>
          <select
            name="program"
            value={props.programId}
            onChange={(e) => onProgramChange(e.target.value)}
            className={selectCls}
          >
            <option value="">All programs</option>
            {props.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Module</label>
          <select name="module" defaultValue={props.moduleFilter} className={selectCls}>
            <option value="">All modules</option>
            {props.moduleOptions.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} - {m.name}
                {m.programsText ? ` (${m.programsText})` : ""}
              </option>
            ))}
          </select>

          {props.programId && props.moduleOptions.length === 0 && (
            <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              No modules found for this program.
            </div>
          )}
        </div>

        <div>
          <label className={labelCls}>Intake</label>
          <select name="intake" defaultValue={props.intake} className={selectCls}>
            <option value="">All intakes</option>
            <option value="Spring">Spring</option>
            <option value="Summer">Summer</option>
            <option value="Autumn">Autumn</option>
          </select>
        </div>

        <div>
          <label className={labelCls}>Year</label>
          <input
            name="year"
            type="number"
            min={2020}
            max={2100}
            defaultValue={props.year}
            placeholder="All years"
            className={inputCls}
          />
        </div>

        <div className="md:col-span-2 flex flex-col sm:flex-row gap-2 sm:items-center">
          <button type="submit" className={primaryBtnCls}>
            Apply filters
          </button>

          <a className={`${secondaryBtnCls} inline-flex items-center justify-center`} href="/dashboard">
            Clear
          </a>
        </div>

        {!props.cohortSelected && (props.programId || props.moduleFilter || props.intake || props.year) && (
          <div className="md:col-span-2 text-xs text-slate-600">
            Tip: Select <span className="font-semibold">Module + Intake + Year</span> to see the full cohort summary list.
          </div>
        )}
      </form>
    </div>
  );
}