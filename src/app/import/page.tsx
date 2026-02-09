"use client";

import { useEffect, useMemo, useState } from "react";

type AttendanceImportOk = {
  ok: true;
  moduleCode: string;
  intake: string;
  year: number;
  rowsRead: number;
  eligibleCount: number;
  durationMin?: number | null;
  sourceUsed?: string;
};
type ApiErr = { error: string };

type AttendanceImportResponse = AttendanceImportOk | ApiErr;

type ModuleOption = {
  code: string;
  name: string;
  program: string | null;
};

// /api/import/modules can return { ok:true, modules:[...] } OR { modules:[...] }
type ModulesApiOkA = { ok: true; modules: ModuleOption[] };
type ModulesApiOkB = { modules: ModuleOption[] };
type ModulesApiResponse = ModulesApiOkA | ModulesApiOkB | ApiErr;

// /api/import/modules POST can return different success keys
type ImportModulesOkA = { ok: true; upserted: number };
type ImportModulesOkB = { insertedOrUpdated: number };
type ImportModulesOkC = { count: number };
type ImportModulesResponse = ImportModulesOkA | ImportModulesOkB | ImportModulesOkC | ApiErr;

// /api/import/enrollment response
type ImportEnrollmentOk = {
  studentsUpserted: number;
  enrollmentsUpserted: number;
};
type ImportEnrollmentResponse = ImportEnrollmentOk | ApiErr;

function safeParseJson<T>(raw: string): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function isErrWithMessage(v: unknown): v is ApiErr {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.error === "string";
}

function extractModules(v: unknown): ModuleOption[] | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;

  const modules = obj.modules;
  if (!Array.isArray(modules)) return null;

  const out: ModuleOption[] = [];
  for (const m of modules) {
    if (!m || typeof m !== "object") continue;
    const mm = m as Record<string, unknown>;

    const code = typeof mm.code === "string" ? mm.code : null;
    const name = typeof mm.name === "string" ? mm.name : null;
    const program =
      mm.program === null ? null : typeof mm.program === "string" ? mm.program : null;

    if (code && name) out.push({ code, name, program });
  }

  return out;
}

function extractUpsertCount(v: unknown): number | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;

  const a = obj.upserted;
  if (typeof a === "number") return a;

  const b = obj.insertedOrUpdated;
  if (typeof b === "number") return b;

  const c = obj.count;
  if (typeof c === "number") return c;

  return null;
}

function extractEnrollmentCounts(
  v: unknown
): { studentsUpserted: number; enrollmentsUpserted: number } | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const s = obj.studentsUpserted;
  const e = obj.enrollmentsUpserted;
  if (typeof s === "number" && typeof e === "number")
    return { studentsUpserted: s, enrollmentsUpserted: e };
  return null;
}

export default function ImportPage() {
  const [msg, setMsg] = useState("");

  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [modulesError, setModulesError] = useState<string | null>(null);

  // NEW: program + module selection (UI only)
  const [selectedProgram, setSelectedProgram] = useState<string>("");
  const [selectedModuleCode, setSelectedModuleCode] = useState<string>("");

  // ✅ IMPORTANT: Your real endpoint is /api/import/modules
  async function fetchModules(): Promise<ModuleOption[]> {
    const res = await fetch("/api/import/modules", { method: "GET" });
    const raw = await res.text();
    const parsed = safeParseJson<ModulesApiResponse>(raw);

    if (!res.ok) {
      const err =
        (parsed && isErrWithMessage(parsed) && parsed.error) || raw || `HTTP ${res.status}`;
      throw new Error(err);
    }

    const list = extractModules(parsed);
    if (!list) throw new Error("Unexpected response from /api/import/modules (modules list missing).");
    return list;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setModulesLoading(true);
      setModulesError(null);
      try {
        const list = await fetchModules();
        if (!cancelled) setModules(list);
      } catch (e) {
        const m = e instanceof Error ? e.message : "Failed to load modules";
        if (!cancelled) setModulesError(m);
      } finally {
        if (!cancelled) setModulesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Program options derived from modules
  const programOptions = useMemo(() => {
  const set = new Set<string>();

    for (const m of modules) {
      const p = (m.program ?? "").trim();
      if (!p) continue;

      // split "MSc CPM, MSc PM, MSc QS" -> ["MSc CPM", "MSc PM", "MSc QS"]
      for (const part of p.split(",")) {
        const name = part.trim();
        if (name) set.add(name);
      }
    }

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [modules]);

  // Filter modules by selected program (or show all)
  const filteredModules = useMemo(() => {
    if (!selectedProgram) return modules;

    return modules.filter((m) => {
      const p = (m.program ?? "").trim();
      if (!p) return false;

      const parts = p.split(",").map((x) => x.trim());
      return parts.includes(selectedProgram);
    });
  }, [modules, selectedProgram]);

  // When filtered list changes, auto-pick the first module (better UX)
  useEffect(() => {
    setSelectedModuleCode(filteredModules[0]?.code ?? "");
  }, [filteredModules]);

  // ✅ Module Master upload goes to /api/import/modules
  async function uploadModules(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("Uploading module master list...");

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;

    if (!fileInput.files?.[0]) {
      setMsg("Please choose a file.");
      return;
    }

    const fd = new FormData();
    fd.append("file", fileInput.files[0]);

    const res = await fetch("/api/import/modules", { method: "POST", body: fd });
    const raw = await res.text();
    const parsed = safeParseJson<ImportModulesResponse>(raw);

    if (!res.ok) {
      const err =
        (parsed && isErrWithMessage(parsed) && parsed.error) || raw || `HTTP ${res.status}`;
      setMsg(`Error: ${err}`);
      return;
    }

    const upserted = extractUpsertCount(parsed);
    setMsg(`✅ Modules imported${upserted != null ? `: ${upserted}` : ""}`);

    // Refresh module dropdown
    try {
      setModulesLoading(true);
      setModulesError(null);
      const list = await fetchModules();
      setModules(list);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed to refresh modules";
      setModulesError(m);
    } finally {
      setModulesLoading(false);
    }
  }

  // ✅ Enrollment upload goes to /api/import/enrollment (singular)
  async function uploadEnrollment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("Uploading enrollment...");

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("enrollmentFile") as HTMLInputElement;

    if (!fileInput.files?.[0]) {
      setMsg("Please choose an enrollment CSV.");
      return;
    }

    const fd = new FormData();
    fd.append("file", fileInput.files[0]);

    const res = await fetch("/api/import/enrollments", {
      method: "POST",
      body: fd,
    });

    const raw = await res.text();
    const parsed = safeParseJson<ImportEnrollmentResponse>(raw);

    if (!res.ok) {
      const err =
        (parsed && isErrWithMessage(parsed) && parsed.error) || raw || `HTTP ${res.status}`;
      setMsg(`Error: ${err}`);
      return;
    }

    const counts = extractEnrollmentCounts(parsed);
    if (!counts) {
      setMsg("Error: Unexpected response from enrollment import.");
      return;
    }

    setMsg(
      `✅ Enrollment imported. Students: ${counts.studentsUpserted}, Enrollments: ${counts.enrollmentsUpserted}`
    );
  }

  // ✅ Attendance upload goes to /api/import/attendance
  async function uploadAttendance(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("Uploading attendance...");

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("attendanceFile") as HTMLInputElement;

    const intakeEl = form.elements.namedItem("intake") as HTMLSelectElement | null;
    const yearEl = form.elements.namedItem("year") as HTMLInputElement | null;
    const moduleEl = form.elements.namedItem("moduleCode") as HTMLSelectElement | null;

    const intake = (intakeEl?.value ?? "").trim();
    const year = Number((yearEl?.value ?? "").trim());
    const moduleCode = (moduleEl?.value ?? "").trim().toUpperCase();

    if (!intake || !year || Number.isNaN(year)) {
      setMsg("Please select Intake + Year.");
      return;
    }

    if (!moduleCode) {
      setMsg("Please select the Module Code for this attendance report.");
      return;
    }

    if (!fileInput.files?.[0]) {
      setMsg("Please choose a Teams attendance CSV.");
      return;
    }

    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    fd.append("intake", intake);
    fd.append("year", String(year));
    fd.append("moduleCode", moduleCode);

    const res = await fetch("/api/import/attendance", {
      method: "POST",
      body: fd,
    });

    const raw = await res.text();
    const data = safeParseJson<AttendanceImportResponse>(raw);

    if (!res.ok) {
      const err =
        (data && isErrWithMessage(data) && data.error) || raw || `HTTP ${res.status}`;
      setMsg(`Error: ${err}`);
      return;
    }

    if (!data || !("ok" in data) || data.ok !== true) {
      setMsg("Error: Unexpected response from server.");
      return;
    }

    setMsg(
      `✅ Attendance imported. Cohort: ${data.intake} ${data.year}. Module: ${data.moduleCode}, rows: ${data.rowsRead}, eligible: ${data.eligibleCount}`
    );
  }

  // UI-only helpers (classes)
  const cardClass = "rounded-2xl border border-slate-200 bg-white shadow-sm";
  const sectionPad = "p-4 md:p-6";
  const labelClass = "block text-sm font-medium text-slate-700 mb-1";
  const inputClass =
    "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm " +
    "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300";
  const selectClass =
    "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm " +
    "focus:outline-none focus:ring-2 focus:ring-slate-300";
  const buttonClass =
    "h-10 rounded-xl border border-slate-200 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm " +
    "hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60 disabled:cursor-not-allowed";

  return (
  <div className="min-h-screen bg-slate-50">
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10 space-y-6">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">
          Import Data
        </h1>
        <p className="text-sm text-slate-600">
          Upload Teams attendance regularly. Module master & enrollment only when needed.
        </p>
      </header>

      {/* Status message */}
      {msg && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            msg.startsWith("✅")
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : msg.startsWith("Error:")
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          {msg}
        </div>
      )}

      {/* ✅ 3) Teams Attendance FIRST */}
      <section className={cardClass}>
        <div className={sectionPad}>
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">
              Teams Attendance <span className="text-slate-500 font-medium">(csv)</span>
            </h2>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Select cohort + module for this attendance report. Only emails ending with{" "}
              <span className="font-semibold">@stu.nexteducationgroup.com</span> are counted as eligible.
            </div>
          </div>

          <form onSubmit={uploadAttendance} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Intake</label>
                <select name="intake" className={selectClass} defaultValue="Summer" required>
                  <option value="Spring">Spring</option>
                  <option value="Summer">Summer</option>
                  <option value="Autumn">Autumn</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>Year</label>
                <input
                  name="year"
                  type="number"
                  min={2020}
                  max={2100}
                  defaultValue={2026}
                  className={inputClass}
                  required
                />
              </div>

              {/* Program dropdown */}
              <div className="md:col-span-3">
                <label className={labelClass}>Program</label>

                {modulesLoading ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    Loading programs…
                  </div>
                ) : modulesError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                    Failed to load modules: {modulesError}
                  </div>
                ) : (
                  <select
                    className={selectClass}
                    value={selectedProgram}
                    onChange={(e) => setSelectedProgram(e.target.value)}
                  >
                    <option value="">All programs</option>
                    {programOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Module dropdown */}
              <div className="md:col-span-3">
                <label className={labelClass}>Module code</label>

                {modulesLoading ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    Loading modules…
                  </div>
                ) : modulesError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                    Failed to load modules: {modulesError}
                  </div>
                ) : modules.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    No modules found. Upload the Module Master List first.
                  </div>
                ) : filteredModules.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    No modules found for the selected program.
                  </div>
                ) : (
                  <select
                    name="moduleCode"
                    className={selectClass}
                    value={selectedModuleCode}
                    onChange={(e) => setSelectedModuleCode(e.target.value)}
                    required
                  >
                    {filteredModules.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.code} — {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div>
              <label className={labelClass}>Attendance CSV</label>
              <input
                name="attendanceFile"
                type="file"
                accept=".csv"
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-xl file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-50"
              />
            </div>

            <button type="submit" className={buttonClass}>
              Upload attendance
            </button>
          </form>
        </div>
      </section>

      {/* ✅ Advanced / Rarely used */}
      <section className={cardClass}>
        <details className="group">
          <summary className="list-none cursor-pointer select-none px-4 md:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-slate-900">Advanced imports</span>

              {/* chevron */}
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="ml-1 h-4 w-4 text-slate-500 transition-transform duration-200 group-open:rotate-180"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z"
                  clipRule="evenodd"
                />
              </svg>
            </div>

            <span className="text-xs text-slate-500">
              Module master & Enrollment
            </span>
          </summary>

          <div className="border-t border-slate-200">
            <div className="p-4 md:p-6 space-y-6">
              {/* 1) Module Master */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Module Master List <span className="text-slate-500 font-medium">(xlsx)</span>
                  </h3>
                  <p className="text-sm text-slate-600">
                    Upload only when modules change.
                  </p>
                </div>

                <form onSubmit={uploadModules} className="mt-4 space-y-3">
                  <div>
                    <label className={labelClass}>File</label>
                    <input
                      name="file"
                      type="file"
                      accept=".xlsx"
                      className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-xl file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-50"
                    />
                  </div>

                  <button type="submit" className={buttonClass}>
                    Upload modules
                  </button>
                </form>
              </div>

              {/* 2) Enrollment */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Enrollment <span className="text-slate-500 font-medium">(csv)</span>
                  </h3>
                  <p className="text-sm text-slate-600">
                    Upload only when a new intake/cohort is added.
                  </p>
                </div>

                <form onSubmit={uploadEnrollment} className="mt-4 space-y-3">
                  <div>
                    <label className={labelClass}>File</label>
                    <input
                      name="enrollmentFile"
                      type="file"
                      accept=".csv"
                      className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-xl file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-50"
                    />
                  </div>

                  <button type="submit" className={buttonClass}>
                    Upload enrollment
                  </button>
                </form>
              </div>
            </div>
          </div>
        </details>
      </section>
    </div>
  </div>
);
}