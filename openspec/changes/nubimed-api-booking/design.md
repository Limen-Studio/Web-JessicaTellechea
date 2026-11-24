# Design: Reserva vía API Nubimed (BFF en Cloudflare Pages Functions)

## Contexto

El wrapper del portal es inviable (reCAPTCHA de Nubimed no autoriza el dominio). Las decisiones del proposal son finales: BFF en Pages Functions, `POST /cita_peticiones`, Turnstile, catálogo con `agendaId` por centro (discovery H1: Barcelona **29537**, El Vendrell **26912**). Specs: `specs/` de este cambio (en paralelo; este design no depende de su texto).

Estrategia: **la UI de `BookingFlow` se conserva**; se reemplaza su capa de datos. La lógica pura (catálogo, contrato, validación, agrupado por día) vive en `src/features/booking-nubimed/` y la importan **la isla y el Function**. Lo que toca secrets, `fetch` upstream, Cache API y Turnstile vive solo en `functions/`.

## Architecture Decisions

### AD-1: Layout de archivos — un Function por endpoint + `_lib` de servidor + módulos puros compartidos

**Decision.**

| Archivo | Rol |
|---|---|
| `functions/api/booking/availability.ts` | `onRequestGet` |
| `functions/api/booking/request.ts` | `onRequestPost` |
| `functions/api/booking/health.ts` | `onRequestGet` (opcional; solo presencia de env, sin upstream) |
| `functions/_lib/env.ts` | `BookingEnv`, `BookingContext` (tipos locales: `request`, `env`, `waitUntil`) y `readConfig(env)` fail-closed |
| `functions/_lib/http.ts` | `json(status, body, extra?)` con `Cache-Control: no-store` + `X-Robots-Tag: noindex, nofollow`; `isSameOrigin(request)` |
| `functions/_lib/upstream.ts` | `nubimedFetch` (headers, timeout, reintento GET), `getAvailability` (Cache API), `createPeticion` |
| `functions/_lib/upstream-errors.ts` | mapeo puro status upstream → `{ status, code }` |
| `functions/_lib/turnstile.ts` | `verifyTurnstile(secret, token, ip)` |
| `src/features/booking-nubimed/catalog.ts` | **nuevo**: ids (sin labels), cero imports de runtime |
| `src/features/booking-nubimed/api-contract.ts` | **nuevo**: tipos de request/response, `BookingErrorCode`, límites, `validateBookingRequest`, `parseAvailabilityQuery` |
| `src/features/booking-nubimed/agenda-hours.ts` | **nuevo**: `parseAgendaHours` (tuplas `[iso, ids, meta]`), `groupByMadridDay`, `formatSlotTime` |

Los módulos puros solo usan `import type` o imports relativos entre ellos con extensión `.ts` (requisito de `node --test` con strip-types, AD-10).

**Rationale.** Un archivo por ruta usa el routing por archivos de Pages sin parsear paths ni métodos a mano (Pages responde 405/404 al resto). `catalog.ts` separado de `config.ts` evita que el Function arrastre `clinic-locations.ts` (`import.meta.env`) e i18n.

**Supuestos a verificar en preview.** (a) El build de Pages (esbuild) bundlea imports relativos fuera de `functions/` (`../../../src/...`). (b) `functions/_lib/*` no genera rutas (no exporta `onRequest*`). (c) Las variables y secrets del dashboard llegan a `context.env`. Si (a) falla: mover `catalog.ts`/`api-contract.ts`/`agenda-hours.ts` a `functions/_lib/` e importarlos desde la isla (Vite resuelve cualquier ruta del repo).

**Alternatives considered.** `functions/api/booking/[[route]].ts` único: router manual, más superficie. `_middleware.ts` para same-origin/headers: magia implícita para 2 rutas.

### AD-2: Catálogo — `centro → agendaId` + `(specialty, centro, kind) → serviceId`

**Decision.** `catalog.ts`:

```ts
export type SpecialtyId = 3 | 386;
export type CentroKey = 'barcelona' | 'el-vendrell'; // = ClinicLocationKey (type-only)
export type ServiceKind = 'firstVisit' | 'treatments';
export const MODALITY = 'presencial';
export const AGENDA_BY_CENTRO: Record<CentroKey, number> = { barcelona: 29537, 'el-vendrell': 26912 };
export const SERVICE_IDS: Record<SpecialtyId, Record<CentroKey, Record<ServiceKind, number>>>;
// 3: bcn 389741/389745, ev 389742/389746 · 386: bcn 389743/389747, ev 389744/389748
export function resolveBookingTarget(s: unknown, c: unknown, k: unknown):
  { specialtyId: SpecialtyId; centro: CentroKey; kind: ServiceKind; agendaId: number; serviceId: number } | null;
```

`config.ts` conserva labels, `matchKeys`, `treatmentsDetail`, `FIRST_VISIT_DETAIL`, `phonePrefixSelectOptions`, `centroFor`; `SpecialtyCentro` pierde `areaId`, `firstVisitTreatmentId`, `treatmentsTreatmentId` y se queda con `centro` + `treatmentsDetail`; los ids se leen de `catalog.ts`. Se elimina `tipoHorario` (pasa a `MODALITY`).

**Rationale.** Una sola fuente de ids (REQ-3), consumible por el servidor sin i18n. El cliente nunca envía ids numéricos de agenda/servicio: el servidor los resuelve.

**Alternatives considered.** Catálogo indexado por `serviceId` con resolución runtime vía `GET /agendas` (exploration §2): innecesario tras H1 y gasta cuota.

### AD-3: Contrato de disponibilidad — ventana fija del servidor, una carga por servicio

**Decision.**
- `GET /api/booking/availability?specialty=3&centro=barcelona&kind=firstVisit`. **Sin `from`/`to` del cliente**: el servidor calcula `from = hoy (Madrid)`, `to = from + 90` (91 días, `horizon.ts`).
- Upstream: `GET /agendas/{agendaId}?start_date=YYYYMMDD&end_date=YYYYMMDD&service_id={serviceId}&modality=presencial`.
- Respuesta 200: `{ ok: true, from, to, days: { 'YYYY-MM-DD': string[] } }` — ISO tal cual de la API, ordenados, agrupados por día en `Europe/Madrid`; se descartan `user_ids` y `meta`.
- La isla pide **una vez** al entrar en `datetime` (y al cambiar servicio); los cambios de mes y de día no piden nada.

**Rationale.** Ventana fija ⇒ una sola clave de caché por servicio y día ⇒ máximo acierto y mínima cuota; menos validación. Una agenda = una profesional ⇒ no hay selector de profesional.

**Supuesto.** Que la API acepte 91 días en una llamada. Si el preview muestra límite/error: `getAvailability` trocea en tramos ≤ 31 días (`Promise.allSettled`, misma clave de caché final).

**Alternatives considered.** Paginado por mes desde la isla: hasta 4 claves por servicio y más llamadas. `from/to` libres: fragmenta la caché y abre abuso.

### AD-4: Caché — Cache API con clave sintética, TTL 60 s, degradación silenciosa

**Decision.**
- `caches.open('booking-availability')` (tipado DOM, sin casts). Clave: `new Request(\`${origin}/__cache/booking/availability/v1/${agendaId}/${serviceId}/${from}\`)`.
- Se guarda **nuestro JSON normalizado** con `Cache-Control: public, max-age=60`; `cache.put` vía `waitUntil`.
- Cualquier excepción de Cache API ⇒ se ignora y se va a upstream.
- Respuestas al navegador: siempre `no-store` (tras un `slot_unavailable` el refetch debe ser fresco desde la edge).
- Cuota (peor caso, tráfico continuo): 8 servicios × 1 miss/min × 10 min ≈ 80 por colo; con 2-3 colos en España ≈ 240/600, más POSTs y re-checks. Con picos o sin caché: 429 ⇒ `busy` (AD-6).

**Rationale.** Cero deps, por colo, suficiente para un sitio pequeño.

**Alternatives considered.** KV: sobredimensionado y eventual. Stale-on-error (segunda clave larga): se añade solo si el preview/producción muestra 429.

### AD-5: Contrato de petición y mapeo a `POST /cita_peticiones`

**Decision.** Body (JSON, ≤ 8 KB):

```ts
interface BookingRequestBody {
  specialty: 3 | 386; centro: CentroKey; kind: ServiceKind;
  requestedTime: string;               // ISO exacto recibido en availability
  patient: { name: string; surname: string; phonePrefix: string; phone: string; email: string };
  comments?: string; consent: true; turnstileToken: string; website?: string; // honeypot
}
```

Límites (`api-contract.ts`): name/surname 1-80 tras `trim`; `phonePrefix` `^[1-9]\d{0,3}$`; phone 6-15 dígitos tras quitar espacios/guiones; email ≤ 254 y regex simple, **obligatorio**; comments ≤ 500, opcional; `consent === true`.

Orden en `request.ts` (nada llama a Nubimed hasta el paso 6):
1. `Content-Type: application/json` y tamaño ⇒ si no, 400/413 `invalid`.
2. Same-origin: `Origin === new URL(request.url).origin`; sin `Origin`, `Sec-Fetch-Site === 'same-origin'` ⇒ si no, 403 `forbidden`.
3. Honeypot `website` no vacío ⇒ 200 `{ ok: true, status: 'received' }` sin efectos.
4. `validateBookingRequest` + `resolveBookingTarget` ⇒ 400 `invalid` con `fields`.
5. Turnstile (AD-7) ⇒ 403 `turnstile_failed`.
6. Re-check: `getAvailability(target)` (caché) contiene `requestedTime` en su día ⇒ si no, 409 `slot_unavailable`.
7. Upstream: `{ clinica_id: Number(env.NUBIMED_CLINIC_ID), speciality_id, schedule_id: agendaId, service_id, requested_time, patient_name, patient_surname, patient_phone, patient_country_calling_code: phonePrefix, patient_email, comments?, modality: 'presencial' }`.
8. Respuesta: `{ ok: true, status: 'confirmed' }` si `assigned_time` es string no vacío **o** `state === 'aceptada'`; si no, `'received'`. Nunca se devuelve `id`, PII ni el body de Nubimed.

**Supuestos a verificar en la prueba real.** Formato de `patient_country_calling_code` (`"34"` vs `"+34"`); nombre exacto del estado aceptado; si email/comments son obligatorios (señal: 422).

**Alternatives considered.** Confiar en `scheduleId`/`serviceId` del cliente: ids arbitrarios. Copy "confirmada" fijo: mentiría si se desactiva la autoaceptación.

### AD-6: Códigos de error, timeouts y reintentos

**Decision.** `BookingErrorCode = 'invalid' | 'forbidden' | 'turnstile_failed' | 'slot_unavailable' | 'busy' | 'config' | 'upstream' | 'unknown'`, exportado por `api-contract.ts` y usado por la isla para elegir copy.

| Upstream | Availability | Request |
|---|---|---|
| 429 | 503 `busy` + `Retry-After` (upstream o 60) | igual |
| 422 | 502 `config` | 422 `invalid` + `fields` (solo claves conocidas `patient_*`→nuestros nombres) |
| 400 | 502 `config` | 400 `invalid` |
| 404 | 502 `config` | 409 `slot_unavailable` |
| 401/403 | 502 `config` | 502 `config` |
| 5xx / red / timeout | 502 `upstream` | fallo antes de enviar ⇒ 502 `upstream`; **5xx, timeout o red tras enviar ⇒ 502 `unknown`** (un 5xx no garantiza que no se creara; evitar duplicados) |

- Timeout: `AbortSignal.timeout(8000)` GET, `10000` POST.
- Reintento: 1, solo GET, solo en 5xx/red/timeout, tras ~300 ms. **POST nunca.**
- `unknown` ⇒ copy "no pudimos confirmar el envío; no lo repitas, escríbenos por WhatsApp" (evita duplicados).
- Logs: solo `console.warn('booking', endpoint, upstreamStatus)` en `config`/`upstream`. Nunca body, query, headers ni PII.

### AD-7: Antiabuso — Turnstile explícito en el modal de confirmación

**Decision.**
- Script `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` inyectado por la isla al entrar en `details` (no en la carga de la página).
- Al abrir el modal: `turnstile.render(el, { sitekey, action: 'booking', appearance: 'interaction-only', callback, 'error-callback', 'expired-callback' })`. "Finalizar" deshabilitado hasta tener token.
- Token de un solo uso: tras **cualquier** respuesta del POST (éxito o error) ⇒ `turnstile.reset(widgetId)`; al cerrar el modal ⇒ `remove`.
- Servidor: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` (form: `secret`, `response`, `remoteip` = `CF-Connecting-IP`), timeout 5 s; exige `success === true` y `action === 'booking'`. Error/timeout de siteverify ⇒ `turnstile_failed` (fail-closed).
- Fallo de carga/`error-callback`/sin site key ⇒ aviso `turnstileFailed` con enlaces a WhatsApp (`PUBLIC_WHATSAPP_E164`) y a contacto.
- Honeypot `website`: input fuera de pantalla, `tabindex=-1`, `autocomplete="off"`, `aria-hidden`.
- Recomendación (fuera del código): regla WAF Rate Limiting sobre `POST /api/booking/request` (p. ej. 5/10 min por IP) si el plan lo permite.
- CSP: hoy no hay `_headers`; si se añade, permitir `challenges.cloudflare.com` en `script-src` y `frame-src`.

**Alternatives considered.** Widget visible siempre: fricción. Ejecutar Turnstile al cargar la página: el token caduca (~5 min) antes del envío.

### AD-8: Refactor de `BookingFlow.tsx` — diff mínimo sobre la capa de datos

**Decision.**

| Quitar | Reemplazar por |
|---|---|
| `nubimedBaseUrl`, `portalFallbackUrl`, `clinicaIdFromEnv`, `isRuntimeLocalhost`, `csrfRef`, `client` | `client.ts` nuevo: `fetchAvailability(signal, target)`, `submitBookingRequest(signal, body)`; lanza `BookingApiError(code, fields?, retryAfter?)` |
| `bootstrap`, `bootLoading`, `bootErr`, `gateUrl`, `runBootstrap` y sus 3 pantallas | nada (la isla arranca directamente en el paso inicial) |
| `loadDays` + `loadSlots`, `days`, `slots`, `slotsLoading`, `slotsErr` | un efecto `loadAvailability` ⇒ `availability: Record<ymd, string[]> \| null`, `availabilityLoading`, `availabilityErr`; `days` y `slots` **derivados** con `useMemo` |
| `Slot` (`professionalIds`, `displayLabel`), `professionalId`, fieldset de profesional | `selectedSlotIso: string \| null` |
| `parsedNew`, `detailsLoading`, `detailsErr`, `onContinueFromPick` | al elegir hora ⇒ `setPhase('details')` (se mantiene el auto-avance) |
| `patientMode`, `retDni`, `retDob`, pestañas | solo campos de paciente nuevo + textarea `comments` (con aviso de datos de salud, `maxLength=500`) + honeypot |
| `onFinalize` (reCAPTCHA + merge + substrings) | POST JSON de AD-5; errores por `code`; `submitting` bloquea botón y cierre del modal |
| `summaryTimeLabel`/`slotLabel24h` sin zona | `formatSlotTime(iso)` con `timeZone: CLINIC_TIMEZONE` |
| `success` único | `successStatus: 'confirmed' \| 'received'` ⇒ copy distinto |
| `newUrlSelection` | `bookingTarget` derivado (`specialty`, `centro`, `kind`) |

`TreatmentOption` gana `kind: ServiceKind` y pierde `areaId`/`tipoHorario`; `id` y `?treatment=` siguen aceptando el `serviceId` (de `catalog.ts`). Props nuevas: `turnstileSiteKey?: string`, `whatsappHref?: string` (resueltas en `[segment].astro` con accesos literales a `import.meta.env`). Horizonte: `effectiveHorizonDays(91)`. CSS `booking-flow__recaptcha-*` se renombra a `booking-flow__captcha-*`.

**Rationale.** La UI (calendario, stepper, scroll móvil, modal) está pulida; el riesgo está en la capa de datos. Derivar días/franjas de un solo mapa quita un fetch y dos estados de error.

**Alternatives considered.** Extraer un hook `useAvailability`: una sola llamada no lo justifica y mueve más líneas. `useReducer`: diff grande.

### AD-9: Secrets, env y desarrollo local

**Decision.**

| Nombre | Tipo | Dónde |
|---|---|---|
| `NUBIMED_API_EMAIL`, `NUBIMED_API_TOKEN`, `TURNSTILE_SECRET_KEY` | secret | Pages (Production **y** Preview) / `.dev.vars` |
| `NUBIMED_CLINIC_ID` (`1212`) | variable | idem |
| `NUBIMED_API_BASE` (opcional, default `https://api.clinicaenlanube.com/api/v1`, solo `https:`) | variable | idem |
| `PUBLIC_TURNSTILE_SITE_KEY` | pública (build) | build env Cloudflare / `.env` |

- `readConfig` falla cerrado: falta cualquier valor ⇒ 503 `config` sin llamar a nadie. Headers upstream: `X-User-Email`, `X-User-Token`, `User-Agent: JT`, `Accept: application/json`.
- **Primer commit**: `.gitignore` + `.dev.vars`, `.dev.vars.*`, `!.dev.vars.example`, `.wrangler/`; luego `.dev.vars.example` sin valores (con las claves de prueba de Turnstile comentadas: site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA` — verificar en la doc vigente).
- Dev (opción B): `npm run dev` + `npx wrangler@4 pages dev public --port 8788` (sirve `functions/`); `astro.config.mjs` sustituye el proxy `/__nubimed-proxy` por `'/api/booking': 'http://127.0.0.1:8788'` (server y preview). Verificación final (opción A): el **usuario** ejecuta `npm run build` y `npx wrangler@4 pages dev dist`.
- Wrangler vía `npx` con major fijado, **sin** devDependency (mismo criterio que AD-7 de `reenable-nubimed-booking`: cero deps; tradeoff: descarga en el primer uso).
- Sin `wrangler.toml` (deploy por git; compatibilidad en el dashboard).

**Supuesto.** `wrangler pages dev public` sirve los Functions de `./functions` con un directorio estático cualquiera; si no, usar `dist` (requiere build del usuario).

### AD-10: Testing — `node --test` cero deps (decisión del usuario)

**Decisión del usuario (2026-11-24): APROBADO.** Apply sigue Strict TDD para los módulos puros listados abajo.

**Detalle.** Script `"test:unit": "node --experimental-strip-types --test tests/unit/"` (Node ≥ 22.12 del `engines`), tests en `tests/unit/*.test.ts` (los tipa `astro check` vía `**/*` + `@types/node`). Cubren: `resolveBookingTarget`, `validateBookingRequest`, `parseAvailabilityQuery`, `parseAgendaHours`/`groupByMadridDay` (cambio de hora y medianoche), `formatSlotTime`, `upstream-errors`, detección `confirmed/received`. Requiere imports con extensión `.ts` en módulos puros; **verificar** que `astro check` acepta `allowImportingTsExtensions` (lo trae el tsconfig base de Astro; si no, módulos hoja sin imports relativos de runtime). Si el usuario lo aprueba, apply sigue Strict TDD para estos módulos; si no, verificación manual + `npm run check`.

### AD-11: Borrados, i18n y legal

**Decision.** Borrar: `parse-widget.ts`, `parse-new-booking-html.ts`, `build-new-url.ts`, `booking-submit-merge.ts`, `nubimed-portal-submit-fields.ts`, `recaptcha.ts`, `normalize-huecos.ts` (reemplazado por `agenda-hours.ts`), `functions/__nubimed-proxy/[[path]].ts`, proxy Vite del portal, `PUBLIC_NUBIMED_*` de `src/env.d.ts`/`.env.example`, `BootstrapSession`, `Slot` y `'gate_blocked'` de `types.ts`. `robots.txt.ts`: `/__nubimed-proxy/` ⇒ `/api/booking/`.

i18n (4 locales) — retirar: `loadingBootstrap`, `gateBlocked`, `openPortal`, `loadingConfirmPage`, `recaptcha*`, `modeNewPatient`, `modeReturningPatient`, `fieldDni`, `fieldBirthDate`, `patientHadVisitBefore`, `submitSuccess`, y los textos del checkbox de marketing (decisión del usuario: se elimina `marketingOk`). Añadir: `fieldComments`, `commentsHealthNotice`, `turnstileNotice`, `turnstileFailed`, `slotUnavailable`, `busy`, `submitUnknown`, `submitSuccessConfirmed`, `submitSuccessReceived`.

**Ask first (copy):** `bookingLegalSummaryBody`, `legal-content/privacy.ts`, `legal-content/cookies.ts`, `cookie-consent-strings.ts` (Cloudflare/Turnstile en lugar de Google/reCAPTCHA), aviso de salud y copy de éxito. Apply deja borradores marcados para revisión.

### AD-12: Sincronización de spec

**Decision.** Antes de escribir el delta de este cambio: archivar `reenable-nubimed-booking` (tiene verify report) para que `openspec/specs/web-booking-nubimed-client/spec.md` sea el baseline real. **Hecho 2026-11-24** (`openspec/changes/archive/2026-11-24-reenable-nubimed-booking/`, archivado con problemas conocidos; REQ-16 sincronizado al comportamiento de la PR #12). Este delta modifica REQ-3/7/9/11/12/13/16 y elimina/reemplaza REQ-20/21/23 sobre ese baseline; `web-booking-bff` es capability nueva.

**Alternatives considered.** Delta escrito sobre un baseline no sincronizado: el archive fusionaría sobre requisitos que no existen en `specs/`.

## Data / Contract Changes

- Nuevos: `functions/api/booking/{availability,request,health}.ts`, `functions/_lib/{env,http,upstream,upstream-errors,turnstile}.ts`, `src/features/booking-nubimed/{catalog,api-contract,agenda-hours}.ts`, `.dev.vars.example`, `tests/unit/*.test.ts` (si AD-10).
- Modificados: `config.ts` (AD-2), `client.ts` (reescrito), `types.ts`, `BookingFlow.tsx` (AD-8), `i18n.ts`, `booking-flow.css` (clases captcha), `[segment].astro` (props), `env.d.ts`, `astro.config.mjs`, `robots.txt.ts`, `.gitignore`, `.env.example`, `package.json` (solo `test:unit` si AD-10), docs (`AGENTS.md`, `README.md`, `docs/stack-and-deployment-context.md`, `docs/site-architecture.md`).
- Borrados: AD-11.

## Rollout / Rollback

- **Antes (decisión del usuario, fuera de esta PR):** hotfix `bookingPublic = false` en `main`.
- **Rollout:** secrets en Pages Preview + Production; hostname del preview y producción en el widget Turnstile. En el preview: health 200, availability por los 8 servicios, verificar supuestos AD-1/3/4/9, un 403 sin Turnstile y un 200 simulado con honeypot (ninguno llega a Nubimed). **Una petición real por centro**; registrar `state`/`assigned_time`; revisar el email de Nubimed (dirección Calafell); anular con `POST /cita_peticiones/{id}/anular` (curl manual del usuario) o desde el panel. Merge y `bookingPublic = true` solo tras eso.
- **Rollback:** `bookingPublic = false` + redeploy (los Functions quedan sin consumidores). `git revert` si falla el build. Ante sospecha de abuso o fuga: revocar el token en Nubimed y borrar secrets.

## Open Questions

- [x] AD-10: `node --test` + Strict TDD en apply para módulos puros — **aprobado por el usuario (2026-11-24)**.
- [x] `marketingOk`: **quitar** el checkbox y su texto en los 4 locales — **decisión del usuario (2026-11-24)**; la API no tiene campo para registrarlo.
- [x] AD-12: `reenable-nubimed-booking` archivado y sincronizado (2026-11-24).
- [ ] Copy legal/éxito/aviso de salud (AD-11): validación del usuario.
- [ ] Supuestos AD-1 (a)-(c), AD-3 (rango 91 días), AD-4 (Cache API en `*.pages.dev` y dominio propio), AD-5 (prefijo, estado aceptado, campos obligatorios), AD-9 (`wrangler pages dev public`): se cierran en el preview.
- [ ] ¿La API excluye huecos ocupados en `GET /agendas/{id}`? Asumido sí; el re-check + 404→409 cubren el resto.
