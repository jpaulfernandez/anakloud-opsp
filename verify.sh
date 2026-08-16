#!/usr/bin/env bash
set -e
npm run typecheck
npm run lint
npm run test -- --run
npx playwright test --reporter=line
