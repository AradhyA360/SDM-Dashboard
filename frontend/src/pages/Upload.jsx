import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  FlaskConical,
  AlertTriangle,
  Info,
  History,
  Database,
} from "lucide-react";
import api from "../services/api";
import { StateBadge, PriorityBadge, AtRiskBadge } from "../components/Badges";

const UPLOAD_TYPES = [
  {
    key: "itsm",
    label: "ITSM Dump File",
    sublabel: "Ticket Dump",
    icon: Database,
    description:
      "The full ServiceNow-style ticket export — one row per ticket.",
    endpoint: "/upload",
  },
  {
    key: "history",
    label: "Individual Ticket History",
    sublabel: "Queue movement + sentiment analysis",
    icon: History,
    description:
      "Per-ticket queue movement — Incident Number, Queue, Timestamp, Status, Assigned Associate, Time Spent — plus an optional Comment/Notes column. Powers the ticket-detail timeline, and any comment provided is automatically scored for sentiment.",
    endpoint: "/upload/history",
  },
];

function ValidationReport({ report }) {
  const notes = [];
  if (report.missing_columns?.length) {
    notes.push(
      `${report.missing_columns.length} column${report.missing_columns.length === 1 ? "" : "s"} weren't in your file and were filled with defaults: ${report.missing_columns.join(", ")}`,
    );
  }
  if (report.invalid_priority_count > 0) {
    notes.push(
      `${report.invalid_priority_count} row${report.invalid_priority_count === 1 ? "" : "s"} had an unrecognized Priority value and were set to P4`,
    );
  }
  if (report.invalid_state_count > 0) {
    notes.push(
      `${report.invalid_state_count} row${report.invalid_state_count === 1 ? "" : "s"} had an unrecognized State value and were set to New`,
    );
  }
  if (report.missing_sla_due_count > 0) {
    notes.push(
      `${report.missing_sla_due_count} row${report.missing_sla_due_count === 1 ? "" : "s"} had no SLA Due Date, so it was computed from Opened + the priority's SLA window`,
    );
  }
  if (report.auto_generated_numbers > 0) {
    notes.push(
      `No Number column was found — ticket numbers (INC00...) were generated automatically`,
    );
  }

  if (notes.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
        <CheckCircle2 size={16} /> Every column matched cleanly — nothing needed
        correcting.
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
      <p className="mb-2 flex items-center gap-2 font-medium">
        <AlertTriangle size={15} /> A few things were auto-corrected during
        import
      </p>
      <ul className="ml-1 space-y-1 text-xs leading-relaxed">
        {notes.map((n, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-amber-400">•</span> {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Upload() {
  const [uploadType, setUploadType] = useState("itsm");
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const activeType = UPLOAD_TYPES.find((t) => t.key === uploadType);

  function switchType(key) {
    setUploadType(key);
    setFile(null);
    setResult(null);
    setError("");
  }

  function handleFiles(files) {
    const f = files[0];
    if (!f) return;
    if (!/\.(csv|xlsx|xls)$/i.test(f.name)) {
      setError("Please upload a .csv or .xlsx file");
      return;
    }
    setError("");
    setResult(null);
    setFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post(activeType.endpoint, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDemoUpload() {
    setDemoLoading(true);
    setError("");
    setResult(null);
    try {
      const { data } = await api.post("/upload/demo");
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load demo data");
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Import ITSM Data
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Import data from your ITSM tool — the ticket dump, or per-ticket
            queue-movement history with sentiment analysis.
          </p>
        </div>
        {uploadType === "itsm" && (
          <button
            onClick={handleDemoUpload}
            disabled={demoLoading || uploading}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <FlaskConical size={15} />{" "}
            {demoLoading ? "Loading demo…" : "Try Demo Data"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {UPLOAD_TYPES.map((t) => {
          const Icon = t.icon;
          const active = uploadType === t.key;
          return (
            <button
              key={t.key}
              onClick={() => switchType(t.key)}
              className={`card flex flex-col items-start gap-2 p-4 text-left transition-colors ${
                active
                  ? "border-brand-500 ring-1 ring-brand-500"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
              }`}
            >
              <div
                className={`flex items-center gap-2 text-sm font-semibold ${active ? "text-brand-600 dark:text-brand-400" : ""}`}
              >
                <Icon size={16} /> {t.label}
              </div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {t.sublabel}
              </p>
              <p className="text-xs leading-relaxed text-slate-500">
                {t.description}
              </p>
            </button>
          );
        })}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`card flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-14 text-center transition-colors ${
          dragOver
            ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
            : "border-slate-200 dark:border-slate-600"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <UploadCloud size={36} className="text-brand-500" />
        <div>
          <p className="font-semibold">
            Drag & drop your {activeType.label.toLowerCase()} file here
          </p>
          <p className="text-sm text-slate-500">
            or click to browse — supports .csv and .xlsx
          </p>
        </div>
        {file && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-700">
            <FileSpreadsheet size={14} /> {file.name}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          <XCircle size={16} /> {error}
        </div>
      )}

      {file && !result && (
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="btn-primary"
        >
          {uploading ? "Uploading & processing…" : "Upload & Process"}
        </button>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            <CheckCircle2 size={16} /> Processed {result.row_count} rows
            successfully.
          </div>

          {result.validation_report && (
            <ValidationReport report={result.validation_report} />
          )}

          {uploadType === "itsm" && result.columns && (
            <div className="card overflow-x-auto p-5">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
                <Info size={14} className="text-slate-400" /> Preview (first 10
                rows)
              </p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700">
                    {result.columns.map((c) => (
                      <th
                        key={c}
                        className="whitespace-nowrap px-3 py-2 font-medium text-slate-500"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-slate-50 dark:border-slate-700/50"
                    >
                      {result.columns.map((c) => (
                        <td key={c} className="whitespace-nowrap px-3 py-2">
                          {c === "State" ? (
                            <StateBadge value={row[c]} />
                          ) : c === "Priority" ? (
                            <PriorityBadge value={row[c]} />
                          ) : c === "At Risk" ? (
                            <AtRiskBadge value={row[c]} />
                          ) : (
                            row[c]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {uploadType === "history" && (
            <div className="card p-5 text-sm">
              <p className="font-semibold">
                {result.incidents_covered} ticket
                {result.incidents_covered === 1 ? "" : "s"} now have
                queue-movement history.
              </p>
              {result.duplicate_rows_skipped > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  {result.duplicate_rows_skipped} row
                  {result.duplicate_rows_skipped === 1 ? "" : "s"} matched an
                  existing entry and were skipped as duplicates.
                </p>
              )}
              {result.sample_incidents?.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  Includes: {result.sample_incidents.join(", ")}
                  {result.incidents_covered > result.sample_incidents.length
                    ? "…"
                    : ""}
                </p>
              )}
              {result.rows_with_comment > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-700">
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    Sentiment analysis ran on {result.rows_with_comment} row
                    {result.rows_with_comment === 1 ? "" : "s"} with a
                    comment:
                  </span>
                  {["Positive", "Neutral", "Negative"].map((label) =>
                    result.sentiment_breakdown?.[label] ? (
                      <span
                        key={label}
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          label === "Positive"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : label === "Negative"
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {label}: {result.sentiment_breakdown[label]}
                      </span>
                    ) : null,
                  )}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Open any ticket's detail page (click its Incident Number on
                the Tickets page) to see this history in context.
              </p>
            </div>
          )}

          {uploadType === "itsm" && (
            <button
              onClick={() => navigate("/dashboard")}
              className="btn-primary"
            >
              View Dashboard →
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}
