// Build-time step for F11-T05. Runs after `next build` and scans the
// client-only output for any ANTHROPIC_API_KEY reference or value. Exits
// non-zero if a leak is found, failing the build (spec.md §8, §9). Wired into
// the standard build in package.json: `next build && npm run check:client-bundle`.

import { resolve } from "node:path";
import {
  AI_KEY_ENV,
  CLIENT_BUNDLE_DIR,
  findBundleViolations,
  keyNeedles,
} from "../lib/client-bundle-check";

const root = resolve(process.cwd(), CLIENT_BUNDLE_DIR);
const violations = findBundleViolations(root, keyNeedles());

if (violations.length > 0) {
  console.error(
    `F11-T05 build check failed: ${AI_KEY_ENV} leaked into ${violations.length} client bundle file(s).`,
  );
  for (const violation of violations) {
    console.error(`  - ${violation.file} contains "${violation.needle}"`);
  }
  console.error("The AI key stays server-side (spec.md §8). Fix the client reference and rebuild.");
  process.exit(1);
}

console.log(`F11-T05 build check passed: no ${AI_KEY_ENV} reference in client bundles.`);