# Apply Progress: nubimed-api-booking

Mode: Strict TDD (pure modules). Store: openspec. Branch: `feat/nubimed-api-booking`.

## Batch 1 — Phases 0, 1, 2 (DONE, 19/19 tasks)

### Phase 0 — Repo security
- [x] 0.1 `.gitignore`: `.dev.vars`, `.dev.vars.*`, `!.dev.vars.example`, `.wrangler/`. `git check-ignore -v` confirms `.dev.vars` and `.wrangler/x` ignored; `.dev.vars.example` un-ignored (negation).
- [x] 0.2 `.dev.vars.example`: names only, no values. Turnstile test secrets NOT copied (could not verify against current docs in this phase; only a pointer comment).

### Phase 1 — Runner
- [x] 1.1 `package.json` script `test:unit` = `node --experimental-strip-types --test tests/unit/*.test.ts`.
- [x] 1.2 `tests/unit/smoke.test.ts` imports `horizon.ts` (pure) with `.ts` extension.
- [x] 1.3 `npm run check`: tests and `.ts`-extension imports type-check with NO tsconfig change (`allowImportingTsExtensions: true` comes from `astro/tsconfigs/base`). `tsconfig.json` untouched.
- [x] 1.4 check + test:unit green.

### Phase 2 — Pure modules (RED -> GREEN evidence)

| Pair | RED (`npm run test:unit`) | GREEN |
|---|---|---|
| 2.1/2.2 catalog | `ERR_MODULE_NOT_FOUND ... catalog.ts` (13 tests, 1 suite failing at import) | 13 pass / 0 fail |
| 2.1 amend (string `'3'` must be null) | `not ok 9 - specialty must be the numeric id` (old impl accepted `'3'`) | 13 pass after minimal fix |
| 2.3/2.4 api-contract | `ERR_MODULE_NOT_FOUND ... api-contract.ts` | 28 pass / 0 fail |
| 2.5/2.6 agenda-hours | `ERR_MODULE_NOT_FOUND ... agenda-hours.ts` | 40 pass / 1 fail -> test bug (my input `2026-03-28T22:30:00Z` is 23:30 Madrid on the 28th); input corrected to `23:30:00Z` -> 41 pass |
| 2.7/2.8 availability-window | `SyntaxError: ... does not provide an export named 'availabilityWindow'` | 50 pass / 0 fail |
| 2.9/2.10 upstream-errors | `ERR_MODULE_NOT_FOUND ... functions/_lib/upstream-errors.ts` | 60 pass / 0 fail |
| 2.11/2.12 booking-status | `SyntaxError: ... does not provide an export named 'detectBookingStatus'` | 66 pass / 0 fail |

Refactor: removed an unused `AVAILABILITY_WINDOW_DAYS` constant from `api-contract.ts` (window uses `horizon.ts`, which is pure).

- [x] 2.13 `npm run test:unit`: 66 tests, 66 pass, 0 fail. `npm run check`: 0 errors, 0 warnings, 7 hints (pre-existing). `npm run lint:encoding`: OK.

## Files
Created: `.dev.vars.example`, `tests/unit/{smoke,catalog,api-contract,agenda-hours,availability-window,upstream-errors,booking-status}.test.ts`, `src/features/booking-nubimed/{catalog,api-contract,agenda-hours}.ts`, `functions/_lib/upstream-errors.ts`.
Modified: `.gitignore`, `package.json`, `openspec/changes/nubimed-api-booking/tasks.md`.

## Deviations
1. `test:unit` uses the glob `tests/unit/*.test.ts` instead of the directory `tests/unit/`: on Node 22.20 `node --test <dir>` tries to run the directory as a module (`ERR_TEST_FAILURE`, 0 tests). Glob works on Windows and POSIX.
2. `resolveBookingTarget` accepts only numeric `3`/`386` (per task 2.1: `'3'` string => null). `parseAvailabilityQuery` converts the query strings `"3"`/`"386"` to numbers before resolving.
3. `catalog.ts` has one type-only import (`ClinicLocationKey` from `src/i18n/clinic-locations.ts`), erased at runtime, to keep `CentroKey` single-sourced (design AD-2). No runtime imports.
4. `agenda-hours.ts` imports runtime helpers from `horizon.ts` (verified pure: no `import.meta`, no imports), so no `91` constant lives in `api-contract.ts`. `horizon.ts` and `config.ts` untouched.

## Design decisions made in this batch (for later phases)
- `validateBookingRequest(body)` => `{ ok: true, value: { target, requestedTime, patient, comments?, turnstileToken?, website? } } | { ok: false, fields }`. Field names are flat: `specialty, centro, kind, requestedTime, patient, name, surname, phonePrefix, phone, email, comments, consent, turnstileToken, website`. Unknown keys (incl. `schedule_id` etc.) => `ok: false` WITHOUT echoing key names. `phone` is normalized to digits. `turnstileToken` is optional at this layer: a missing token must map to `turnstile_failed` in the handler (REQ-BFF-8), not `invalid`.
- `parseAvailabilityQuery(URLSearchParams)` => `{ ok: true, target } | { ok: false }`; rejects extra/duplicate/missing params.
- `mapUpstreamError(endpoint, outcome)`; outcome is `{ kind: 'http', status, retryAfter?, body? } | { kind: 'network', sent }`. Result `{ status, code, fields?, retryAfter? }` (keys absent, not undefined). Unlisted 4xx (e.g. 409/418) => 502 `config`. Phase 3 `upstream.ts` must report `sent` correctly for POST (false only if failure happened before the request left, e.g. config/URL error).
- `ACCEPTED_STATE = 'aceptada'` in `api-contract.ts` (single constant, confirm in task 13.9).
- `containsSlot` requires byte-identical ISO under its Madrid day; `availabilityWindow(now)` => `{ from, to }` (YYYY-MM-DD, `to = from + 90`). The upstream query needs `YYYYMMDD` (strip hyphens in `upstream.ts`).
- AD-1(a) assumption (Functions bundling `../../src/...` imports) still pending preview verification; `functions/_lib/upstream-errors.ts` already imports a type from `src/` (type-only, erased).

## DRAFT copy
None yet (no user-facing copy in this batch).

## Remaining
Phases 5-13 (next: Phase 5 client data layer).

## Batch 2 — Phases 3, 4 (DONE, 12/12 tasks; cumulative 31 tasks)

Mode: Strict TDD (handlers tested as pure functions with injected `fetch`, cache, `sleep`, `waitUntil`, `now`; no network, no Cloudflare runtime).

### Structure decision
Handler logic lives in `functions/_lib/handlers.ts` (`handleAvailability`, `handleRequest`, `handleHealth`; exports NO `onRequest*`). The three route files are thin wrappers that build `defaultDeps(waitUntil)` (real `fetch`, `setTimeout` sleep, `caches.open('booking-availability')` when `caches` exists, else `null`). Rationale: testable without runtime; route files export only `onRequestGet`/`onRequestPost`.

### TDD Cycle Evidence
| Task | Test file | RED (reason) | GREEN | Triangulation | Refactor |
|---|---|---|---|---|---|
| 3.1 env | `tests/unit/bff-env-http.test.ts` | `ERR_MODULE_NOT_FOUND functions/_lib/env.ts` | 10/10 (file) | each key missing/blank, bad clinic ids, base override http/invalid/blank | none needed |
| 3.2 http | same file | same run (http.ts missing) | same | json mandatory headers not overridable, errorResponse with/without fields, mapped busy Retry-After, same-origin 3+3 cases | none needed |
| 3.6 turnstile | `tests/unit/turnstile.test.ts` | `ERR_MODULE_NOT_FOUND turnstile.ts` | 6/6 | form fields, no remoteip, 4 failure shapes, network/non-2xx/non-JSON, empty token no fetch, timeout signal | none needed |
| 3.3/3.4/3.5 upstream | `tests/unit/upstream.test.ts` | `ERR_MODULE_NOT_FOUND upstream.ts` | 24/24 (file) | GET retry once (5xx, net) vs no retry (4xx); POST never retried (5xx, timeout); pre-send failure => `upstream`; cache hit/miss/different key/throwing match/put/getCache/null; errors not cached; payload exact; comments omitted | none needed |
| 4.1/4.2/4.3 handlers | `tests/unit/booking-handlers.test.ts` | `ERR_MODULE_NOT_FOUND functions/_lib/handlers.ts` | 29/29 (file) | full REQ-BFF-8 order, honeypot on RAW body without config, 413 with/without Content-Length, mapping table (8 rows) incl. no upstream text leak, PII-free console capture | none needed |

Note: GREEN passed on first execution for handlers/upstream because the implementation was written directly against the already-defined contract of the Batch 1 pure modules; RED was confirmed as missing-module failure for each file before any production code existed. 4.4 verified by `rg onRequest functions/_lib` (only a doc comment).

### Must-dos from Batch 1 notes
- POST `sent=false` only for pre-send construction failure (URL/headers/body); any `fetch` throw/timeout/5xx after dispatch => `sent:true` => 502 `unknown`. Tested.
- GET retry once after 300 ms only on 5xx/network/timeout; POST never. Tested.
- Upstream dates `YYYYMMDD` via `replaceAll('-', '')`. Tested (`20261201`..`20270301`).
- Missing Turnstile token => 403 `turnstile_failed` (no siteverify call). Tested.
- Honeypot `website` on raw JSON before validation => simulated `received`; works even without config and with garbage fields.

### Files
Created: `functions/_lib/{env,http,upstream,turnstile,handlers}.ts`, `functions/api/booking/{availability,request,health}.ts`, `tests/unit/{bff-env-http,turnstile,upstream,booking-handlers}.test.ts`.
Modified: `openspec/changes/nubimed-api-booking/tasks.md` (3.1-3.7, 4.1-4.5 marked), this file.
Old proxy `functions/__nubimed-proxy/[[path]].ts` untouched (Phase 9); no route collision (`/api/booking/*` vs `/__nubimed-proxy/*`).

### Results
- `npm run test:unit`: 135 tests, 135 pass, 0 fail.
- `npm run check`: 0 errors, 0 warnings, 7 hints (pre-existing; `functions/` and `tests/` are type-checked via `**/*`, relative `../../src/...` imports resolve).
- `npm run lint:encoding`: OK. `npm run build` NOT run (user rule).

### Deviations / decisions
1. Handler logic in `_lib/handlers.ts` instead of inside the route files (testability; route files remain thin). Design AD-1 file table not otherwise changed.
2. Order inside `request`: `readConfig` runs after validation (step 4) and before Turnstile (step 5), so malformed requests get 400 even without config, and the honeypot never needs config.
3. `availability`: config check precedes query validation (task 4.1 order).
4. Route files do not export `onRequest` catch-all; 405 for other methods relies on Pages routing (to verify in 13.6 with `DELETE`). If Pages falls through to 404/static instead, add `onRequest = () => 405` per file.
5. Availability 200 with unparsable body on GET is treated as upstream failure; POST 2xx with unparsable body is treated as success `received` (request was sent; avoids inviting a duplicate).
6. `defaultDeps.getCache` uses `caches.open(...)` (design AD-4), not `caches.default`.

### Risks
- AD-1(a) bundling assumption (esbuild bundles `../../src/features/booking-nubimed/*.ts` and `horizon.ts` from `functions/`) is UNVERIFIED until the Pages preview (13.3). Imports use `.ts` extensions; Pages' esbuild should resolve them, but confirm. Fallback documented in design (move pure modules into `functions/_lib/`).
- `catalog.ts` has a type-only import from `src/i18n/clinic-locations.ts` (erased); fine for esbuild.
- `console.warn('booking', endpoint, status)` is the only log call, emitted for `config`/`upstream` outcomes (endpoint + status only).
- Retry sleeps 300 ms inside the Function (counts toward CPU wall time but not CPU time).
- 405 behavior, Cache API on `*.pages.dev`, 91-day range acceptance: pending preview (13.5-13.7).

## DRAFT copy
None in this batch (server returns codes only; copy lives in the island, Phases 6-7).

## Remaining
Phases 5-13 (next: Phase 5 client data layer).

### Ajuste del orquestador tras revisar Batch 2
- Desvío 4 cerrado en código (no depender del comportamiento implícito de Pages): `methodNotAllowed(allow)` en `functions/_lib/http.ts` (405 + `Allow` + headers obligatorios, código `invalid`) y `export const onRequest` de respaldo en `availability.ts` (GET), `request.ts` (POST) y `health.ts` (GET). Los handlers por método tienen prioridad en Pages Functions.
- TDD: RED `SyntaxError: ... does not provide an export named 'methodNotAllowed'` (125 pass / 1 fail) → GREEN 136/136. `npm run check` 0 errors.
- La tarea 13.6 sigue verificando el 405 real en el preview.

## Batch 3 — Phases 5, 6 (DONE, 18/18 tasks; cumulative 49 tasks)

Mode: Strict TDD for `client.ts`; UI verified with `npm run check` (no DOM runner).

### TDD Cycle Evidence
| Task | Test file | RED | GREEN | Triangulation |
|---|---|---|---|---|
| 5.3 client | `tests/unit/booking-client.test.ts` (12 tests, injected `fetch`) | `ERR_MODULE_NOT_FOUND ... build-new-url` (old client still imported removed-API deps; 136 pass / 1 fail file) | 148 pass / 0 fail | all 8 codes both endpoints, `Retry-After`, `fields` filtering, network/JSON/shape/unknown-code => `upstream` (GET) / `unknown` (POST), AbortError rethrown unmapped, URL has only specialty/centro/kind, source has no vendor/proxy refs |

`summaryTimeLabel`/slot formatting now use `formatSlotTime` (already covered by `agenda-hours.test.ts`, `Europe/Madrid`, TZ-independent). Day/slot derivation is a trivial `Object.keys`/index over the availability map (no new pure module; covered by `groupByMadridDay` tests server-side).

### Phase 5
- [x] 5.1 `config.ts`: `SpecialtyCentro` = `{ centro, treatmentsDetail }`; `areaId`/`firstVisitTreatmentId`/`treatmentsTreatmentId`/`tipoHorario` removed; `CentroKey` re-exported from `catalog.ts`; labels, `matchKeys`, `FIRST_VISIT_DETAIL`, `phonePrefixSelectOptions`, `centroFor` kept (`centroAddressesFromEnv` does not exist in this file; nothing to keep).
- [x] 5.2 `types.ts`: `TreatmentOption` moved here with `kind: ServiceKind` (no `areaId`/`tipoHorario`); `BookingFlowProps` gains `turnstileSiteKey?`, `whatsappHref?`.
- [x] 5.3 `client.ts` rewritten: `fetchAvailability(signal, target, fetchImpl?)`, `submitBookingRequest(signal, body, fetchImpl?)`, `availabilityUrl`, `BookingApiError(code, fields?, retryAfter?)`. Same-origin `/api/booking/*` only.
- [x] 5.4 check green.

### Phase 6 (BookingFlow.tsx rewritten, single writer)
- 6.1 bootstrap/gate/csrf/portal/env helpers and the 3 screens removed. 6.2 single availability effect keyed by `specialty|centro|kind` (+ `reloadNonce`); `availability` stores its key, and is only used when it matches the current target (stale responses ignored; effect cleanup aborts); `days`/`slots` derived with `useMemo`; "no availability" (`noDays`) separate from error. 6.3 `bookingTarget`, `selectedDay` (ymd), `selectedSlotIso`; downstream cleared on specialty/centro/treatment change, slot cleared on day change. 6.4 `HORIZON_DAYS = effectiveHorizonDays(91)`. 6.5 slot pick => `setPhase('details')`. 6.6 single patient form + `comments` (maxLength 500, health notice) + honeypot `website`; one-column removal of tabs; time via `formatSlotTime` (Europe/Madrid). 6.7 only privacy checkbox + Turnstile notice/link (Cloudflare policy). 6.8 Turnstile: script injected on entering `details` only, `render` in confirm modal (`action: 'booking'`, `appearance: 'interaction-only'`), Finalize disabled until token, `reset` in `finally` after every POST, `remove` on modal close; no site key / load or widget error => `turnstileFailed` + WhatsApp (`whatsappHref`) and contact-page links. 6.9 `onFinalize` => POST; errors mapped by `code` (`busy`, `slot_unavailable` => back to time step + availability reload + `slotUnavailable`, `invalid` => mark `fields` (slot-related fields => time step), `turnstile_failed`, `unknown` => `submitUnknown` + contact links + Finalize locked, `config`/`upstream`/`forbidden` => `submitGenericError` + contact links). 6.10 `successStatus` copy; reset keeps preset specialty/centro. 6.11 `?treatment=` accepts serviceId (and `{specialty}-{serviceId}`); invalid preset => banner, no target => no BFF call. 6.12 CSS `recaptcha-*` => `captcha-*`; added `is-invalid`, `__textarea`, `__field-hint`, `__hp` (off-screen), `__captcha-widget`, `__captcha-fallback`; removed `.grecaptcha-badge` rule. 6.13 `[segment].astro` passes `turnstileSiteKey` (`PUBLIC_TURNSTILE_SITE_KEY`) and `whatsappHref` (`https://wa.me/${PUBLIC_WHATSAPP_E164}`); placeholder branch untouched. 6.14 check + test:unit green; manual `bookingPublic=false` check NOT run (branch code unchanged; verify in 13.x).

### New i18n keys (added in es/en/ca/fr; 7.1-style, early)
`fieldComments`, `slotUnavailable`, `busy`, `turnstilePolicyLinkLabel`, `contactWhatsappLabel`, `contactPageLabel`; DRAFT (`// DRAFT copy — pending user review`): `commentsHealthNotice`, `turnstileNotice`, `turnstileFailed`, `submitUnknown`, `submitSuccessConfirmed`, `submitSuccessReceived`, `submitGenericError`. Not removed anything (7.2 pending). Now unused and candidates for 7.2: `loadingBootstrap`, `gateBlocked`, `openPortal`, `loadingConfirmPage`, `recaptcha*`, `modeNewPatient`, `modeReturningPatient`, `fieldDni`, `fieldBirthDate`, `patientHadVisitBefore`, `submitSuccess`, `marketingCheckbox`, plus `submitFailed`, `recaptchaFailed`, `selectProfessional`, `parseError`, `invalidResponse` (also unused; `submitFailed` mentions the removed portal).

### Results
- `npm run test:unit`: 148 tests, 148 pass. `npm run check`: 0 errors, 0 warnings, 7 hints (same pre-existing). `npm run lint:encoding`: OK. Build not run.

### Deviations / notes
1. `BootstrapSession`, `Slot` and `'gate_blocked'` kept in `types.ts` (marked "Legacy", Phase 9.5) because the unused scraping modules (`parse-widget`, `build-new-url`, `normalize-huecos`, `recaptcha`, ...) still import them; deleting them would break `check` until Phase 9. No import of those modules remains in `BookingFlow.tsx`/`client.ts`.
2. `TreatmentOption` lives in `types.ts` (was local to BookingFlow).
3. Auto-advance state (`readyToAutoAdvance`) removed entirely; selecting a slot advances directly.
4. Availability is not refetched when re-entering the date step for the same target (kept in `loadedKeyRef`); refetch only on target change, retry, or `slot_unavailable`.
5. `.booking-flow__mode-row`/`__tab` CSS left in place (now unused); trivial cleanup for later.
6. `PUBLIC_TURNSTILE_SITE_KEY` not yet typed in `env.d.ts` (Phase 10); Astro's `import.meta.env` index signature compiles.
7. `website` is only sent when non-empty. Unknown-state lock (`unknownSent`) is cleared only after success reset.

### Risks
- Turnstile `interaction-only` + explicit render is unverified in a real browser (13.8); the modal shows an empty container until the widget needs interaction.
- No DOM test runner: BookingFlow behaviour (abort of stale responses, reset after submit) verified by type-check and reading only.
- Whole-batch copy is DRAFT; user must review the 7 DRAFT keys.

## Remaining
Phases 7-13 (next: Phase 7.2/7.3 i18n cleanup, or Phase 9 deletions; Phase 8 legal is independent).
