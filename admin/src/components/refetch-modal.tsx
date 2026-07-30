"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Modal, SourceBadge, Spinner, StatusBadge } from "./ui";
import type { SiteFilters } from "@/lib/types";

interface SummaryRow {
  source: string;
  status: string;
  count: number;
}
interface FailureRow {
  url: string;
  failure_type: string | null;
  error: string | null;
}

type Phase = "confirm" | "running" | "done" | "error";

export function RefetchModal({
  open,
  onClose,
  ids,
  filters,
  targetCount,
}: {
  open: boolean;
  /** Called on close; `ran` is true if a refetch actually executed. */
  onClose: (ran: boolean) => void;
  /** Explicit selection; when empty, `filters` scope is used. */
  ids: number[];
  filters: SiteFilters;
  targetCount: number;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [analyze, setAnalyze] = useState(true);
  const [lines, setLines] = useState<{ phase: string; line: string }[]>([]);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [summary, setSummary] = useState<SummaryRow[] | null>(null);
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const ranRef = useRef(false);

  // reset state each time the modal opens
  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setAnalyze(true);
      setLines([]);
      setSummary(null);
      setFailures([]);
      setErrorMsg(null);
      setCurrentStep("");
      ranRef.current = false;
    }
  }, [open]);

  // auto-scroll log
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const start = useCallback(async () => {
    setPhase("running");
    ranRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/refetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          ids.length ? { ids, analyze } : { filters, analyze }
        ),
        signal: controller.signal,
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let sawError = false;
      let gotSummary = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(part);
          } catch {
            continue;
          }
          if (ev.type === "phase") {
            setCurrentStep(String(ev.message ?? ev.name));
            setLines((l) => [
              ...l.slice(-800),
              { phase: "step", line: `— ${ev.message ?? ev.name}` },
            ]);
          } else if (ev.type === "log") {
            setLines((l) => [
              ...l.slice(-800),
              { phase: String(ev.phase ?? ""), line: String(ev.line ?? "") },
            ]);
          } else if (ev.type === "summary") {
            gotSummary = true;
            setSummary(ev.bySourceStatus as SummaryRow[]);
            setFailures((ev.failures as FailureRow[]) ?? []);
          } else if (ev.type === "error") {
            sawError = true;
            setErrorMsg(String(ev.message));
            setLines((l) => [
              ...l.slice(-800),
              { phase: "error", line: `✗ ${ev.message}` },
            ]);
          }
        }
      }
      // partial errors with a delivered summary still count as a finished run
      setPhase(sawError && !gotSummary ? "error" : "done");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setLines((l) => [...l, { phase: "error", line: "— cancelled" }]);
        setPhase("done");
      } else {
        setErrorMsg(String(err instanceof Error ? err.message : err));
        setPhase("error");
      }
    }
  }, [ids, filters, analyze]);

  const cancel = () => abortRef.current?.abort();
  const close = () => {
    if (phase === "running") cancel();
    onClose(ranRef.current);
  };

  const scopeLabel = ids.length
    ? `${ids.length} selected site${ids.length === 1 ? "" : "s"}`
    : `${targetCount.toLocaleString("en-US")} site${targetCount === 1 ? "" : "s"} matching the current filters`;

  return (
    <Modal open={open} onClose={close} title="Refetch sites" wide>
      {phase === "confirm" && (
        <div className="flex flex-col gap-4 p-5">
          <p className="text-sm text-ink-2">
            This resets <span className="font-semibold text-ink">{scopeLabel}</span> to{" "}
            <span className="font-mono text-xs">pending</span> and re-runs the
            existing pipeline: Playwright crawl
            {analyze ? " → Gemini Vision scoring" : ""}. Existing scores are
            overwritten when the new analysis lands.
          </p>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={analyze}
              onChange={(e) => setAnalyze(e.target.checked)}
              className="accent-accent"
            />
            Re-run Gemini Vision scoring after the crawl
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={start} disabled={targetCount === 0 && ids.length === 0}>
              Start refetch
            </Button>
          </div>
        </div>
      )}

      {phase !== "confirm" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-sm">
            {phase === "running" ? (
              <>
                <Spinner />
                <span className="text-ink-2">{currentStep || "Working…"}</span>
              </>
            ) : phase === "error" ? (
              <Badge tone="bad">failed</Badge>
            ) : (
              <Badge tone="ok">completed</Badge>
            )}
          </div>

          <div
            ref={logRef}
            className="log-scroll min-h-40 flex-1 overflow-y-auto bg-surface px-5 py-3 font-mono text-[12px] leading-5 text-ink-2"
          >
            {lines.map((l, i) => (
              <div
                key={i}
                className={
                  l.phase === "error"
                    ? "text-bad-text"
                    : l.phase === "step"
                      ? "font-semibold text-ink"
                      : ""
                }
              >
                {l.line}
              </div>
            ))}
            {lines.length === 0 && <span className="text-ink-3">Starting…</span>}
          </div>

          {errorMsg && phase === "error" && (
            <div className="border-t border-line bg-bad-soft px-5 py-2.5 text-sm text-bad-text">
              {errorMsg}
            </div>
          )}

          {summary && (
            <div className="border-t border-line px-5 py-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                Result by source
              </h3>
              <div className="flex flex-wrap gap-2">
                {summary.map((row, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-sm">
                    <SourceBadge source={row.source} />
                    <StatusBadge status={row.status} />
                    <span className="font-semibold text-ink">{row.count}</span>
                  </span>
                ))}
              </div>
              {failures.length > 0 && (
                <div className="mt-3">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    Failures ({failures.length})
                  </h3>
                  <ul className="max-h-28 overflow-y-auto text-xs text-ink-2 log-scroll">
                    {failures.map((f, i) => (
                      <li key={i} className="truncate py-0.5">
                        <span className="font-mono">{f.url}</span>
                        {" — "}
                        <span className="text-bad-text">{f.failure_type ?? "unknown"}</span>
                        {f.error ? `: ${f.error.split("\n")[0].slice(0, 80)}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            {phase === "running" ? (
              <Button variant="danger" onClick={cancel}>
                Cancel run
              </Button>
            ) : (
              <Button variant="primary" onClick={close}>
                Close &amp; refresh table
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
