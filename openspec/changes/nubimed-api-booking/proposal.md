# Proposal: Reserva vía API Nubimed (BFF en Cloudflare Pages Functions)

## Intent

El wrapper del portal (scraping `/widget` + `/new`, reCAPTCHA del vendor, proxy genérico) es **inviable**: Nubimed no autoriza `www.dratellechea.com` en su key de reCAPTCHA y todo envío falla con "Recaptcha Validation Error". Nubimed concede acceso a su **API**. Éxito = el paciente elige especialidad → centro → servicio → día → hora → datos y se crea una **petición de cita** real en Nubimed, sin secretos en el navegador.

## Decisiones del usuario (2026-11-24)

1. API Nubimed detrás de un **BFF** en Pages Functions; `X-User-Email`/`X-User-Token` como secrets de Cloudflare; `User-Agent: JT`; `clinica_id` 1212. (Hosting/servidor: "Ask first" → **aprobado** por el usuario.)
2. `POST /cita_peticiones`, **no** `POST /citas`.
3. Nubimed **autoacepta** peticiones. Copy de éxito según la respuesta: "cita confirmada" si hay `assigned_time` / estado aceptado; si no, "solicitud recibida, te confirmaremos por email". **Nunca** hardcodear "confirmada".
4. Mapeo (discovery, H1): una agenda por centro — Barcelona `schedule_id` **29537**, El Vendrell **26912**; `service_id` sin cambios (BCN 389741/389743/389745/389747; EV 389742/389744/389746/389748). Catálogo guarda `agendaId` por centro; sin `GET /agendas` en runtime (solo health-check opcional).
5. Se conservan UX/steps/diseño; se elimina la pestaña "Ya registrado" (DNI + fecha de nacimiento); se añade `comments` (motivo) con aviso de datos de salud.
6. Antiabuso: Turnstile verificado en servidor + honeypot + validación estricta + same-origin; regla WAF de rate limit si el plan lo permite.

## Scope

### In Scope
- Seguridad previa: `.dev.vars` y `.wrangler/` en `.gitignore` **antes** de crear secretos; `.dev.vars.example` sin valores.
- Catálogo: `agendaId` por centro; desaparece `areaId`.
- BFF: `GET /api/booking/availability` y `POST /api/booking/request` (+ `GET /api/booking/health` opcional); validación contra catálogo (sin ids crudos del cliente); Cache API; timeouts; mapeo de errores sin reenviar bodies de Nubimed.
- Refactor del data layer de `BookingFlow` (sin bootstrap/gate/`/new`); campo `comments`; fix de `summaryTimeLabel` (zona `Europe/Madrid`).
- Turnstile (widget + siteverify) con fallback visible a WhatsApp/teléfono.
- i18n es/en/ca/fr y copy legal (reCAPTCHA → Turnstile/Cloudflare).
- Borrado de scraping, proxy `__nubimed-proxy` y reCAPTCHA.
- Docs/spec y desarrollo local con `wrangler pages dev`.

### Out of Scope
- `POST /citas` directo, búsqueda de paciente (NIF), mutuas, reprogramar/cancelar por el paciente, webhooks.
- Indexar booking o meterlo en la nav (sigue `noindex`, fuera de sitemap).

## Capabilities

### New Capabilities
- `web-booking-bff`: endpoints `/api/booking/*`, secrets de runtime, caché, mapeo de errores, antiabuso (Turnstile, honeypot, validación, same-origin), no-logging de PII.

### Modified Capabilities
- `web-booking-nubimed-client`: REQ-3 (catálogo `agendaId`/`serviceId`), REQ-7 (carga de rango), REQ-9 (petición vía BFF + copy según respuesta), REQ-11 (BFF reemplaza proxy), REQ-12 (secrets runtime, sin `PUBLIC_NUBIMED_*`), REQ-13 (Turnstile), REQ-16 (sin "Ya registrado"; `comments`), REQ-20/21/23 del delta `reenable-nubimed-booking` (eliminar `area`, reemplazar proxy, reescribir prueba real).
- **Baseline de spec**: el delta de `reenable-nubimed-booking` **no está sincronizado** en `openspec/specs/`. El spec phase DEBE archivar/sincronizar ese delta primero, o declarar explícitamente que este delta se escribe sobre él (recomendado: sincronizar antes).

## Approach (fases)

1. **Seguridad**: `.gitignore` (`.dev.vars`, `.wrangler/`), `.dev.vars.example`.
2. **Catálogo**: `config.ts` con `agendaId` por centro; quitar `areaId`.
3. **BFF** (`functions/api/booking/`, tipos locales, cero deps; módulos puros en `src/features/booking-nubimed/`): disponibilidad con `GET /agendas/{id}` (`modality=presencial`), Cache API (TTL ~60 s), `AbortSignal.timeout`, 1 reintento solo en GET; request con `POST /cita_peticiones` inyectando `clinica_id`/`speciality_id`/`service_id`/`schedule_id` desde catálogo; **nunca** reintentar el POST. Mapeo: 429→503 `busy` + `Retry-After`; 422→422 `invalid` (solo nombres de campo); 404→409 `slot_unavailable`; 401/403→502 `config`; 5xx/timeout→502 `upstream`. Respuesta al cliente: `{ ok, confirmed }` sin PII.
4. **BookingFlow**: `client.ts` mínimo; fusionar `loadDays`/`loadSlots`; hora → `details` directo; quitar pestaña `returning`; errores por `code`; botón bloqueado durante envío.
5. **Turnstile**: `PUBLIC_TURNSTILE_SITE_KEY` en `[segment].astro`; siteverify con `CF-Connecting-IP`; honeypot → 200 simulado.
6. **i18n + legal** (4 locales): retirar claves de portal/reCAPTCHA/DNI; añadir `fieldComments`, `turnstileFailed`, `slotUnavailable`, `busy`, copy confirmada/recibida.
7. **Borrado**: `parse-widget.ts`, `parse-new-booking-html.ts`, `build-new-url.ts`, `booking-submit-merge.ts`, `nubimed-portal-submit-fields.ts`, `recaptcha.ts`, `functions/__nubimed-proxy/`, proxy Vite del portal.
8. **Docs/spec**: `AGENTS.md`, `docs/stack-and-deployment-context.md`, `docs/site-architecture.md`, `README.md`, `.env.example`, `robots.txt.ts` (`Disallow: /api/booking/`).
9. **Dev local**: `astro dev` + `wrangler pages dev --port 8788` con proxy Vite `/api/booking` (opción B); verificación final con `wrangler pages dev dist` (A).

## Requiere validación del usuario ("Ask first")

- Copy legal/privacidad/cookies (Cloudflare como encargado/Turnstile; quitar Google/reCAPTCHA): `legal-content/privacy.ts`, `legal-content/cookies.ts`, `cookie-consent-strings.ts`, `bookingLegalSummaryBody`.
- Aviso de datos de salud en `comments` y copy de éxito confirmada/recibida.

## Affected Areas

| Area | Impact |
|------|--------|
| `.gitignore`, `.dev.vars.example` | Modified / New |
| `functions/api/booking/**` | New |
| `functions/__nubimed-proxy/[[path]].ts` | Removed |
| `src/features/booking-nubimed/{config,client,types,normalize-huecos,i18n}.ts`, `BookingFlow.tsx` | Modified |
| `src/features/booking-nubimed/` (6 módulos de scraping/reCAPTCHA) | Removed |
| `src/pages/[lang]/[segment].astro`, `src/pages/robots.txt.ts`, `src/env.d.ts`, `astro.config.mjs` | Modified |
| `src/i18n/legal-content/{privacy,cookies}.ts`, `cookie-consent-strings.ts` | Modified (Ask first) |
| `AGENTS.md`, `docs/*.md`, `README.md`, `.env.example` | Modified |

## Env / secrets

| Nombre | Tipo | Dónde | Acción |
|---|---|---|---|
| `NUBIMED_API_EMAIL` | secret | Pages runtime / `.dev.vars` | Añadir |
| `NUBIMED_API_TOKEN` | secret | idem | Añadir |
| `NUBIMED_CLINIC_ID` (`1212`) | variable | idem | Añadir |
| `TURNSTILE_SECRET_KEY` | secret | idem | Añadir |
| `PUBLIC_TURNSTILE_SITE_KEY` | pública (build) | Cloudflare build env / `.env` | Añadir |
| `PUBLIC_NUBIMED_CLINICA_ID`, `_VENDOR_ORIGIN`, `_PROXY_URL`, `_PORTAL_NEW_URL` | pública | build env | **Retirar** |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cuota compartida 600 req/10 min → 429 | Med | Cache API, Turnstile antes del POST, WAF por IP, mapeo `busy` |
| Cache API no operativa en dominio propio | Med | Verificar en preview y producción; degradar sin caché |
| Campos condicionales (email/`comments`) → 422 | Med | Email obligatorio en UI; mapear 422 a campos; prueba real |
| Zona horaria de `requested_time`; bug latente `summaryTimeLabel` | Med | Enviar el ISO de la API tal cual; formatear con `CLINIC_TIMEZONE` |
| Turnstile bloqueado (adblock/red corporativa) | Med | Mensaje + enlaces WhatsApp/teléfono |
| Doble envío → peticiones duplicadas | Med | Botón bloqueado, token de un solo uso, sin reintento del POST |
| Datos de salud en `comments` | Med | Aviso en el campo, ≤ 500 chars, nunca loguear |
| Autoaceptación asíncrona (respuesta `pendiente`) | Med | Copy guiado por respuesta; verificar en prueba real |
| Emails de Nubimed muestran `center_address` Calafell | Low | UI usa `clinic-locations.ts`; revisar email de prueba y avisar a la clínica |
| Commit accidental de secretos | Low | Fase 1 `.gitignore` antes de `.dev.vars` |
| Spec base desincronizado | Med | Sincronizar `reenable-nubimed-booking` antes del delta |

## Rollout

- **Riesgo actual en producción (decisión del usuario, NO ejecutada por esta propuesta)**: `main` tiene `bookingPublic = true` y el envío del wrapper falla ("Recaptcha Validation Error"). **Recomendado**: hotfix inmediato y separado con `bookingPublic = false` en `main` (CTAs → WhatsApp) hasta que este cambio salga.
- Este cambio se valida en preview `*.pages.dev` con secrets reales; `bookingPublic = true` solo tras pasar los criterios de éxito.

## Rollback Plan

1. `bookingPublic = false` → CTAs a WhatsApp, placeholder en la ruta (rebuild + deploy).
2. `git revert <sha>` del merge si falla BFF/build.
3. Revocar/rotar el token en Nubimed y borrar secrets en Cloudflare si hay sospecha de fuga o abuso.

## Dependencies

- Token de API Nubimed y claves Turnstile cargados en Cloudflare (preview + producción).
- Clínica disponible para revisar y anular peticiones de prueba.

## Success Criteria

- [ ] Una petición real por centro (BCN 29537, EV 26912) aparece en Nubimed con hueco y servicio correctos, y se anula (`POST /cita_peticiones/{id}/anular` o panel).
- [ ] Se registra el estado devuelto (autoaceptación) y la UI muestra el copy correspondiente.
- [ ] Ningún secreto en el bundle ni en `PUBLIC_*`; `.dev.vars` ignorado.
- [ ] Sin Turnstile válido o con honeypot relleno, no hay llamada a Nubimed.
- [ ] Sin archivos de scraping/proxy/reCAPTCHA; flag off restaura WhatsApp.
- [ ] `npm run check` y `npm run build` pasan.

## Open Questions (default recomendado)

1. Runner de tests → `node --test` cero deps para funciones puras (catálogo, validación, mapeo de errores).
2. Email/`comments` obligatorios por config de la clínica → email obligatorio, `comments` opcional; confirmar con la prueba (422).
3. Cache API en dominio final → usar y validar en preview; si no, sin caché + WAF.
4. Texto legal / DPA con Cloudflare → actualizar y validar con el usuario antes del go-live.
5. Dev local → opción B; A para verificación final.
