"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

type ProgramOption = { id: string; name: string };

type ModuleOption = {
  code: string;
  name: string;
  programsText: string;
};

function buildAlertsUrl(params: Record<string, string>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && String(v).trim() !== "") sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `/import/risk-alerts?${qs}` : "/import/risk-alerts";
}

export default function RiskAlertsFilters(props: {
  programId: string;
  moduleFilter: string;
  intake: string;
  year: string;
  programs: ProgramOption[];
  moduleOptions: ModuleOption[];
}) {
  const router = useRouter();

  const onProgramChange = useCallback(
    (nextProgramId: string) => {
      router.push(
        buildAlertsUrl({
          program: nextProgramId,
          module: "",
          intake: props.intake,
          year: props.year,
        })
      );
    },
    [router, props.intake, props.year]
  );

  const labelCls = "block text-sm font-medium text-slate-700 mb-1";
  const inputCls =
    "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm " +
    "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300";
  const selectCls =
    "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm " +
    "focus:outline-none focus:ring-2 focus:ring-slate-300";
  const primaryBtnCls =
    "h-10 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white shadow-sm " +
    "hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300";
  const secondaryBtnCls =
    "h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm " +
    "hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-300";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4 md:p-5">
      <form className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" action="/import/risk-alerts" method="get">
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
              </option>
            ))}
          </select>
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

        <div className="lg:col-span-4 flex gap-2">
          <button type="submit" className={primaryBtnCls}>
            Apply filters
          </button>

          <a
            href="/import/risk-alerts"
            className={`${secondaryBtnCls} inline-flex items-center justify-center`}
          >
            Clear
          </a>
        </div>
      </form>
    </div>
  );
}