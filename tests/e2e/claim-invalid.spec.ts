import { expect, test } from "@playwright/test";

// F02-T01 — the one neutral screen for an unusable invite. Route is static (no
// database), and it is the shared destination for an unknown, revoked or
// closed-cohort token; a single screen means it cannot leak which applied.
// The revoked-vs-unknown identity is asserted at the DB layer in
// invites.integration.test.ts; here we check the screen itself renders the
// neutral copy and gives no reason.
test("the invalid-invite screen is neutral and discloses no reason", async ({ page }) => {
  await page.goto("/claim/invalid");
  await expect(
    page.getByRole("heading", { level: 1, name: "This link isn't valid any more." }),
  ).toBeVisible();
  await expect(page.getByText("facilitator for a fresh link")).toBeVisible();
});