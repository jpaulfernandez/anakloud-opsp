import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { resolveSession, SESSION_COOKIE } from "@/lib/session";
import { isProvidedDisplayName, setRespondentName } from "@/lib/respondent";

// Welcome name entry submit (F02-T04, FR-2, ui_ux.md §4.1).
//
// PATCH /api/respondent/self — clears name entry by persisting the display
// name and, when given, the optional email that exists only to resend a lost
// link. Auth is the httpOnly session cookie alone; a missing or unverifiable
// session is 401. The name is the one required field and the one thing
// validated, and even that is only "non-blank": FR-2's SHALL NOT on language,
// script and spelling means the server must accept any non-empty way of
// writing one's own name. A blank email is stored as null, so having once
// filled it and then clearing the field drops the address. No branch writes
// the name or email to a log sink.

export async function PATCH(request: Request) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  const db = createDbClient();
  await db.connect();
  try {
    const session = await resolveSession(db, token);
    if (!session) return NextResponse.json({ ok: false }, { status: 401 });

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