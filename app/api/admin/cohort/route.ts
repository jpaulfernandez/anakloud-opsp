import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import {
  CohortNameMismatchError,
  CohortNotFoundError,
  deleteCohort,
  fetchCohortLive,
  parseCohortLevelPin,
  parseCohortStatus,
  resolveServedLevel,
  setCohortLevelPin,
  setCohortStatus,
  type CohortLevelPin,
  type CohortStatus,
} from "@/lib/cohort-lifecycle";

// F09-T05 — cohort lifecycle (spec.md §8/§9, tech_infrastructure.md §3/§9,
// ui_ux.md §6). The facilitator moves their cohort between draft / open /
// closed, pins its AI level (or leaves it automatic), and deletes the whole
// cohort in one cascading, name-confirmed action. Everything is gated by the
// submitted-facilitator gate (F09-T01) and scoped to the session's own cohort
// — no client-supplied cohortId is ever read.
//
//   GET    /api/admin/cohort   current status, pin and served level
//   POST   /api/admin/cohort   update status and/or level pin
//   DELETE /api/admin/cohort   delete the cohort, requiring its name
//
// The response payload is deliberately content-free (FR-29): it carries cohort
// lifecycle facts, never any answer text.

/** The one, reason-free 400 for a malformed or wrong-shaped body. */
function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

/** The one 404 for a cohort that no longer exists. */
function notFound() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

/** Reassemble the lifecycle state plus the cohort-pinned served level. */
async function cohortWithServedLevel(db: ReturnType<typeof createDbClient>, cohortId: string) {
  const cohort = await fetchCohortLive(db, cohortId);
  if (!cohort) return null;
  return { ...cohort, servedLevel: resolveServedLevel(loadConfig().aiLevel, cohort.aiLevelPin) };
}

export async function GET() {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const cohort = await cohortWithServedLevel(db, session.cohortId);
    if (!cohort) return notFound();
    return NextResponse.json({ ok: true, cohort });
  } finally {
    await db.end();
  }
}

/**
 * Update the cohort's status and/or AI level pin. At least one of the two must
 * be present. cohortId is the session's own, so a facilitator can only ever
 * reconfigure their own cohort — never another cohort's.
 */
export async function POST(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest();
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return badRequest();
    const b = body as Record<string, unknown>;

    const hasStatus = "status" in b;
    const hasPin = "aiLevelPin" in b;
    if (!hasStatus && !hasPin) return badRequest();

    let nextStatus: CohortStatus | undefined;
    if (hasStatus) {
      const s = parseCohortStatus(b.status);
      if (s === null) return badRequest();
      nextStatus = s;
    }
    let nextPin: CohortLevelPin | undefined;
    if (hasPin) {
      const p = parseCohortLevelPin(b.aiLevelPin);
      if (p === null) return badRequest();
      nextPin = p;
    }

    if (nextStatus !== undefined) await setCohortStatus(db, session.cohortId, nextStatus);
    if (nextPin !== undefined) await setCohortLevelPin(db, session.cohortId, nextPin);

    const cohort = await cohortWithServedLevel(db, session.cohortId);
    return NextResponse.json({ ok: true, cohort });
  } finally {
    await db.end();
  }
}

/**
 * Delete the whole cohort and everything under it. An explicit confirmation
 * naming the cohort is required and enforced atomically in the database (a
 * mismatch deletes nothing). 409 is the conflict response when the name typed
 * does not match, so the UI can prompt the facilitator again.
 */
export async function DELETE(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest();
    }
    const name = (body as { name?: unknown })?.name;
    if (typeof name !== "string" || name === "") return badRequest();

    try {
      await deleteCohort(db, session.respondentId, session.cohortId, name);
    } catch (err) {
      if (err instanceof CohortNameMismatchError) {
        return NextResponse.json(
          { ok: false, reason: "name_confirmation" },
          { status: 409 },
        );
      }
      if (err instanceof CohortNotFoundError) return notFound();
      throw err;
    }
    return NextResponse.json({ ok: true, deleted: true });
  } finally {
    await db.end();
  }
}