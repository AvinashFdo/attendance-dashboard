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

  return (
    <div className="rounded-xl border p-4 space-y-4">
      <form className="grid grid-cols-2 gap-3" action="/dashboard" method="get">
        <input type="hidden" name="q" value={props.q} />
        <input type="hidden" name="student" value={props.student} />

        <div>
          <label className="block text-sm font-medium mb-1">Program</label>
          <select
            name="program"
            value={props.programId}
            onChange={(e) => onProgramChange(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          >
            <option value="">All programs</option>
            {props.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {/*<div className="text-xs text-gray-500 mt-1">
            Changing Program updates the module list automatically.
          </div>*/}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Module</label>
          <select
            name="module"
            defaultValue={props.moduleFilter}
            className="w-full rounded-lg border px-3 py-2"
          >
            <option value="">All modules</option>
            {props.moduleOptions.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} - {m.name}
                {m.programsText ? ` (${m.programsText})` : ""}
              </option>
            ))}
          </select>
          {props.programId && props.moduleOptions.length === 0 && (
            <div className="text-xs text-gray-600 mt-1">No modules found for this program.</div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Intake</label>
          <select
            name="intake"
            defaultValue={props.intake}
            className="w-full rounded-lg border px-3 py-2"
          >
            <option value="">All intakes</option>
            <option value="Spring">Spring</option>
            <option value="Summer">Summer</option>
            <option value="Autumn">Autumn</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Year</label>
          <input
            name="year"
            type="number"
            min={2020}
            max={2100}
            defaultValue={props.year}
            placeholder="All years"
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>

        <div className="col-span-2 flex gap-2">
          <button className="rounded-lg border px-4 py-2">Apply filters</button>
          <a className="rounded-lg border px-4 py-2 text-center" href="/dashboard">
            Clear
          </a>
        </div>

        {!props.cohortSelected && (props.programId || props.moduleFilter || props.intake || props.year) && (
          <div className="col-span-2 text-xs text-gray-600">
            Tip: Select <b>Module + Intake + Year</b> to see the full cohort summary list.
          </div>
        )}
      </form>
    </div>
  );
}