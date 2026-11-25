# Tasks: Aviso por email a la doctora al crearse una petición de cita

Reglas del cambio: diff mínimo; cero dependencias nuevas; contrato HTTP público sin cambios; la config de notificación es opcional y **nunca** provoca 503 `config` (REQ-NOTIFY-2); nunca loggear PII, id de petición, token, destinatario ni cuerpo del proveedor (REQ-NOTIFY-7); `readConfig` no cambia.

**Strict TDD (AGENTS.md) para módulos puros/testeables**: cada módulo tiene una tarea RED (test que falla) seguida de su tarea GREEN (implementación mínima). Runner: `npm run test:unit` (`node --test`, strip-types, imports con extensión `.ts`, tests en `tests/unit/*.test.ts`). `fetch` y `waitUntil` se inyectan (`UpstreamDeps`).

**Comandos permitidos a los agentes**: `npm run check`, `npm run test:unit`, `npm run lint:encoding`. **`npm run build` NO lo ejecutan los agentes**: es un paso manual del usuario (Phase 6).

**Invariante por fase**: cada fase cierra con `npm run check` y `npm run test:unit` en verde (en la tarea RED el test falla a propósito).

**Copy BORRADOR (DRAFT)**: asuntos y cuerpo del email (AD-6). Se deja con el comentario `// DRAFT: pendiente de revisión del usuario` y se lista en el apply-progress.

## Mapa de paralelismo

| Fase | Depende de | Paralelizable con | Archivos |
|---|---|---|---|
| 1 `peticionId` en upstream | — | 2, 5.1 | `functions/_lib/upstream.ts`, `tests/unit/upstream.test.ts` |
| 2 `notification-content.ts` | — | 1, 5.1 | `functions/_lib/notification-content.ts`, `tests/unit/notification-content.test.ts` |
| 3 `notify.ts` | 2 (tipos/contenido), 5.1 (tipos env) | — | `functions/_lib/notify.ts`, `tests/unit/notify.test.ts` |
| 4 Hook en `handlers.ts` | 1, 3 | — | `functions/_lib/handlers.ts`, `tests/unit/booking-handlers.test.ts` |
| 5 Env + docs | 5.1: ninguna; 5.2-5.5: 4 (nombres finales) | 5.1 con 1/2; docs con 4 | `functions/_lib/env.ts`, `.dev.vars.example`, `AGENTS.md`, `README.md`, `docs/stack-and-deployment-context.md` |
| 6 Verificación manual | todas | — | — |

Notas: 5.1 (tipos opcionales en `env.ts`) es trivial y se adelanta para que `notify.ts` compile con `check`. Las fases 1 y 2 no comparten archivos. 3 y 4 son secuenciales (4 consume `scheduleBookingNotification`).

---

## Phase 1: `peticionId` interno en `upstream.ts` (AD-3, REQ-NOTIFY-6)

- [x] 1.1 RED: en `tests/unit/upstream.test.ts`, casos para `createPeticion`: `id` number válido (`987`) y string `"987"` → `peticionId: 987`; `id` ausente, `0`, negativo, `"12a"`, float, no seguro → `peticionId` `undefined`; `peticionId` presente en `received` y `confirmed`. Adaptar los `deepEqual` existentes de `{ ok: true, status }` si comparan el objeto completo. (REQ-NOTIFY-6)
- [x] 1.2 GREEN: en `functions/_lib/upstream.ts`, `PeticionResult` ok gana `peticionId?: number`; helper `parsePeticionId(body)` (`Number.isSafeInteger && > 0`, o string `^\d+$` con la misma condición). Docstring: "el id es interno; nunca se devuelve al cliente ni se loguea". `npm run test:unit` verde. (AD-3, REQ-NOTIFY-6)

## Phase 2: `notification-content.ts` puro (AD-1, AD-6, REQ-NOTIFY-4/5)

- [x] 2.1 RED: crear `tests/unit/notification-content.test.ts` con: los 3 asuntos exactos de la spec, distintos entre sí y sin PII ("Ana", "García", "600123123"); asunto sin saltos de línea/control; escape HTML de `<script>`, `"`, `&`, `'` en nombre y en href; fecha/hora Madrid en invierno (`+01:00`) y verano (`+02:00`, DST) con formato `martes 2/12/2026, 09:30 (hora de Madrid)`; `comments` nunca en `subject`/`text`/`html` (solo la frase indicadora cuando existen); cuerpo con nombre+apellidos, `+prefijo teléfono`, email, especialidad, centro, tipo, estado, línea de acción por estado y enlace; `resolvePanelLink` (default, con `{id}` e id válido, `{id}` sin id → default, id `12a/../` → default, sin `{id}` → tal cual). (REQ-NOTIFY-4, REQ-NOTIFY-5)
- [x] 2.2 GREEN: crear `functions/_lib/notification-content.ts` con `buildNotification(input) → { subject, text, html }`, `resolvePanelLink(template, id?)`, `escapeHtml`, `DEFAULT_PANEL_URL`, labels locales (`{3: 'Medicina estética', 386: 'Tricología'}`, centros `barcelona`/`el-vendrell`, tipos `firstVisit`/`treatments`); reutilizar `todayYmdMadrid`/`ymdToDdMmYyyy` (`horizon.ts`), `formatSlotTime` (`agenda-hours.ts`) y `Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: CLINIC_TIMEZONE })`. Sin imports de `config.ts`/`clinic-locations.ts`; imports con extensión `.ts`. Copy marcado DRAFT. (AD-1, AD-6, REQ-NOTIFY-4/5/8)

## Phase 3: `notify.ts` I/O (AD-4, AD-5, REQ-NOTIFY-2/3/7)

- [x] 3.1 RED (config): crear `tests/unit/notify.test.ts` para `readNotifyConfig`: `null` por cada requerido ausente o en blanco (`CF_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN`, `BOOKING_NOTIFY_TO`, `BOOKING_NOTIFY_FROM`); `CF_ACCOUNT_ID` no hex-32; `TO`/`FROM` sin forma de email o con CR/LF; `BOOKING_NOTIFY_ON` ausente → `{received, confirmed, unknown}`, `received, foo ,UNKNOWN` → `{received, unknown}`, vacío y `none` → set vacío; `NUBIMED_PANEL_URL` ausente/`http:`/`javascript:`/inválida → default, `https:` (con y sin `{id}`) → tal cual. (REQ-NOTIFY-2, REQ-NOTIFY-5)
- [x] 3.2 GREEN (config): crear `functions/_lib/notify.ts` con `NotifyStatus`, `NotifyConfig` y `readNotifyConfig(env)` independiente de `readConfig`. (AD-4, REQ-NOTIFY-2)
- [x] 3.3 RED (envío): en `tests/unit/notify.test.ts`, `sendNotification` con `fetch` inyectado: URL `https://api.cloudflare.com/client/v4/accounts/{id}/email/sending/send`, headers `Authorization: Bearer` y `Content-Type`, body `{ from, to: [to], subject, text, html }` sin `reply_to`/`cc`/`bcc`, `signal` presente; éxito = `res.ok && success === true`; non-2xx, `success:false`, JSON inválido, red y `TimeoutError` → `false` sin lanzar; exactamente una línea `console.warn` con solo endpoint y estado o `network`, sin token, emails, asunto, cuerpo ni id (espiar `console`). (REQ-NOTIFY-3, REQ-NOTIFY-7)
- [x] 3.4 GREEN (envío): `sendNotification(content, cfg, fetchFn, timeoutMs = 5000) → Promise<boolean>` con `AbortSignal.timeout`, sin reintentos, todo en try/catch. (AD-5, REQ-NOTIFY-3/7)
- [x] 3.5 RED (schedule): `scheduleBookingNotification(env, deps, event)`: sin config → no llama a `waitUntil` ni `fetch`; estado fuera de `notifyOn` → no envía; estado habilitado → exactamente un `waitUntil` con el envío; `peticionId` llega solo al enlace; errores internos (p. ej. `waitUntil` que lanza) se capturan y no se propagan; no espera el envío (síncrona, `void`). (REQ-NOTIFY-1, REQ-NOTIFY-2)
- [x] 3.6 GREEN (schedule): implementar `scheduleBookingNotification` (lee config, filtra por `notifyOn`, `buildNotification`, `deps.waitUntil(sendNotification(...))`, envuelta en try/catch). `npm run test:unit` y `npm run check` verdes. (AD-2, REQ-NOTIFY-1/8)

## Phase 4: Hook en `handlers.ts` (AD-2, REQ-NOTIFY-1/6/7/8)

- [x] 4.1 RED: en `tests/unit/booking-handlers.test.ts`, con env de notify añadido solo a los tests nuevos: email programado vía `waitUntil` en `received`, `confirmed` y `unknown` (5xx y red tras enviar) con el asunto correspondiente; respeta `BOOKING_NOTIFY_ON`; **cero** envíos en honeypot, 400, 403 (`forbidden`/`turnstile_failed`), 409, 422, `busy`, `config` y `upstream`; respuesta idéntica (código, cuerpo, cabeceras) con envío fallando, token inválido o sin config (y sin 503 `config`); cuerpo de respuesta sin `id` ni el valor del id; test REQ-BFF-11 ampliado: ninguna salida de consola contiene PII, emails, id ni token. Los tests existentes (ENV sin vars de notify) siguen verdes. (REQ-NOTIFY-1/2/6/7)
- [x] 4.2 GREEN: en `functions/_lib/handlers.ts` (paso 7, sin tocar el orden de REQ-BFF-8): si `created.ok` → `scheduleBookingNotification(env, deps, { status, req, peticionId })` y responder `{ ok: true, status }`; si `created.error.code === 'unknown'` → `scheduleBookingNotification(env, deps, { status: 'unknown', req })` y mapear el error como hasta ahora. `npm run test:unit` y `npm run check` verdes. (AD-2, REQ-NOTIFY-1/8)

## Phase 5: Env typing, ejemplo y docs (AD-8)

- [x] 5.1 `functions/_lib/env.ts`: añadir opcionales a `BookingEnv`: `CF_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN`, `BOOKING_NOTIFY_TO`, `BOOKING_NOTIFY_FROM`, `NUBIMED_PANEL_URL`, `BOOKING_NOTIFY_ON` (sin prefijo `PUBLIC_*`). `npm run check` verde. (REQ-NOTIFY-2)
- [x] 5.2 `.dev.vars.example`: bloque comentado "Optional: booking notification" con los seis nombres, **sin valores**. (AD-8, REQ-NOTIFY-2)
- [x] 5.3 `AGENTS.md`: añadir los seis nombres a la lista de env/secrets (cuáles son secret vs variable) y la regla "la notificación es opcional, nunca fail-closed ni loguea PII". (AD-8)
- [x] 5.4 `README.md` (sección deploy): configuración de Email Sending, secrets/variables en Pages y rollback (`BOOKING_NOTIFY_ON=none` o borrar `CF_EMAIL_API_TOKEN` + redeploy). (AD-8, AD-9)
- [x] 5.5 `docs/stack-and-deployment-context.md`: setup de Email Sending (beta), token `Email Sending Write`, destination address verificada, rollout y rollback. `npm run lint:encoding` verde. (AD-8, AD-9)

## Phase 6: Verificación manual (usuario; agentes NO ejecutan `npm run build`)

- [ ] 6.1 `npm run build` local en verde (manual del usuario).
- [ ] 6.2 Cloudflare: onboard de `dratellechea.com` en Email Sending (comprobar que Email Routing sigue reenviando); verificar el Gmail de la doctora como destination address; crear token con solo `Email Sending Write`. (AD-9)
- [ ] 6.3 Pages (Preview para la prueba y luego Production): cargar `CF_EMAIL_API_TOKEN` y `BOOKING_NOTIFY_TO` como secrets; `CF_ACCOUNT_ID`, `BOOKING_NOTIFY_FROM` (y opcionales) como variables; redeploy. (AD-9, REQ-NOTIFY-2)
- [ ] 6.4 Petición real como **paciente nuevo**: email "pendiente" en ~1 min con datos correctos y enlace al panel; revisar spam; anular la petición de prueba en Nubimed. (criterios 1-2)
- [ ] 6.5 Validar el esquema de `from` aceptado (string vs objeto con nombre; si rechaza, ajustar `sendNotification` según AD-5) y que los asuntos de `confirmed` y `unknown` son distinguibles. (criterios 3, 6)
- [ ] 6.6 Comprobar que logs de Pages y asuntos no contienen PII; con token inválido el booking funciona igual. (criterios 4-5, REQ-NOTIFY-7)
- [ ] 6.7 Rollback: `BOOKING_NOTIFY_ON=none` + redeploy no envía emails. (Rollout/Rollback)
- [ ] 6.8 Revisión del usuario del copy DRAFT (asuntos y cuerpo, AD-6).
- [ ] 6.9 Decisión legal (**Ask first**, no implementada aquí ni bloqueante): enumerar Cloudflare (hosting + email) en la política de privacidad (`privacy.ts`).
