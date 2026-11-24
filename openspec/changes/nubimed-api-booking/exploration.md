# Exploración: nubimed-api-booking

**Fecha**: 2026-11-24 · **Fase**: sdd-explore · **Store**: openspec · **Siguiente**: sdd-propose (el design depende del discovery de §2)

## Contexto de entrada (decisiones del usuario)

- Se abandona el wrapper del portal (`/widget` + `/new` + reCAPTCHA de Nubimed): Nubimed **no autoriza** `www.dratellechea.com` en su key de reCAPTCHA v3 (`6Lc1gPcZ…`, con verificación de dominio). Los envíos fallan con "Recaptcha Validation Error".
- Nubimed concede **acceso a su API**. Se usarán **peticiones de cita** (`POST /cita_peticiones`), no citas directas (`POST /citas` exige NIF).
- `clinica_id` / `center_id` = **1212**. `User-Agent` no se valida → `"JT"`.
- Se conserva la UX: especialidad (3 / 386) → centro (Barcelona / El Vendrell) → servicio (Primera visita / Tratamientos) → día → hora → datos → confirmación.

## API Nubimed (extraída de nubimed.stoplight.io por el orquestador)

- Base `https://api.clinicaenlanube.com/api/v1`. Headers en todas las llamadas: `X-User-Email`, `X-User-Token` (**secreto**), `User-Agent`.
- Rate limit: **600 req / 10 min por usuario de API** (ventana fija), compartido por todo el sitio; 429 `{ "error": "Rate limit exceeded …" }`. Recomiendan cachear agendas/catálogos.
- `GET /agendas` (`all_schedules`; por defecto solo agendas "disponibles para cita online") → `id, professional_id, professional_name, center_id, center_name, center_address, center_phone, specialties [["id","name"]], services [Service], mutualities`.
- `GET /agendas/{agenda_id}` (Horas disponibles): `start_date`, `end_date` (yyyymmdd), `service_id` (duración), `mutuality_id`, `modality` → `[[iso8601, [user_ids], {day_of_week, day_of_week_iso8601}], …]` (mismo shape que `huecos_agenda`).
- `POST /cita_peticiones`: `clinica_id, speciality_id*, patient_id, schedule_id, requested_time*, patient_name*, patient_surname*, patient_phone*, patient_country_calling_code*, patient_email (según config clínica), comments (según config), pref_fecha_hora_cita, service_id, mutuality_id, pref_dia_semana, modality` → 200 `{ id, …, state: "pendiente", schedule_id, patient_id?, requested_time?, service_id?, assigned_time? }`. Códigos 200/400/401/403/404/422/429. **Sin NIF, sin `area_id`.**
- Existen también búsqueda/anulación de peticiones y webhooks.

## Resumen ejecutivo

Se reemplaza el scraping por un **BFF real en Cloudflare Pages Functions** que guarda el token como secret, sirve disponibilidad con caché y crea peticiones de cita. El antispam pasa de reCAPTCHA del vendor a **Turnstile** verificado en servidor + honeypot + validación estricta.

Catálogo **indexado por `service_id`**: los ids 389741..389748 son únicos por especialidad × sede × tipo, así que la sede se deduce del servicio. Resolución runtime `service_id → agenda(s)` vía `GET /agendas`, con override estático `agendaIds`.

Se borran ~8 archivos de scraping; la UI se conserva casi entera. Cambios de producto: desaparece la pestaña **"Ya registrado"** (DNI + fecha de nacimiento) y el éxito pasa a copy de **solicitud pendiente de confirmación**.

## 1. Estado actual (verificado en código)

- `BookingFlow.tsx`: `runBootstrap` (l. 329-364) → `/widget` + `parseWidgetHtml`; `onContinueFromPick` (l. 701-726) → `/new` + `parseNewBookingHtml`; `onFinalize` (l. 766-844) → reCAPTCHA + `buildBookingSubmitBody` + `submitCitaPeticion`, errores por substrings.
- `client.ts`: 6 responsabilidades de scraping + gate (`GateBlockedError`, `throwOnGate`) por cookies/CSRF.
- `functions/__nubimed-proxy/[[path]].ts`: proxy genérico (allowlist, Set-Cookie, Location, Referer/Origin).
- `astro.config.mjs` l. 12-33 y 57-65: proxy Vite dev/preview.
- Reutilizables: `normalize-huecos.ts` (`parseHuecosSlotTuple`, l. 94-109), `horizon.ts` (puro, Madrid, 91 días), `phonePrefixSelectOptions` (ya separa prefijo y número).
- `tsconfig` incluye `**/*` → `functions/` se tipa en `astro check` con tipos locales (patrón cero deps).
- **Gotcha**: `.gitignore` no cubre `.dev.vars` ni `.wrangler/`.
- No hay `wrangler.toml`; deploy por git.
- El delta de `reenable-nubimed-booking` **no está sincronizado** a `openspec/specs/web-booking-nubimed-client/spec.md`.

## 2. Mapeo centro/servicio sin `area_id`

| Especialidad | Sede | Primera visita | Tratamientos |
|---|---|---|---|
| Medicina estética (3) | Barcelona | 389741 | 389745 |
| Medicina estética (3) | El Vendrell | 389742 | 389746 |
| Tricología (386) | Barcelona | 389743 | 389747 |
| Tricología (386) | El Vendrell | 389744 | 389748 |

`center_id` = 1212 es toda la clínica: **no** distingue sedes.

| # | Hipótesis | Señal en `/agendas?all_schedules=true` | Diseño |
|---|---|---|---|
| H1 | Una agenda por sede (o sede × especialidad) | `center_address` distinto o `services[]` disjuntos | Filtrar agendas por `services[].id ∋ serviceId` |
| H2 | Una agenda por profesional con servicios de ambas sedes | Mismo profesional, `services[]` con los 8 ids | Igual: el servicio elige la agenda |
| H3 | `services[].id` en otro espacio de ids | Ids distintos, nombres tipo "Primera visita" | Fallback por nombre o mapa explícito |
| H4 | Una agenda sin separación de sede | Una agenda para todo | Sede no deducible: va en `comments` o un servicio por sede |

**Catálogo propuesto**: `{ specialtyId, centro, kind, serviceId, agendaIds?, serviceNameMatch? }`. El Function resuelve `agendas.filter(specialties ∋ specialtyId && services ∋ serviceId)`; si vacío → override; si sigue vacío → 503 `catalog_mismatch`. `areaId` desaparece.

**Discovery (lo ejecuta el usuario con su token; nunca pegar el token en chats ni commits)**: `GET /agendas?all_schedules=true` redactando `professional_tax_id`, y `GET /agendas/{id}` con `service_id` 389741 vs 389742. Campos que deciden: `id`, `center_name/center_address`, `specialties`, forma completa de `services[]` y si sus `id` ∈ 389741..389748, si los huecos cambian por `service_id`, aceptación de `modality=presencial`. Guardar el resultado redactado en `openspec/changes/nubimed-api-booking/discovery/agendas.redacted.json`.

### Resultado del discovery (2026-11-24) — **H1 confirmada**

Fuente: `discovery/agendas.redacted.json` (`GET /agendas?all_schedules=true`, NIF redactado).

| Agenda (`schedule_id`) | Nombre | Sede | Primera visita (45 min) | Tratamientos (30 min) |
|---|---|---|---|---|
| `26912` (profesional 21022) | Dra. Jessica Tellechea | **El Vendrell** | 389742 (est.) · 389744 (tric.) | 389746 (est.) · 389748 (tric.) |
| `29537` (profesional 23184) | Dra. Jessica Tellechea (BCN) | **Barcelona** | 389741 (est.) · 389743 (tric.) | 389745 (est.) · 389747 (tric.) |

- `services[].id` = los 8 `clinica_tratamiento_id` del catálogo actual; `speciality_id` 3 / 386; `modality: "presencial"` en todos.
- La sede la define la **agenda**. Diseño simplificado: el catálogo guarda `agendaId` por centro (`barcelona → 29537`, `el-vendrell → 26912`); **no** hace falta resolver `GET /agendas` en runtime (menos cuota). `GET /agendas` queda, como mucho, para un health-check.
- Ambas agendas reportan `center_address: "Av central 4, 43820 Calafell"` (probablemente fiscal): no usar para la UI; las direcciones visibles salen de `src/i18n/clinic-locations.ts`. Riesgo menor: Nubimed podría usarla en emails de confirmación.
- `accepted_visit_type`: El Vendrell `private_only`, Barcelona `private_and_insurance` (sin impacto: no se gestionan mutuas).

## 3. Arquitectura (BFF)

- `GET /api/booking/availability?specialty&centro&kind&from&to` → valida contra catálogo (sin ids crudos del cliente), resuelve agendas, N × `GET /agendas/{id}` (`modality=presencial`), responde `{ days: { "YYYY-MM-DD": [{ iso, scheduleIds }] } }` agrupado en Madrid. Reemplaza `fetchDayStrings` + `fetchSlots`.
- `POST /api/booking/request` (JSON) → valida, verifica Turnstile, llama `POST /cita_peticiones` inyectando `clinica_id`, `speciality_id`, `service_id`, `schedule_id` desde catálogo/disponibilidad. Responde `{ ok: true }` sin devolver PII.
- `GET /api/booking/health` opcional (200/503 de config).
- La isla hace `fetch` same-origin sin cookies; desaparecen bootstrap, `csrfRef`, `bootLoading`, `gateUrl`.
- **Caché**: Cache API recomendada (cero deps; por colo; verificar en `*.pages.dev` y dominio propio) + micro-caché en memoria opcional. `/agendas` TTL 10 min; disponibilidad TTL 60 s por `(agendaId, serviceId, from, to)`. Si Cache API no funciona → degradar sin caché (riesgo 429). KV descartado por sobredimensionado.
- **Timeouts**: `AbortSignal.timeout(8000)` por upstream; `Promise.allSettled` en disponibilidad; un reintento solo en GET ante 5xx/timeout; **nunca** reintentar el POST.

| Upstream | Respuesta nuestra | UX |
|---|---|---|
| 429 | 503 + `Retry-After`, `{code:'busy'}` | "Demasiadas solicitudes, reinténtalo en un minuto" |
| 422 | 422 `{code:'invalid', fields}` (solo nombres) | Marcar campos |
| 400 | 400 `{code:'invalid'}` | `submitFailed` |
| 401/403 | 502 `{code:'config'}` + log sin PII | `submitFailed` + WhatsApp/teléfono |
| 404 | 409 `{code:'slot_unavailable'}` | "Esa hora ya no está disponible" |
| 5xx/timeout | 502 `{code:'upstream'}` | `networkError` + reintentar |

Nunca reenviar el body de error de Nubimed al navegador.

## 4. Antiabuso

- **Turnstile**: `PUBLIC_TURNSTILE_SITE_KEY` (pública) + `TURNSTILE_SECRET_KEY` (secret); siteverify en el Function con `remoteip` (`CF-Connecting-IP`). Token de un solo uso (~5 min). Modo managed/invisible, ejecutado al abrir el modal de confirmación; widget visible como fallback.
- **Honeypot**: campo oculto; si viene relleno → 200 simulado sin llamar a Nubimed.
- **Tiempo mínimo** (opcional): timestamp firmado con HMAC.
- **Rate limit por IP**: Pages no lo trae nativo. Regla WAF/Rate Limiting de Cloudflare si el plan lo permite; contador en Cache API solo mitiga (por colo, no atómico).
- **Validación**: nombre/apellidos ≤ 80, `comments` ≤ 500, teléfono 6-15 dígitos, prefijo en lista, email razonable, `requested_time` debe existir en la disponibilidad real.
- **Origen**: `Origin` / `Sec-Fetch-Site: same-origin` en el POST.
- **Logs**: nunca body, PII ni errores de Nubimed.
- **Dev**: claves de prueba públicas de Turnstile en `.dev.vars` (verificar en la documentación vigente).

## 5. Inventario de código

**Borrar**: `parse-widget.ts`, `parse-new-booking-html.ts`, `build-new-url.ts`, `booking-submit-merge.ts`, `nubimed-portal-submit-fields.ts`, `recaptcha.ts`; `functions/__nubimed-proxy/[[path]].ts`; proxy Vite del portal en `astro.config.mjs`; `PUBLIC_NUBIMED_*` de `env.d.ts`; `BootstrapSession` y `'gate_blocked'` en `types.ts`; `Disallow: /__nubimed-proxy/` en `robots.txt.ts` (→ `/api/booking/`).

**Reescribir**: `client.ts` como cliente mínimo de `/api/booking/*`.

**Conservar**: UI/steps de `BookingFlow.tsx`, i18n, `booking-flow.css`, `normalize-huecos.ts` (`normalizeSlotsJson`), `horizon.ts`, catálogo (labels/detalles), `phonePrefixSelectOptions`.

**Cambiar en `BookingFlow.tsx`**:
- Quitar `nubimedBaseUrl`, `portalFallbackUrl`, `clinicaIdFromEnv` (l. 51-74), bootstrap/gate (l. 216-219, 238-247, 329-364, 854-887); horizonte constante 91 días.
- Fusionar `loadDays`/`loadSlots` (l. 366-411, 473-519) en una carga de rango.
- Al elegir hora → `details` directo (sin `/new`, sin `detailsLoading`).
- Eliminar pestaña `returning` (l. 299-306, 744-758, 1271-1304).
- `onFinalize` → POST JSON `{ specialty, centro, kind, requested_time, schedule_id, patient, comments, consent, turnstileToken, hp }`, errores por `code`.
- Bloque reCAPTCHA (l. 1462-1475) → widget Turnstile + aviso.
- Paso `details`: nombre, apellidos, prefijo + teléfono, email, **`comments`** (textarea nuevo).
- **Bug latente**: `summaryTimeLabel` (l. 140-163) formatea sin `timeZone` → usar `CLINIC_TIMEZONE`.
- Copy de éxito/confirmación (4 locales): "Hemos recibido tu solicitud… **La clínica la confirmará**; la hora no está reservada hasta entonces."
- i18n a retirar: `loadingBootstrap`, `gateBlocked`, `openPortal`, `loadingConfirmPage`, `recaptcha*`, `modeReturningPatient`, `modeNewPatient`, `fieldDni`, `fieldBirthDate`, `patientHadVisitBefore`, referencias al "portal oficial". Añadir: `fieldComments`, `turnstileFailed`, `slotUnavailable`, `busy`, aviso Turnstile, copy de solicitud.
- `[segment].astro`: inyectar `PUBLIC_TURNSTILE_SITE_KEY`.

## 6. Desarrollo local

| Opción | Cómo | Pros | Contras |
|---|---|---|---|
| A | `npm run build` + `wrangler pages dev dist` con `.dev.vars` | Idéntico a producción | Rebuild por cambio de UI |
| B | `astro dev` + `wrangler pages dev --port 8788` + proxy Vite `/api/booking` → 8788 | HMR + Function real | Dos procesos |
| C | `wrangler pages dev -- npx astro dev` | Un comando, HMR | Menos documentado; validar |

**Recomendado**: B (o C) para trabajar, A para verificación final. El único proxy dev que queda en `astro.config.mjs` apunta a la Function local.

| Nombre | Tipo | Dónde |
|---|---|---|
| `NUBIMED_API_EMAIL` | secret | Pages runtime / `.dev.vars` |
| `NUBIMED_API_TOKEN` | secret | idem |
| `NUBIMED_CLINIC_ID` (`1212`) | variable | idem |
| `TURNSTILE_SECRET_KEY` | secret | idem |
| `PUBLIC_TURNSTILE_SITE_KEY` | pública | build env Cloudflare + `.env` |
| `NUBIMED_API_BASE` (opcional) | variable | tests/mock |

Añadir `.dev.vars` y `.wrangler/` a `.gitignore` **antes** de crear el archivo; subir `.dev.vars.example` sin valores. Retirar `PUBLIC_NUBIMED_CLINICA_ID`/`_VENDOR_ORIGIN`/`_PROXY_URL`/`_PORTAL_NEW_URL`.

## 7. Legal / RGPD

- Responsable (clínica) → encargado (Nubimed) sin cambios; el Function transporta datos sin almacenarlos ni registrarlos; Cloudflare como proveedor de infraestructura y de Turnstile → mencionarlo en la política (decisión legal, "Ask first").
- `booking-nubimed/i18n.ts`: textos `recaptcha*` (l. 173-177, 260-264, 347-351, 434-438) → aviso Turnstile/Cloudflare; `bookingLegalSummaryBody` añade Cloudflare; revisar `gateBlocked`, `submitFailed`.
- Páginas con reCAPTCHA (4 locales): `legal-content/privacy.ts` (l. 34, 68, 134, 168, 234, 268, 334, 368), `legal-content/cookies.ts` (l. 42, 49, 65, 113, 120, 136, 184, 191, 207, 255, 262, 278), `cookie-consent-strings.ts` (l. 25, 33, 46, 54, 67, 75, 88, 96). Verificar qué cookie/almacenamiento usa Turnstile antes de redactar. Si no queda reCAPTCHA en el sitio, eliminar las menciones a Google.
- `comments` puede contener **datos de salud** (art. 9 RGPD): aviso en el textarea y nunca registrarlo.

## 8. Drift de spec y docs

| REQ | Tras este cambio |
|---|---|
| REQ-3 | Catálogo por `serviceId`/`agendaIds`/`specialtyId` |
| REQ-7 | Una llamada de rango con caché |
| REQ-9 | `POST /api/booking/request` → `POST /cita_peticiones` (API) |
| REQ-11 | BFF con secret (reemplaza proxy) |
| REQ-12 | Reforzar secretos de runtime |
| REQ-13 | reCAPTCHA → Turnstile |
| REQ-16 | Sin "paciente registrado"; campos de petición |
| REQ-20 | Eliminar (dimensión `area`) |
| REQ-21 | Reemplazar por requisitos del BFF |
| REQ-23 | Reescribir: petición real de prueba que aparezca y se anule |
| Nuevos | Antiabuso, errores/429, caché, copy de solicitud |

Docs: `AGENTS.md` (l. 36, 45, 46, 93, 116, 133), `docs/stack-and-deployment-context.md` (l. 21, 36-37, 63-72), `README.md` (l. 124, 129-130), `docs/site-architecture.md`, `.env.example`.

## 9. Opciones consideradas

| Enfoque | Pros | Contras |
|---|---|---|
| **A. BFF específico (recomendado)** | Secret protegido, superficie mínima, validación contra catálogo, UI casi intacta | Sin "Ya registrado"; depende del discovery |
| B. Proxy fino a la API | Menos servidor | Expone la API, ids arbitrarios del cliente, cuota abusable |
| C. Scraping + parche reCAPTCHA | Cero UI | Inviable: Nubimed no autoriza el dominio |
| D. `POST /citas` | Sin paso manual | Exige NIF; descartada por el usuario |

## 10. Enfoque recomendado

1. Discovery → fixture redactado → fijar catálogo.
2. BFF `functions/api/booking/` (tipos locales, Cache API, Turnstile, validación, mapeo de errores); módulos puros en `src/features/booking-nubimed/` importados desde `functions/`.
3. Refactor del data layer de `BookingFlow` manteniendo la UI.
4. i18n, legal y docs/spec.
5. Rollout detrás de `bookingPublic` (hoy `true` en main); verificación real con petición de prueba + `POST …/anular`.
6. Borrar scraping y proxy en la misma PR.

Runner de tests: el repo no tiene; decidir si se introduce `node --test` (cero deps) para funciones puras.

## 11. Riesgos (priorizados)

1. Mapeo incierto (H1-H4) → discovery antes del design.
2. Cuota compartida 600/10 min → Cache API, Turnstile, WAF.
3. Cache API no garantizada en el dominio final → verificar en preview.
4. Contrato condicional (email/`comments` obligatorios) → primera señal sería un 422.
5. Zona horaria → enviar `requested_time` tal cual de la API; arreglar `summaryTimeLabel`.
6. Datos de salud en `comments`.
7. Pérdida de "Ya registrado" (cambio de producto).
8. `.dev.vars` fuera de `.gitignore` (riesgo de commit accidental de secretos).
9. Turnstile bloqueado (adblock, redes corporativas) → fallback a WhatsApp/teléfono.
10. Doble envío → bloquear botón; token de un solo uso.
11. Spec desincronizado → sincronizar/archivar `reenable-nubimed-booking` antes del delta.
12. Informativo: bloqueos de IPs de Cloudflare en España durante LaLiga.

## 12. Preguntas abiertas (default recomendado)

1. Resultado del discovery → bloquea el design.
2. ¿Email/`comments` obligatorios en peticiones? → email obligatorio, `comments` opcional; confirmar con 422.
2b. **Autoaceptación (dato del usuario, 2026-11-24)**: la clínica tiene configurado en Nubimed que las peticiones se **autoacepten**. Pendiente verificar si la respuesta de `POST /cita_peticiones` ya refleja la aceptación (`assigned_time` / `state` ≠ `pendiente`) o si es asíncrona. Diseño: el copy de éxito depende de la respuesta → "cita confirmada" si hay `assigned_time` o estado aceptado; "solicitud recibida, confirmación por email" si vuelve `pendiente`. No hardcodear "confirmada" (si se desactiva la autoaceptación en Nubimed, la web mentiría).
3. ¿La clínica ve hueco y servicio de la petición? → sí; verificar en el panel y anular.
4. ¿`GET /agendas/{id}` excluye huecos ocupados? → asumir sí, confirmar.
5. Cache API en dominio final → usar y validar en preview.
6. Rate limit por IP → regla WAF si el plan lo permite + Turnstile.
7. Texto legal / DPA con Cloudflare → actualizar y validar antes del go-live.
8. ¿Runner de tests? → `node --test` sin deps para funciones puras.
9. `bookingPublic` durante el cambio → `true` en main; rollout condicionado a la petición de prueba.
10. Dev → B, con A para verificación final.
11. `modality` → fijo `presencial`; verificar en discovery.
