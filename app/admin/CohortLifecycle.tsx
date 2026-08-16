"use client";

import { useState } from "react";

// F09-T05 — the cohort lifecycle controls on the admin dashboard (ui_ux.md §6
// "Cohort closed", spec.md §8/§9). The facilitator moves the cohort between
// draft / open / closed, pins the AI level (or leaves it automatic), and can
// delete the whole cohort — the delete requiring the cohort's name typed out
// as an explicit confirmation before it will act. The client is cosmetic: the
// real enforcement is the submitted-facilitator gate (F09-T01) and the
// server-side writes (POST/DELETE /api/admin/cohort), so a facilitator who can
// reach these buttons was already admitted server-side.

type CohortStatus = "draft" | "open" | "closed";

interface CohortState {
  name: string;
  status: CohortStatus;
  aiLevelPin: string | null;
}

const STATUS_LABEL: Record<CohortStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
};

const LEVEL_LABEL: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Automatic" },
  { value: "L0", label: "L0" },
  { value: "L1", label: "L1" },
  { value: "L2", label: "L2" },
  { value: "L3", label: "L3" },
];

export default function CohortLifecycle({
  initial,
}: {
  initial: CohortState;
}) {
  const [cohort, setCohort] = useState<CohortState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Delete is hidden behind an explicit confirmation that names the cohort.
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function update(body: { status?: CohortStatus; aiLevelPin?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cohort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("update failed");
      const json = await res.json();
      setCohort(json.cohort);
    } catch {
      setError("Could not update the cohort. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/cohort", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: typedName }),
      });
      if (!res.ok) {
        setDeleteError(
          res.status === 409
            ? "That doesn't match the cohort name. Nothing was deleted."
            : "Could not delete the cohort.",
        );
        return;
      }
      window.location.reload();
    } catch {
      setDeleteError("Could not delete the cohort.");
    } finally {
      setBusy(false);
    }
  }

  const pinValue = cohort.aiLevelPin ?? "auto";

  return (
    <section
      data-testid="cohort-lifecycle"
      className="mt-6 rounded-md border border-neutral-200 bg-white px-4 py-4 text-sm text-neutral-700"
    >
      <h2 className="text-base font-semibold text-neutral-900">Cohort</h2>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Status
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["draft", "open", "closed"] as CohortStatus[]).map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`cohort-status-${value}`}
                data-active={cohort.status === value}
                disabled={busy}
                onClick={() => update({ status: value })}
                className={`rounded-full border px-3 py-1 text-sm font-medium disabled:opacity-50 ${
                  cohort.status === value
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"
                }`}
              >
                {STATUS_LABEL[value]}
              </button>
            ))}
          </div>
          {cohort.status === "closed" && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              While closed, no one can change answers. Their OPSPs and PDFs stay
              accessible.
            </p>
          )}
        </div>

        <div>
          <label
            className="text-xs uppercase tracking-wide text-neutral-500"
            htmlFor="cohort-level-pin"
          >
            AI level
          </label>
          <select
            id="cohort-level-pin"
            data-testid="cohort-level-pin"
            disabled={busy}
            value={pinValue}
            onChange={(e) => update({ aiLevelPin: e.target.value })}
            className="mt-2 block w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700"
          >
            {LEVEL_LABEL.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error !== null && (
        <p data-testid="cohort-error" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-5 border-t border-neutral-100 pt-4">
        {!confirming ? (
          <button
            type="button"
            data-testid="cohort-delete-open"
            onClick={() => setConfirming(true)}
            className="text-sm font-medium text-red-700 hover:underline"
          >
            Delete the cohort
          </button>
        ) : (
          <div data-testid="cohort-delete-confirm">
            <p className="text-sm text-neutral-700">
              This deletes every answer, snapshot, draft and interaction in{" "}
              &ldquo;{cohort.name}&rdquo;. Type the cohort name to confirm:
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                data-testid="cohort-delete-name"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={cohort.name}
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700"
              />
              <button
                type="button"
                data-testid="cohort-delete-confirm-btn"
                disabled={busy || typedName !== cohort.name}
                onClick={confirmDelete}
                className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Delete cohort
              </button>
              <button
                type="button"
                data-testid="cohort-delete-cancel"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setTypedName("");
                  setDeleteError(null);
                }}
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700"
              >
                Cancel
              </button>
            </div>
            {deleteError !== null && (
              <p data-testid="cohort-delete-error" className="mt-2 text-sm text-red-700">
                {deleteError}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}