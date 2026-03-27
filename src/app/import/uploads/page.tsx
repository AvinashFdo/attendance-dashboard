"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";

type UploadRow = {
  id: string;
  moduleCode: string;
  intake: string;
  year: number;
  meetingName: string | null;
  startTime: string | null;
  scheduledDurationMin: number | null;
  attendanceCount: number;
  createdAt: string;
};

type ApiOk = {
  ok: true;
  sessions: UploadRow[];
};

type ApiErr = { error: string };

type ModuleOption = {
  code: string;
  name: string;
  program: string | null;
};

type ModulesApiOkA = { ok: true; modules: ModuleOption[] };
type ModulesApiOkB = { modules: ModuleOption[] };
type ModulesApiResponse = ModulesApiOkA | ModulesApiOkB | ApiErr;

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

function fmtDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

function fmtDateTime(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  }).format(d);
}

function fmtMinutes(min: number | null | undefined) {
  if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) return "-";
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;

  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

export default function UploadsPage() {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modulesLoading, setModulesLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("");
  const [selectedModuleCode, setSelectedModuleCode] = useState("");
  const [selectedIntake, setSelectedIntake] = useState("");
  const [selectedYear, setSelectedYear] = useState("");

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
    if (!list) {
      throw new Error("Unexpected response from /api/import/modules (modules list missing).");
    }

    return list;
  }

  async function loadUploads() {
    setLoading(true);
    setMsg("");

    try {
      const res = await fetch("/api/import/uploads", { cache: "no-store" });
      const data = (await res.json()) as ApiOk | ApiErr;

      if (!res.ok || !("ok" in data) || data.ok !== true) {
        throw new Error(("error" in data && data.error) || "Failed to load uploads");
      }

      setRows(data.sessions);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed to load uploads";
      setMsg(`Error: ${m}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUploads();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setModulesLoading(true);
      try {
        const list = await fetchModules();
        if (!cancelled) setModules(list);
      } catch (e) {
        const m = e instanceof Error ? e.message : "Failed to load modules";
        if (!cancelled) setMsg(`Error: ${m}`);
      } finally {
        if (!cancelled) setModulesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function deleteUpload(sessionId: string, meetingName: string | null) {
    const ok = window.confirm(
      `Delete this uploaded session?\n\n${meetingName ?? "Untitled session"}\n\nThis will remove the session and all related attendance rows.`
    );

    if (!ok) return;

    setDeletingId(sessionId);
    setMsg("");

    try {
      const res = await fetch("/api/import/uploads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || data.ok !== true) {
        throw new Error(data.error || "Delete failed");
      }

      setRows((prev) => prev.filter((r) => r.id !== sessionId));
      setMsg("✅ Upload deleted successfully.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Delete failed";
      setMsg(`Error: ${m}`);
    } finally {
      setDeletingId(null);
    }
  }

  const programOptions = useMemo(() => {
    const set = new Set<string>();

    for (const m of modules) {
      const p = (m.program ?? "").trim();
      if (!p) continue;

      for (const part of p.split(",")) {
        const name = part.trim();
        if (name) set.add(name);
      }
    }

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [modules]);

  const filteredModules = useMemo(() => {
    if (!selectedProgram) return modules;

    return modules.filter((m) => {
      const p = (m.program ?? "").trim();
      if (!p) return false;

      const parts = p.split(",").map((x) => x.trim());
      return parts.includes(selectedProgram);
    });
  }, [modules, selectedProgram]);

  useEffect(() => {
    if (!selectedModuleCode) return;

    const stillExists = filteredModules.some((m) => m.code === selectedModuleCode);
    if (!stillExists) setSelectedModuleCode("");
  }, [filteredModules, selectedModuleCode]);

  const yearOptions = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) set.add(r.year);
    return Array.from(set).sort((a, b) => b - a);
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ad = new Date(a.createdAt).getTime();
      const bd = new Date(b.createdAt).getTime();
      return bd - ad;
    });
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return sortedRows.filter((r) => {
      if (selectedModuleCode && r.moduleCode !== selectedModuleCode) return false;
      if (selectedIntake && r.intake !== selectedIntake) return false;
      if (selectedYear && String(r.year) !== selectedYear) return false;

      if (selectedProgram) {
        const moduleMeta = modules.find((m) => m.code === r.moduleCode);
        const p = (moduleMeta?.program ?? "").trim();
        const parts = p ? p.split(",").map((x) => x.trim()) : [];
        if (!parts.includes(selectedProgram)) return false;
      }

      if (q) {
        const haystack = [
          r.moduleCode,
          r.intake,
          String(r.year),
          r.meetingName ?? "",
          fmtDate(r.startTime),
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    sortedRows,
    search,
    selectedProgram,
    selectedModuleCode,
    selectedIntake,
    selectedYear,
    modules,
  ]);

  const cardClass = "rounded-2xl border border-slate-200 bg-white shadow-sm";
  const labelClass = "block text-sm font-medium text-slate-700 mb-1";
  const inputClass =
    "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm " +
    "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300";
  const selectClass =
    "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm " +
    "focus:outline-none focus:ring-2 focus:ring-slate-300";
  const deleteButtonClass =
    "h-9 rounded-xl border border-slate-200 bg-rose-600 px-3 text-sm font-medium text-white shadow-sm " +
    "hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-60 disabled:cursor-not-allowed";
  const clearButtonClass =
    "h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm " +
    "hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-300";

  return (
    <AppShell
      title="Uploaded Sessions"
      subtitle="Review uploaded attendance sessions and delete mistakes when needed."
    >
      {msg && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            msg.startsWith("✅")
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {msg}
        </div>
      )}

      <section className={cardClass}>
        <div className="p-4 md:p-6">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">Filters</h2>
            <p className="text-sm text-slate-600">
              Narrow down uploads before deleting a session.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className={labelClass}>Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Meeting title, date, module..."
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Program</label>
              {modulesLoading ? (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  Loading...
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

            <div>
              <label className={labelClass}>Module</label>
              {modulesLoading ? (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  Loading...
                </div>
              ) : (
                <select
                  className={selectClass}
                  value={selectedModuleCode}
                  onChange={(e) => setSelectedModuleCode(e.target.value)}
                >
                  <option value="">All modules</option>
                  {filteredModules.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.code} - {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className={labelClass}>Intake</label>
              <select
                className={selectClass}
                value={selectedIntake}
                onChange={(e) => setSelectedIntake(e.target.value)}
              >
                <option value="">All intakes</option>
                <option value="Spring">Spring</option>
                <option value="Summer">Summer</option>
                <option value="Autumn">Autumn</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Year</label>
              <select
                className={selectClass}
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
              >
                <option value="">All years</option>
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              {filteredRows.length} session{filteredRows.length === 1 ? "" : "s"} shown
            </div>

            <button
              type="button"
              className={clearButtonClass}
              onClick={() => {
                setSearch("");
                setSelectedProgram("");
                setSelectedModuleCode("");
                setSelectedIntake("");
                setSelectedYear("");
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      </section>

      <section className={cardClass}>
        <div className="p-4 md:p-6">
          {loading ? (
            <div className="text-sm text-slate-600">Loading uploaded sessions...</div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No uploaded sessions found for the current filters.
            </div>
          ) : (
            <div className="overflow-auto rounded-2xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="py-3 px-4 text-left font-medium whitespace-nowrap">Date</th>
                    <th className="py-3 px-4 text-left font-medium">Meeting title</th>
                    <th className="py-3 px-4 text-left font-medium whitespace-nowrap">Module</th>
                    <th className="py-3 px-4 text-left font-medium whitespace-nowrap">Intake</th>
                    <th className="py-3 px-4 text-left font-medium whitespace-nowrap">Year</th>
                    <th className="py-3 px-4 text-right font-medium whitespace-nowrap">Scheduled</th>
                    <th className="py-3 px-4 text-right font-medium whitespace-nowrap">Rows</th>
                    <th className="py-3 px-4 text-left font-medium whitespace-nowrap">Uploaded</th>
                    <th className="py-3 px-4 text-right font-medium whitespace-nowrap">Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((r, idx) => (
                    <tr
                      key={r.id}
                      className={`border-b border-slate-100 ${
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                      } hover:bg-slate-50`}
                    >
                      <td className="py-3 px-4 whitespace-nowrap text-slate-900">
                        {fmtDate(r.startTime)}
                      </td>

                      <td className="py-3 px-4 text-slate-900">
                        <div className="max-w-[480px] leading-snug">
                          {r.meetingName ?? "-"}
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                        {r.moduleCode}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                        {r.intake}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-slate-700 tabular-nums">
                        {r.year}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-right tabular-nums text-slate-700">
                        {fmtMinutes(r.scheduledDurationMin)}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-right tabular-nums text-slate-900">
                        {r.attendanceCount}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                        {fmtDateTime(r.createdAt)}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          className={deleteButtonClass}
                          disabled={deletingId === r.id}
                          onClick={() => deleteUpload(r.id, r.meetingName)}
                        >
                          {deletingId === r.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
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