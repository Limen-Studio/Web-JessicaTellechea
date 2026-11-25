# Apply progress: booking-request-notification

**Mode**: Strict TDD (`npm run test:unit`, runner `node --test` + strip-types). **Batch 1**: Phases 1-5 (Phase 6 manual, pending).

## Status

Tasks 1.1-5.5 complete (17/26 total; 6.1-6.9 manual, not started).

Baseline before changes: 148/148 passing. Final: 182/182 passing; `npm run check` 0 errors; `npm run lint:encoding` OK. `npm run build` NOT run (manual, Phase 6).

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 env types | (type-only) | n/a | 148/148 | n/a (types only; verified by `check`) | `check` green | skipped: pure type declaration | none needed |
| 1.1/1.2 `peticionId` | `tests/unit/upstream.test.ts` | Unit | 24/24 file, 148 suite | 2 failed (`peticionId` missing on received/confirmed and on the existing deepEqual) | 26/26 | number, numeric string, 9 invalid shapes (absent, 0, -5, "12a", 1.5, 2^60, huge string, null, "") | none needed |
| 2.1/2.2 content | `tests/unit/notification-content.test.ts` | Unit (pure) | N/A (new) | `ERR_MODULE_NOT_FOUND` | 10/10 (one over-strict assertion on id `0` corrected to `-5`: spec is `^\d+$`) | 3 subjects, 2 specialties/centros, winter/summer/UTC time, comments, escaping, link variants | merged duplicate import |
| 3.1/3.2 config | `tests/unit/notify.test.ts` | Unit | N/A (new) | `ERR_MODULE_NOT_FOUND` | 5/5 | each required var missing/blank, bad account id, bad emails incl. CR/LF, NOTIFY_ON variants, panel URL variants | none needed |
| 3.3/3.4 send | `tests/unit/notify.test.ts` | Unit | 5/5 | SyntaxError: no export `sendNotification` | 9/9 | success; 401/429/500/success:false/invalid JSON/network/TimeoutError; real AbortSignal timeout; no log on success | none needed |
| 3.5/3.6 schedule | `tests/unit/notify.test.ts` | Unit | 9/9 | SyntaxError: no export `scheduleBookingNotification` | 13/13 | no config, filtered status, enabled status, 3 statuses/links, sync + throwing `waitUntil` + invalid date | none needed |
| 4.1/4.2 handler hook | `tests/unit/booking-handlers.test.ts` | Unit (handler, injected fetch/waitUntil) | 30/30 | 6 failed (received, confirmed, unknown, ON filter, peticionId link, console/PII with sends); negative/identical-response guards already held | 38/38 | 15 no-email outcomes, 7 byte-identical response variants x 3 upstream outcomes | none needed |
| 5.2-5.5 docs | n/a | n/a | n/a | n/a | `lint:encoding` OK | n/a | n/a |

### Test summary
- Total tests: 182 (148 pre-existing + 34 new). All passing.
- Layers: Unit only (no integration/E2E tooling). Pure functions created: `buildNotification`, `resolvePanelLink`, `escapeHtml`, `readNotifyConfig`, `parsePeticionId`.

## Files

- Created: `functions/_lib/notification-content.ts`, `functions/_lib/notify.ts`, `tests/unit/notification-content.test.ts`, `tests/unit/notify.test.ts`.
- Modified: `functions/_lib/upstream.ts` (`peticionId?`), `functions/_lib/handlers.ts` (step 7 hook), `functions/_lib/env.ts` (6 optional vars), `tests/unit/upstream.test.ts`, `tests/unit/booking-handlers.test.ts` (harness gains `email` kind, `pending`, `flush`), `.dev.vars.example`, `AGENTS.md`, `README.md`, `docs/stack-and-deployment-context.md`.

## DRAFT copy (pending user review, AD-6)

Marked `// DRAFT copy — pending user review` in `notification-content.ts`: three subjects (exact per spec), status labels (`Pendiente de gestionar`, `Confirmada automáticamente`, `Resultado desconocido`), action lines, field labels, `Gestionar en el panel de Nubimed`, comments note.

## Deviations / notes

- Existing `deepEqual` in `upstream.test.ts` (`createPeticion` POST payload test and "omits comments" test) now expects the internal `peticionId` (77 / 78). Client responses unchanged (all handler tests unchanged and green).
- `scheduleBookingNotification` takes `Pick<UpstreamDeps, 'fetch' | 'waitUntil'>` (not full `UpstreamDeps`); `handlers.ts` passes `deps` as-is. Equivalent to design.
- `NotifyStatus` is defined in `notification-content.ts` (to avoid a notify->content->notify cycle) and re-exported from `notify.ts`.
- Test weekday: 2026-12-02 is a Wednesday ("miércoles 2/12/2026, 09:30 (hora de Madrid)"); the "martes" in tasks.md was only a format example.
- `AbortSignal.timeout` timers are unref'd: the timeout test keeps the loop alive with a `setTimeout`.
- `AGENTS.md`/README/docs previously only mention the old proxy for the Function env; only the notification vars were added (no rewrite of the stale BFF env docs).

## Risks

- `from` as plain string is unverified against the live API (Phase 6.5).
- Email Sending is beta; failure is silent by design (single generic `booking-notify <status|network>` line).
- Docs for the Nubimed BFF env (`NUBIMED_API_*`, `TURNSTILE_SECRET_KEY`) are not in AGENTS/README (pre-existing gap, out of scope).

## Remaining

- Phase 6 (6.1-6.9): manual, user-owned.
