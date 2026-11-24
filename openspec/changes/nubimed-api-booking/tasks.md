# Tasks: Reserva vía API Nubimed (BFF en Cloudflare Pages Functions)

Reglas del cambio: diff mínimo, sin refactors colaterales; cuatro locales es/en/ca/fr; tokens del tema; booking `noindex`; corporal fuera de alcance; sin secretos en el repo ni en `PUBLIC_*`; nunca loggear bodies, query ni PII. `bookingPublic` **se queda como esté en `main`** (esperado `false` tras el hotfix PR #15) durante todo el apply; solo se cambia en la última tarea de la Phase 13.

**Strict TDD (aprobado, AD-10) solo para módulos puros**: cada módulo puro tiene una tarea RED (test que falla) seguida de su tarea GREEN (implementación mínima). Runner: `node --test` con `--experimental-strip-types`, tests en `tests/unit/*.test.ts`. UI y wiring de Functions: `npm run check` + comprobación manual.

**Comandos permitidos a los agentes**: `npm run check`, `npm run test:unit`, `npm run lint:encoding`. **`npm run build` NO lo ejecutan los agentes** (regla del usuario): es un paso manual del usuario en la Phase 13.

**Invariante por fase**: cada fase deja `npm run check` en verde y, desde la Phase 1, `npm run test:unit` en verde (en la tarea RED el test falla a propósito; la fase cierra con verde tras GREEN).

**Copy marcado como BORRADOR (DRAFT)**: aviso de salud, copy de éxito/`unknown`/`busy`, `bookingLegalSummaryBody`, legal (privacy, cookies, banner). Apply los deja con el comentario `// DRAFT: pendiente de revisión del usuario` y lo lista en el apply-progress.

## Mapa de paralelismo

| Fase | Depende de | Paralelizable con | Archivos compartidos |
|---|---|---|---|
| 0 Seguridad | — | — (PRIMERA, bloquea todo) | `.gitignore`, `.dev.vars.example` |
| 1 Runner | 0 | — | `package.json` |
| 2 Módulos puros (TDD) | 1 | — (secuencial interna, ver notas) | `src/features/booking-nubimed/{catalog,api-contract,agenda-hours}.ts`, `tests/unit/` |
| 3 `functions/_lib` | 2 | 8 (legal), 7 solo claves nuevas **no** (ver 7) | `functions/_lib/*` |
| 4 Endpoints | 3 | 8 (legal) | `functions/api/booking/*` |
| 5 `config.ts`/`types.ts`/`client.ts` | 2 | 3, 4, 8 | `config.ts`, `types.ts`, `client.ts` |
| 6 `BookingFlow.tsx` | 4 (contrato), 5 | 8 (legal) | `BookingFlow.tsx` (**single-writer**), `booking-flow.css`, `[segment].astro` |
| 7 i18n booking | 6 (claves usadas) | 8 | `src/features/booking-nubimed/i18n.ts` |
| 8 Legal | 0 | 3, 4, 5, 6, 7 | `src/i18n/legal-content/*`, `cookie-consent-strings.ts` |
| 9 Borrados + proxy dev | 6 (sin imports colgantes) | 8 | `astro.config.mjs`, `functions/__nubimed-proxy/`, módulos scraping |
| 10 Env typing + robots | 9 | 8, 11 | `src/env.d.ts`, `src/pages/robots.txt.ts` |
| 11 Docs | 9 | 8, 10, 12 | `AGENTS.md`, `README.md`, `docs/*`, `.env.example` |
| 12 `openspec/config.yaml` | 1 | cualquiera tras 1 | `openspec/config.yaml` |
| 13 Verificación | todas | — (manual, secuencial) | — |

Notas de colisión: `BookingFlow.tsx` es de un único escritor (Phase 6 completa, secuencial). `i18n.ts` lo tocan Phase 6 (solo lee claves nuevas) y Phase 7 (las define): para no romper `check`, la Phase 7 puede adelantarse a la 6 añadiendo primero las claves nuevas (7.1) y retirando las viejas solo tras la Phase 6 (7.2). Phase 8 (legal) no comparte archivos con el resto y puede ejecutarse en paralelo en cualquier momento tras la Phase 0.

---

## Phase 0: Seguridad del repo (PRIMERA; nada crea archivos de secretos antes)

- [x] 0.1 `.gitignore`: añadir `.dev.vars`, `.dev.vars.*`, `!.dev.vars.example` y `.wrangler/`. Verificar con `git check-ignore -v .dev.vars .wrangler/x` (Bash de solo lectura). (REQ-12, AD-9)
- [x] 0.2 `.dev.vars.example` (nuevo, **sin valores**): claves `NUBIMED_API_EMAIL`, `NUBIMED_API_TOKEN`, `NUBIMED_CLINIC_ID`, `NUBIMED_API_BASE` (comentada, opcional), `TURNSTILE_SECRET_KEY`; comentario con la secret de prueba de Turnstile de la doc vigente (verificar en la doc antes de copiarla; si no se puede verificar, dejar solo el nombre). (REQ-12, AD-9)

## Phase 1: Runner de tests y tsconfig

- [x] 1.1 `package.json`: añadir script `"test:unit": "node --experimental-strip-types --test tests/unit/"`. Sin devDependencies nuevas. (AD-10)
- [x] 1.2 `tests/unit/smoke.test.ts` (RED→GREEN trivial): un test `node:test` + `node:assert/strict` que importa `../../src/features/booking-nubimed/horizon.ts` si es puro, o un `assert.ok(true)`; objetivo: probar que el runner arranca. Ejecutar `npm run test:unit`. (AD-10)
- [x] 1.3 `tsconfig.json`: comprobar con `npm run check` que `tests/unit/*.test.ts` y los imports con extensión `.ts` no dan error; si `allowImportingTsExtensions` no viene del tsconfig base de Astro, añadirlo (diff mínimo) o, como último recurso, módulos hoja sin imports relativos de runtime (AD-1/AD-10). Registrar el resultado en el apply-progress. (AD-10)
- [x] 1.4 `npm run check` y `npm run test:unit` en verde.

## Phase 2: Módulos puros (Strict TDD: RED → GREEN por módulo)

Orden interno secuencial (catalog → api-contract → agenda-hours → error mapping → detección), porque `api-contract` usa `catalog` y el mapeo de errores usa los códigos de `api-contract`. Los tests viven en `tests/unit/`; los módulos puros solo importan con extensión `.ts` o `import type`.

### 2A Catálogo
- [x] 2.1 RED `tests/unit/catalog.test.ts`: `resolveBookingTarget` cubre los 8 `serviceId` (3: bcn 389741/389745, ev 389742/389746; 386: bcn 389743/389747, ev 389744/389748), `agendaId` barcelona `29537` y el-vendrell `26912`; devuelve `null` con `centro` desconocido, `specialty` `4`/`5`/`'3'`(string no numérica según contrato), `kind` inválido, entradas no-string/`undefined`; el catálogo no expone `area_id` ni los ids `4`, `5`, `244529`. (REQ-3, REQ-BFF-3, AD-2)
- [x] 2.2 GREEN `src/features/booking-nubimed/catalog.ts` (nuevo, cero imports de runtime): `SpecialtyId`, `CentroKey`, `ServiceKind`, `MODALITY`, `AGENDA_BY_CENTRO`, `SERVICE_IDS`, `resolveBookingTarget`. (REQ-3, AD-2)

### 2B Contrato y validación
- [x] 2.3 RED `tests/unit/api-contract.test.ts`: `validateBookingRequest` (nombre/apellidos vacíos y >80 tras `trim`, `phonePrefix` `^[1-9]\d{0,3}$` (`"34"` ok, `"+34"`/`"0"` no), teléfono 6-15 dígitos tras quitar espacios/guiones (4 dígitos ⇒ `phone` en `fields`), email obligatorio, >254 y formato inválido, `comments` opcional y 501 ⇒ `comments`, `consent !== true`, `requestedTime` ausente/inválido, claves desconocidas e ids crudos `schedule_id`/`service_id`/`speciality_id`/`clinica_id`/`area_id` ⇒ `invalid`, `fields` solo con nombres propios) y `parseAvailabilityQuery` (acepta exactamente `specialty`, `centro`, `kind`; rechaza `from`, `to` y cualquier otro parámetro; `centro=madrid` ⇒ inválido). (REQ-BFF-3, REQ-BFF-4, REQ-BFF-7)
- [x] 2.4 GREEN `src/features/booking-nubimed/api-contract.ts` (nuevo): tipos `BookingRequestBody`, `AvailabilityResponse`, `BookingResponse`, `BookingErrorCode` (`invalid`, `forbidden`, `turnstile_failed`, `slot_unavailable`, `busy`, `config`, `upstream`, `unknown`), límites como constantes, `validateBookingRequest`, `parseAvailabilityQuery`. (REQ-BFF-3, REQ-BFF-7, AD-5, AD-6)

### 2C Disponibilidad: parseo, agrupado y formato
- [x] 2.5 RED `tests/unit/agenda-hours.test.ts`: `parseAgendaHours` acepta tuplas `[iso, ids, meta]`, descarta `user_ids`/`meta`, ignora entradas malformadas sin lanzar; `groupByMadridDay` agrupa por `Europe/Madrid` (`2026-12-01T23:30:00+01:00` ⇒ `2026-12-01`, conservando el ISO original), ordena días y horas, **cambio de hora** (último domingo de octubre, 25 oct 2026, y último de marzo, 29 mar 2026), **medianoche** (`23:59` y `00:00` en días distintos; un ISO en `+00:00`/Z cuya fecha en Madrid cambia de día), lista vacía ⇒ `{}`; `formatSlotTime(iso)` ⇒ `09:30` para `2026-12-01T09:30:00+01:00` independientemente de `process.env.TZ` (test con `TZ=America/New_York` vía `Intl` con `timeZone: 'Europe/Madrid'`). (REQ-7, REQ-BFF-4)
- [x] 2.6 GREEN `src/features/booking-nubimed/agenda-hours.ts` (nuevo): `parseAgendaHours`, `groupByMadridDay`, `formatSlotTime` (con `CLINIC_TIMEZONE = 'Europe/Madrid'`). (REQ-7, REQ-BFF-4, AD-3)
- [x] 2.7 RED `tests/unit/availability-window.test.ts`: cálculo de `from`/`to` servidor-lado (hoy en Madrid, `to = from + 90`, cruce de medianoche UTC vs Madrid, cambio de hora) y `containsSlot(days, requestedTime)` (el ISO debe estar **idéntico** en su día de Madrid; ISO con otra zona o reformateado ⇒ `false`). (REQ-6, REQ-BFF-4, REQ-BFF-6)
- [x] 2.8 GREEN: `availabilityWindow(now)` y `containsSlot` en `agenda-hours.ts` (reutilizar `horizon.ts` si es puro; si arrastra `import.meta.env`, no importarlo y añadir la constante `91` en `api-contract.ts`). (REQ-6, REQ-BFF-4)

### 2D Mapeo de errores y detección de estado
- [x] 2.9 RED `tests/unit/upstream-errors.test.ts`: tabla completa AD-6/REQ-BFF-10 para `availability` y `request` (429 ⇒ 503 `busy` con `retryAfter` upstream o 60; 422 ⇒ 502 `config` / 422 `invalid`; 400 ⇒ 502 `config` / 400 `invalid`; 404 ⇒ 502 `config` / 409 `slot_unavailable`; 401/403 ⇒ 502 `config`; 5xx/red/timeout ⇒ 502 `upstream`; POST 5xx/timeout/red **tras enviar** ⇒ 502 `unknown`; fallo **antes de enviar** ⇒ 502 `upstream`); mapeo de campos 422 `patient_*` ⇒ nombres propios y descarte de cualquier otra clave; el resultado no contiene texto upstream. (REQ-BFF-10, AD-6)
- [x] 2.10 GREEN `functions/_lib/upstream-errors.ts` (nuevo, puro; solo `import type` del contrato): `mapUpstreamError(endpoint, outcome)`. (REQ-BFF-10, AD-6)
- [x] 2.11 RED `tests/unit/booking-status.test.ts`: `detectBookingStatus(upstreamBody)` ⇒ `'confirmed'` con `assigned_time` string no vacío **o** `state === 'aceptada'`; `'received'` con `pendiente`, estado de rechazo, `assigned_time` vacío/`null`/no-string, cuerpo no-objeto; nunca devuelve `id` ni PII. (REQ-BFF-6, AD-5)
- [x] 2.12 GREEN: `detectBookingStatus` en `src/features/booking-nubimed/api-contract.ts` (compartible; sin dependencias). (REQ-BFF-6, AD-5)
- [x] 2.13 `npm run test:unit` + `npm run check` en verde.

## Phase 3: `functions/_lib` (wiring de servidor; sin TDD, `check` + revisión)

- [x] 3.1 `functions/_lib/env.ts` (nuevo): tipos locales `BookingEnv`, `BookingContext` (`request`, `env`, `waitUntil`) sin `@cloudflare/workers-types`; `readConfig(env)` fail-closed (falta cualquier de `NUBIMED_API_EMAIL`, `NUBIMED_API_TOKEN`, `TURNSTILE_SECRET_KEY`, `NUBIMED_CLINIC_ID` entero > 0 ⇒ `null`); `NUBIMED_API_BASE` por defecto `https://api.clinicaenlanube.com/api/v1`, solo `https:`. Sin logs de valores. (REQ-BFF-2, AD-9)
- [x] 3.2 `functions/_lib/http.ts` (nuevo): `json(status, body, extra?)` con `Content-Type: application/json`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`; `errorResponse(code, status, fields?, extra?)` con la forma `{ ok: false, code, fields? }`; `isSameOrigin(request)` (`Origin` igual a `new URL(request.url).origin`; sin `Origin`, `Sec-Fetch-Site === 'same-origin'`). (REQ-BFF-1, REQ-BFF-8, AD-1)
- [x] 3.3 `functions/_lib/upstream.ts` (nuevo): `nubimedFetch` con cabeceras `X-User-Email`, `X-User-Token`, `User-Agent: JT`, `Accept: application/json`; timeout `AbortSignal.timeout(8000)` GET / `10000` POST; reintento **solo GET** una vez (~300 ms) ante 5xx/red/timeout; el POST jamás se reintenta; distinguir "fallo antes de enviar" de "tras enviar" para el mapeo `unknown`. Solo `console.warn('booking', endpoint, status)` en `config`/`upstream`. (REQ-BFF-2, REQ-BFF-9, REQ-BFF-11, AD-6)
- [x] 3.4 `functions/_lib/upstream.ts`: `getAvailability(target, env, ctx)` con Cache API (`caches.open('booking-availability')`, clave sintética `/__cache/booking/availability/v1/{agendaId}/{serviceId}/{from}`, TTL 60 s, `cache.put` vía `waitUntil`, cualquier excepción de caché ⇒ se ignora); llama a `GET /agendas/{agendaId}?start_date&end_date&service_id&modality=presencial`; normaliza con `parseAgendaHours` + `groupByMadridDay`. **Nunca** llama a `GET /agendas` (listado). Si el preview rechaza 91 días, troceado en tramos ≤ 31 días con `Promise.allSettled` (AD-3; decidir en la Phase 13). (REQ-BFF-4, REQ-BFF-5, AD-3, AD-4)
- [x] 3.5 `functions/_lib/upstream.ts`: `createPeticion(target, body, env)` con el payload de AD-5 (`clinica_id: Number(env.NUBIMED_CLINIC_ID)`, `speciality_id`, `schedule_id`, `service_id`, `requested_time`, `patient_name`, `patient_surname`, `patient_phone` (solo dígitos), `patient_country_calling_code`, `patient_email`, `comments?`, `modality: 'presencial'`); devuelve solo el estado detectado por `detectBookingStatus`, nunca `id` ni cuerpo. (REQ-BFF-6, AD-5)
- [x] 3.6 `functions/_lib/turnstile.ts` (nuevo): `verifyTurnstile(secret, token, ip)` con `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` (form `secret`, `response`, `remoteip`), timeout 5 s; exige `success === true` y `action === 'booking'`; error/timeout ⇒ `false` (fail-closed). (REQ-BFF-8, AD-7)
- [x] 3.7 `npm run check` (tipa `functions/` y verifica que los imports relativos `../../src/...` resuelven). Anotar en el apply-progress el supuesto AD-1(a) pendiente de preview.

## Phase 4: Endpoints `functions/api/booking/*`

- [x] 4.1 `functions/api/booking/availability.ts`: `onRequestGet`; `readConfig` (503 `config` si falta, sin llamadas); `parseAvailabilityQuery` ⇒ 400 `invalid`; `resolveBookingTarget`; `getAvailability`; 200 `{ ok: true, from, to, days }` sin `user_ids`/ids de agenda; errores vía `mapUpstreamError`; `Retry-After` en `busy`. (REQ-BFF-1..5, REQ-BFF-10, AD-3)
- [x] 4.2 `functions/api/booking/request.ts`: `onRequestPost` con el orden estricto de REQ-BFF-8: (1) `Content-Type` JSON + ≤ 8 KB (leer como texto con límite; 400/413 `invalid`), (2) `isSameOrigin` ⇒ 403 `forbidden`, (3) honeypot `website` ⇒ 200 `{ ok: true, status: 'received' }` sin efectos, (4) `validateBookingRequest` + `resolveBookingTarget` ⇒ 400 `invalid` con `fields`, (5) `verifyTurnstile` ⇒ 403 `turnstile_failed`, (6) re-check con `getAvailability` + `containsSlot` ⇒ 409 `slot_unavailable`, (7) `createPeticion`. `readConfig` fail-closed antes del paso 5. Respuesta `{ ok: true, status }` sin PII ni `id`. Sin ningún `console.*` con datos del body. (REQ-BFF-6..8, REQ-BFF-10, REQ-BFF-11, AD-5, AD-6, AD-7)
- [x] 4.3 `functions/api/booking/health.ts`: `onRequestGet`; 200 `{ ok: true }` si `readConfig` es válido, 503 `{ ok: false, code: 'config' }` si no; solo presencia, sin upstream ni valores. (REQ-BFF-1, AD-1)
- [x] 4.4 Confirmar que `functions/_lib/*` no exporta `onRequest*` (no genera rutas) y que otros métodos devuelven 405 por el routing de Pages (los handlers solo exportan `onRequestGet`/`onRequestPost`). (REQ-BFF-1, AD-1)
- [x] 4.5 `npm run check` + `npm run test:unit`.

## Phase 5: Capa de datos del cliente (`config.ts`, `types.ts`, `client.ts`)

- [x] 5.1 `src/features/booking-nubimed/config.ts`: leer ids desde `catalog.ts`; `SpecialtyCentro` pierde `areaId`, `firstVisitTreatmentId`, `treatmentsTreatmentId` y conserva `centro` + `treatmentsDetail`; eliminar `tipoHorario` (pasa a `MODALITY` en el catálogo); conservar labels, `matchKeys`, `FIRST_VISIT_DETAIL`, `phonePrefixSelectOptions`, `centroFor`, `centroAddressesFromEnv`. (REQ-3, AD-2)
- [x] 5.2 `src/features/booking-nubimed/types.ts`: `TreatmentOption` gana `kind: ServiceKind` y pierde `areaId`/`tipoHorario`; `id` sigue aceptando el `serviceId`; eliminar `BootstrapSession`, `Slot` y `'gate_blocked'`; `BookingFlowProps` gana `turnstileSiteKey?: string` y `whatsappHref?: string`. (AD-8, AD-11)
- [x] 5.3 `src/features/booking-nubimed/client.ts` (reescritura): `fetchAvailability(signal, target)` ⇒ `GET /api/booking/availability?specialty&centro&kind` (sin fechas ni ids crudos) y `submitBookingRequest(signal, body)` ⇒ `POST /api/booking/request` (JSON); clase `BookingApiError(code, fields?, retryAfter?)` con `code` del enum de `api-contract.ts`; red/JSON roto ⇒ `unknown` en POST y `upstream` en GET; ninguna URL de Nubimed ni `/__nubimed-proxy`. (REQ-9, REQ-11, AD-8)
- [x] 5.4 `npm run check` (los consumidores rotos se arreglan con el diff mínimo; el cableado completo llega en la Phase 6; si `BookingFlow.tsx` rompe `check` aquí, coordinar con 6.x en el mismo lote, no dejarlo en rojo).

## Phase 6: `BookingFlow.tsx` — refactor de la capa de datos (single-writer, secuencial)

- [x] 6.1 `BookingFlow.tsx`: eliminar `nubimedBaseUrl`, `portalFallbackUrl`, `clinicaIdFromEnv`, `isRuntimeLocalhost`, `csrfRef`, `client`, `bootstrap`, `bootLoading`, `bootErr`, `gateUrl`, `runBootstrap` y las 3 pantallas asociadas (bootstrap/gate/error); la isla arranca en el paso inicial. (REQ-1, REQ-11, AD-8)
- [x] 6.2 `BookingFlow.tsx`: sustituir `loadDays` + `loadSlots` (`days`, `slots`, `slotsLoading`, `slotsErr`) por un único efecto `loadAvailability` ⇒ `availability: Record<ymd, string[]> | null`, `availabilityLoading`, `availabilityErr`; `days` y `slots` derivados con `useMemo`; una sola petición al entrar en `datetime` y al cambiar tratamiento (sin petición al cambiar día/mes); abort de contextos obsoletos; estado "sin disponibilidad" distinto del error de red. (REQ-7, AD-3, AD-8)
- [x] 6.3 `BookingFlow.tsx`: `bookingTarget` derivado (`specialty`, `centro`, `kind`) sustituye a `newUrlSelection`; `selectedSlotIso: string | null` sustituye a `Slot`/`professionalId`/fieldset de profesional; limpiar tratamiento/día/franja al cambiar especialidad/centro y franja al cambiar día. (REQ-3, REQ-7, REQ-8 removed, AD-8)
- [x] 6.4 `BookingFlow.tsx`: horizonte `effectiveHorizonDays(91)` constante, sin dependencia de bootstrap. (REQ-6, AD-8)
- [x] 6.5 `BookingFlow.tsx`: elegir hora ⇒ `setPhase('details')` directo; eliminar `parsedNew`, `detailsLoading`, `detailsErr`, `onContinueFromPick`. Stepper de 5 pasos intacto. (REQ-9, REQ-14, AD-8)
- [x] 6.6 `BookingFlow.tsx`: paso de datos con un único formulario de paciente nuevo; eliminar `patientMode`, `retDni`, `retDob` y las pestañas; añadir `comments` (textarea `maxLength=500`, opcional, con aviso de datos de salud) y honeypot `website` (fuera de pantalla, `tabindex=-1`, `autocomplete="off"`, `aria-hidden`); email obligatorio; `summaryTimeLabel`/`slotLabel24h` pasan a `formatSlotTime(iso)` (Europe/Madrid). Conservar el resumen con centro, dirección y enlace a Maps (REQ-16). (REQ-16, REQ-7, AD-8)
- [x] 6.7 `BookingFlow.tsx`: consentimiento: solo casilla de privacidad (no premarcada) con resumen legal; **eliminar `marketingOk`** y su checkbox; aviso de Cloudflare Turnstile con enlace a su política (sin texto/enlaces de Google). (REQ-13, AD-7, AD-11)
- [x] 6.8 `BookingFlow.tsx`: Turnstile explícito en el modal de confirmación: inyectar `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` al entrar en `details` (no en la carga de página); `turnstile.render` con `sitekey` (prop), `action: 'booking'`, `appearance: 'interaction-only'`, callbacks; "Finalizar" deshabilitado hasta tener token; `turnstile.reset(widgetId)` tras **cualquier** respuesta del POST; `remove` al cerrar el modal; fallo de carga / `error-callback` / sin site key ⇒ aviso `turnstileFailed` con enlaces a WhatsApp (`whatsappHref`) y contacto. (REQ-9, REQ-13, AD-7)
- [x] 6.9 `BookingFlow.tsx`: `onFinalize` ⇒ `submitBookingRequest` con el body de AD-5 (`requestedTime` idéntico al ISO de la disponibilidad); `submitting` bloquea botón y cierre del modal; sin reintento automático; tratamiento de errores por `code` (no por subcadenas): `busy`, `slot_unavailable` (refrescar disponibilidad y volver a elegir franja), `invalid` (marcar `fields`), `turnstile_failed`, `unknown` (copy "podría haberse recibido, no lo repitas" + WhatsApp/teléfono), `config`/`upstream`/`forbidden` (error genérico + WhatsApp/teléfono). (REQ-9, AD-6, AD-8)
- [x] 6.10 `BookingFlow.tsx`: `successStatus: 'confirmed' | 'received'` ⇒ copy distinto; nunca "confirmada" fija; el reset tras éxito conserva especialidad/centro del preset. (REQ-9, AD-8)
- [x] 6.11 `BookingFlow.tsx`: preset/`sede`/`?treatment=` siguen funcionando (`?treatment=` acepta `serviceId` de `catalog.ts`); preset inválido ⇒ error y ninguna llamada al BFF con esa clave. (REQ-4, AD-8)
- [x] 6.12 `src/styles/components/booking-flow.css`: renombrar `booking-flow__recaptcha-*` ⇒ `booking-flow__captcha-*` (y las referencias de TSX), usando tokens del tema; estilos del honeypot, del textarea y del contenedor del widget. (AD-8)
- [x] 6.13 `src/pages/[lang]/[segment].astro`: pasar `turnstileSiteKey={import.meta.env.PUBLIC_TURNSTILE_SITE_KEY}` y `whatsappHref` (desde `PUBLIC_WHATSAPP_E164`) con accesos literales a `import.meta.env`; el placeholder con `bookingPublic` inactivo sigue sin montar `BookingFlow` ni emitir peticiones. (REQ-1, AD-8)
- [x] 6.14 `npm run check` + `npm run test:unit`. Comprobación manual (dev, sin flag): `bookingPublic=false` ⇒ placeholder, cero peticiones a `/api/booking/*`.

## Phase 7: i18n del módulo (4 locales)

- [ ] 7.1 `src/features/booking-nubimed/i18n.ts` — **añadir** en es/en/ca/fr: `fieldComments`, `commentsHealthNotice` (DRAFT), `turnstileNotice` (DRAFT), `turnstileFailed` (DRAFT), `slotUnavailable`, `busy`, `submitUnknown` (DRAFT), `submitSuccessConfirmed` (DRAFT), `submitSuccessReceived` (DRAFT). Acentos correctos. Se puede ejecutar antes de la Phase 6 para que 6.x compile. (REQ-2, AD-11)
- [ ] 7.2 `i18n.ts` — **retirar** (tras la Phase 6, sin usos): `loadingBootstrap`, `gateBlocked`, `openPortal`, `loadingConfirmPage`, `recaptcha*`, `modeNewPatient`, `modeReturningPatient`, `fieldDni`, `fieldBirthDate`, `patientHadVisitBefore`, `submitSuccess`, y los textos del checkbox de marketing. Verificar con `rg` que no quedan referencias. (REQ-2, REQ-13, AD-11)
- [ ] 7.3 `i18n.ts`: `bookingLegalSummaryBody` ajustado (Nubimed como encargado + mención de Cloudflare Turnstile) en los 4 locales, marcado DRAFT. (REQ-13, AD-11)
- [ ] 7.4 `npm run check` y `npm run lint:encoding`; comprobar que las claves nuevas existen en los 4 locales (el tipo `Record<Lang, ...>` lo fuerza; confirmar con `rg`). (REQ-2)

## Phase 8: Legal (paralelizable; todo DRAFT para revisión del usuario)

- [ ] 8.1 `src/i18n/legal-content/privacy.ts`: sustituir Google/reCAPTCHA por Cloudflare Turnstile como proveedor anti-spam (finalidad, base, transferencias) y mantener Nubimed como encargado; 4 locales. Marcar DRAFT. Ver líneas exactas con `rg -n "recaptcha|Google" src/i18n/legal-content/privacy.ts`. (REQ-13, AD-11)
- [ ] 8.2 `src/i18n/legal-content/cookies.ts`: idem para la tabla/lista de cookies y terceros (Turnstile en lugar de reCAPTCHA); 4 locales. DRAFT. (REQ-13, AD-11)
- [ ] 8.3 `src/i18n/cookie-consent-strings.ts`: banner con Cloudflare/Turnstile en lugar de Google/reCAPTCHA; 4 locales. DRAFT. (REQ-13, AD-11)
- [ ] 8.4 `npm run check` + `npm run lint:encoding`; `rg -i "recaptcha" src/i18n` ⇒ 0 resultados. Listar en el apply-progress todo el copy DRAFT para que el usuario lo valide (Open Question de design). (REQ-13)

## Phase 9: Borrados y proxy de desarrollo

- [ ] 9.1 Confirmar con `rg` que no quedan imports de los módulos a borrar fuera de ellos mismos (tras la Phase 6). (AD-11)
- [ ] 9.2 Borrar `src/features/booking-nubimed/{parse-widget,parse-new-booking-html,build-new-url,booking-submit-merge,nubimed-portal-submit-fields,recaptcha,normalize-huecos}.ts` (`horizon.ts` se conserva). (REQ-21 removed, REQ-20 removed, AD-11)
- [ ] 9.3 Borrar `functions/__nubimed-proxy/[[path]].ts` (y el directorio). (REQ-21 removed, AD-11)
- [ ] 9.4 `astro.config.mjs`: eliminar el proxy Vite `/__nubimed-proxy` (server y preview) y añadir `'/api/booking': 'http://127.0.0.1:8788'` en ambos (AD-9 opción B). Comentario breve sobre `npx wrangler@4 pages dev public --port 8788`. (REQ-11, AD-9)
- [ ] 9.5 `src/features/booking-nubimed/types.ts`: confirmar que `BootstrapSession`, `Slot`, `'gate_blocked'` ya no existen (si 5.2 los dejó por compilación). (AD-11)
- [ ] 9.6 `npm run check` + `npm run test:unit`; `rg -n "__nubimed-proxy|parse-widget|parse-new-booking-html|build-new-url|booking-submit-merge|nubimed-portal-submit-fields|recaptcha" --glob '!openspec/**'` ⇒ 0 resultados (REQ-21 removed scenario). (REQ-21)

## Phase 10: Tipado de env y robots

- [ ] 10.1 `src/env.d.ts`: añadir `PUBLIC_TURNSTILE_SITE_KEY?: string`; quitar `PUBLIC_NUBIMED_CLINICA_ID`, `PUBLIC_NUBIMED_VENDOR_ORIGIN`, `PUBLIC_NUBIMED_PROXY_URL`, `PUBLIC_NUBIMED_PORTAL_NEW_URL`. (REQ-12, AD-9)
- [ ] 10.2 `src/pages/robots.txt.ts`: `Disallow: /__nubimed-proxy/` ⇒ `Disallow: /api/booking/`. (REQ-1, REQ-BFF-12, AD-11)
- [ ] 10.3 `npm run check`; `rg -n "PUBLIC_NUBIMED" --glob '!openspec/**'` solo puede devolver `.env.example` hasta 11.5. (REQ-12)

## Phase 11: Documentación

- [ ] 11.1 `AGENTS.md`: Functions como BFF de reserva (`/api/booking/*`), secretos de servidor, `.dev.vars`, prohibido loggear bodies/PII, `bookingPublic`, comando de test (`npm run test:unit`), módulos puros bajo Strict TDD. (AD-9, AD-10)
- [ ] 11.2 `README.md`: despliegue en Cloudflare Pages con secrets en Production **y** Preview, `PUBLIC_TURNSTILE_SITE_KEY` en build, desarrollo local (`npm run dev` + `npx wrangler@4 pages dev public --port 8788`). (AD-9)
- [ ] 11.3 `docs/stack-and-deployment-context.md`: tabla de variables (AD-9), hostnames en el widget Turnstile, recomendación de regla WAF de rate limiting sobre `POST /api/booking/request`, nota de CSP si se añade `_headers`. (AD-7, AD-9)
- [ ] 11.4 `docs/site-architecture.md`: flujo de reserva vía BFF; sigue fuera de nav, sitemap e índice. (REQ-1)
- [ ] 11.5 `.env.example`: añadir `PUBLIC_TURNSTILE_SITE_KEY` y retirar `PUBLIC_NUBIMED_*`. **El archivo puede estar bloqueado para agentes por permisos**: si falla, **no insistir**; entregar en el apply-progress las líneas exactas para que el usuario las pegue (y anotar la tarea como BLOCKED, como en el cambio anterior). (REQ-12)
- [ ] 11.6 `npm run lint:encoding` (docs editados en Windows).

## Phase 12: Configuración de testing de openspec

- [ ] 12.1 `openspec/config.yaml`: sección de testing ⇒ runner disponible (`npm run test:unit`, `node --test` + strip-types), `strict_tdd: true` para módulos puros (`catalog`, `api-contract`, `agenda-hours`, `upstream-errors`), UI/Functions sin runner (`npm run check` + manual). Diff mínimo; no tocar el resto de claves. (AD-10)

## Phase 13: Verificación y activación (manual; secuencial)

Las acciones con secretos y `npm run build` / `wrangler pages dev dist` las ejecuta el **usuario**. Los resultados van al `verify-report`.

- [ ] 13.1 Confirmar `bookingPublic` tal como está en `main` (esperado `false`, hotfix PR #15) y que **no** se tocó durante el apply. (REQ-1, REQ-11)
- [ ] 13.2 `npm run check`, `npm run test:unit` y `npm run lint:encoding` en verde (agente). `npm run build` (**usuario**): inspeccionar `dist/` — `robots.txt` con `Disallow: /api/booking/`, sin cadenas `NUBIMED_API_TOKEN`/`TURNSTILE_SECRET_KEY`/`__nubimed-proxy` en el bundle, placeholder con flag off. (REQ-1, REQ-12, REQ-BFF-12)
- [ ] 13.3 Preview de Pages con secrets (Production y Preview) y `PUBLIC_TURNSTILE_SITE_KEY`; hostnames de preview y producción en el widget Turnstile. Verificar supuestos: AD-1 (a) bundling de imports fuera de `functions/`, (b) `_lib` no genera rutas, (c) `context.env`. Si (a) falla, mover los 3 módulos puros a `functions/_lib/` e importarlos desde la isla. (REQ-11, AD-1)
- [ ] 13.4 `GET /api/booking/health` ⇒ 200; sin secrets ⇒ 503 `config` (probar en un preview sin variables si es posible). (REQ-BFF-1, REQ-BFF-2)
- [ ] 13.5 `GET /api/booking/availability` para los **8 servicios** (2 especialidades × 2 centros × 2 tipos): 200, `days` agrupados en Madrid, sin `user_ids`; comprobar el supuesto AD-3 (rango de 91 días en una llamada) y, si falla, activar el troceado (3.4). (REQ-3, REQ-BFF-4, AD-3)
- [ ] 13.6 Rechazos sin llamada upstream: `from=` en availability ⇒ 400; `Origin` ajeno ⇒ 403 `forbidden`; honeypot ⇒ 200 `received` sin efectos; sin token/Turnstile inválido ⇒ 403 `turnstile_failed`; `DELETE` ⇒ 405; confirmar en el panel de cuota/logs que no hubo llamadas a Nubimed. (REQ-BFF-1, REQ-BFF-3, REQ-BFF-8)
- [ ] 13.7 Cache API en `*.pages.dev` y dominio propio: dos availability idénticas en < 60 s ⇒ una sola llamada upstream; degradación sin error visible si la caché falla. Anotar el resultado (AD-4). (REQ-BFF-5)
- [ ] 13.8 Con `bookingPublic=true` **solo en el preview local/rama** (no mergeable): recorrer el flujo en es/en/ca/fr, `?preset=3`/`386`, `sede`, horas en `Europe/Madrid` con el navegador en otra zona, un solo GET de availability, Turnstile reiniciado tras cada envío, aviso de salud visible, sin checkbox de marketing, sin texto reCAPTCHA. (REQ-2, REQ-4, REQ-7, REQ-9, REQ-13, REQ-14, REQ-16)
- [ ] 13.9 **Una petición real por centro** (Barcelona agenda `29537`, El Vendrell agenda `26912`) por el flujo completo: confirmar que aparece en Nubimed con agenda/hueco/servicio correctos; **registrar `state`, presencia de `assigned_time`, valor exacto del estado de aceptación, formato del prefijo (`"34"` vs `"+34"`), campos obligatorios (señal 422) y el copy mostrado** (confirmed vs received); revisar el email de Nubimed recibido (dirección de Calafell); anular con `POST /cita_peticiones/{id}/anular` o desde el panel. Si algún supuesto de AD-5 falla, corregir `createPeticion`/`detectBookingStatus` con un test RED antes. (REQ-23, REQ-BFF-6, AD-5)
- [ ] 13.10 Errores por código en preview: `slot_unavailable` (hora ya tomada o inexistente), `busy` (simulado), `unknown` (simulado con timeout); confirmar copy y que no hay reenvío automático. (REQ-9, REQ-BFF-10)
- [ ] 13.11 Revisar logs de Functions: sin bodies, query, cabeceras, PII ni tokens. (REQ-BFF-11)
- [ ] 13.12 Redactar el `verify-report`; copy DRAFT (legal, éxito, salud, `unknown`, banner) validado por el usuario. Si cualquier paso de 13.3-13.11 falla, `bookingPublic` permanece `false` y se corrige antes de continuar. (REQ-23)
- [ ] 13.13 Solo si 13.3-13.12 pasan: cambiar `bookingPublic = true` en `src/i18n/site-features.ts`, `npm run check`, redeploy y smoke de los CTAs (`preset=386` capilar, `preset=3` facial, genéricos sin preset). (REQ-1, REQ-23)
- [ ] 13.14 Comprobar el rollback: `bookingPublic = false` + redeploy restaura placeholder/WhatsApp con cero peticiones a `/api/booking/*`; los Functions quedan sin consumidores. Ante sospecha de abuso o fuga: revocar el token en Nubimed y borrar secrets. (REQ-1, REQ-11)
