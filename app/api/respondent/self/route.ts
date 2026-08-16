import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";
import { isProvidedDisplayName, setRespondentName } from "@/lib/respondent";

// Welcome name entry submit (F02-T04, FR-2, ui_ux.md §4.1).
//
// PATCH /api/respondent/self — clears name entry by persisting the display
// name and, when given, the optional email that exists only to resend a lost
// link. Auth is the httpOnly session cookie alone: F02-T06's requireApiSession
// resolves the session and returns 401 when the cookie is missing or fails
// signature verification. The name is the one required field and the one thing
// validated, and even that is only "non-blank": FR-2's SHALL NOT on language,
// script and spelling means the server must accept any non-empty way of
// writing one's own name. A blank email is stored as null, so having once
// filled it and then clearing the field drops the address. No branch writes
// the name or email to a log sink.

export async function PATCH(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireApiSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const body = (await request.json()) as { name?: unknown; email?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    if (!isProvidedDisplayName(name)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const email = typeof body.email === "string" ? body.email : "";

    await setRespondentName(db, session.respondentId, name, email);
    return NextResponse.json({ ok: true });
  } finally {
    await db.end();
  }
}