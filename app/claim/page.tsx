"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// The invite-link landing (F02-T02). The token arrives in this initial URL —
// the link *is* the credential — and is POSTed to /api/session/claim to be
// exchanged for the httpOnly session cookie. On success we navigate to a
// token-free URL and the token stops appearing anywhere. On any failure we
// land on the single neutral invalid screen (F02-T01), which is identical for
// unknown, revoked and closed-cohort tokens, so nothing about which applied
// is disclosed. The token is never rendered back into a URL or the page.

export default function ClaimPage() {
  return (
    <Suspense fallback={null}>
      <ClaimInner />
    </Suspense>
  );
}

function ClaimInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params?.get("token") ?? "";

  useEffect(() => {
    if (token === "") {
      router.replace("/claim/invalid");
      return;
    }

    let cancelled = false;
    let redirectTo = "/claim/invalid";

    (async () => {
      try {
        const response = await fetch("/api/session/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await response.json()) as { ok?: boolean; redirectTo?: string };
        if (data?.ok === true && typeof data.redirectTo === "string") {
          redirectTo = data.redirectTo;
        }
      } catch {
        // Network failure is treated like an unusable link: the same neutral
        // screen, with no reason shown.
      }
      if (cancelled) return;
      router.replace(redirectTo);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, token]);

  return (
    <main>
      <p>Claiming your session&hellip;</p>
    </main>
  );
}