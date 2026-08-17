import { expect, test } from "@playwright/test";

test("the application boots and renders the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Figure out where the six of you actually agree.")).toBeVisible();
});