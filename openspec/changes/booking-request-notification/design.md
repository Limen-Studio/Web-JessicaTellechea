# Design: Aviso por email a la doctora al crearse una petición de cita

## Contexto

Proposal y exploración cerradas: Cloudflare Email Sending REST vía `fetch`, cero deps, `waitUntil`, sin comentarios ni PII en asunto, config opcional que **nunca** provoca fail-closed (REQ-BFF-2) ni logs con PII (REQ-BFF-11). El patrón a seguir es el del BFF: lógica pura testeable + I/O con `fetch`/`waitUntil` inyectados (`UpstreamDeps`).

## Architecture Decisions

### AD-1: Dos módulos — contenido puro + envío I/O

**Decision.**

| Archivo | Rol |
|---|---|
| `functions/_lib/notification-content.ts` | Puro. `buildNotification(input) → { subject, text, html }`, `resolvePanelLink(template, id?)`, `escapeHtml`, labels ES locales |
| `functions/_lib/notify.ts` | I/O. `readNotifyConfig(env)`, `sendNotification(content, cfg, fetchFn, timeoutMs = 5000) → Promise<boolean>`, `scheduleBookingNotification(env, deps, event)` |

Labels locales: `{3: 'Medicina estética', 386: 'Tricología'}`, `{barcelona: 'Barcelona', 'el-vendrell': 'El Vendrell'}`, `{firstVisit: 'Primera visita', treatments: 'Tratamientos'}`. Fecha: `todayYmdMadrid` + `ymdToDdMmYyyy` (`horizon.ts`) y `formatSlotTime` (`agenda-hours.ts`), más un `Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: CLINIC_TIMEZONE })` local → `martes 2/12/2026, 09:30 (hora de Madrid)`.

**Rationale.** `config.ts`/`clinic-locations.ts` arrastran `import.meta.env` e imports sin extensión: no se pueden importar desde Functions ni `node --test`. `horizon.ts`/`agenda-hours.ts` sí (ya los usa el BFF). Proveedor beta aislado en un solo archivo.

**Alternatives.** Labels en `catalog.ts`: rompe su regla "ids only, no labels". Un único módulo: mezcla TDD puro con I/O.

### AD-2: Punto de enganche en `handleRequest`

**Decision.** Solo el paso 7 cambia:

```ts
const created = await createPeticion(req, config, deps);
if (created.ok) {
	scheduleBookingNotification(env, deps, { status: created.status, req, peticionId: created.peticionId });
	return json(200, { ok: true, status: created.status });
}
if (created.error.code === 'unknown') scheduleBookingNotification(env, deps, { status: 'unknown', req });
return mappedErrorResponse(created.error);
```

`scheduleBookingNotification` es **síncrona, `void`, envuelta en try/catch**: lee config (null → return), filtra por `notifyOn`, construye contenido y llama `deps.waitUntil(sendNotification(...))`. El handler nunca espera el envío. `req` (validado) y `peticionId` solo viajan a `notify`; la respuesta sigue siendo `{ ok, status }`. Honeypot, validación, config, Turnstile, 409, `busy`, `invalid`, `config`, `upstream` retornan antes o caen fuera de ambas ramas.

**Rationale.** Diff mínimo en el handler; toda la política (config, filtro, fallos) vive en `notify.ts`.

**Alternatives.** Envolver el handler en `request.ts`: perdería `req` validado. `await` del envío: añade latencia y acopla el resultado.

### AD-3: `createPeticion` expone `peticionId?` interno

**Decision.** `PeticionResult = { ok: true; status: BookingStatus; peticionId?: number } | …`. Helper `parsePeticionId(body)`: acepta `id` number (`Number.isSafeInteger && > 0`) o string `^\d+$` convertible igual; cualquier otra cosa → `undefined`. Docstring actualizado: "el id es interno; nunca se devuelve al cliente ni se loguea". Los tests existentes (`{ ok: true, status }` con `deepEqual`) se adaptan si comparan el objeto completo.

### AD-4: Configuración — `readNotifyConfig`, independiente de `readConfig`

**Decision.**

```ts
type NotifyStatus = BookingStatus | 'unknown';
interface NotifyConfig { accountId: string; token: string; to: string; from: string; panelUrl: string; notifyOn: ReadonlySet<NotifyStatus> }
```

- `null` si: falta/está en blanco `CF_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN`, `BOOKING_NOTIFY_TO` o `BOOKING_NOTIFY_FROM`; `CF_ACCOUNT_ID` no cumple `^[0-9a-f]{32}$` (i); `TO`/`FROM` no cumplen `^[^\s@]+@[^\s@]+\.[^\s@]+$` (excluye CR/LF).
- `BOOKING_NOTIFY_ON`: ausente → `{received, confirmed, unknown}`; presente → split `,`, trim, lowercase, solo valores conocidos (`none` o vacío → set vacío = desactivado).
- `NUBIMED_PANEL_URL`: ausente/blanco → `DEFAULT_PANEL_URL = 'https://app.clinicaenlanube.com/agenda/cita_peticiones'`; presente → válido si `new URL(raw.replace('{id}', '0'))` es `https:`; inválido → default (no desactiva el aviso).
- `resolvePanelLink`: con `{id}` y `peticionId` válido → sustitución; con `{id}` sin id (p. ej. `unknown`) → `DEFAULT_PANEL_URL`; sin `{id}` → tal cual.
- `readConfig` no cambia.

**Rationale.** Un aviso mal configurado no puede tumbar el booking; una URL de panel inválida degrada al enlace conocido.

### AD-5: Petición al proveedor

**Decision.** `POST https://api.cloudflare.com/client/v4/accounts/{accountId}/email/sending/send`, headers `Authorization: Bearer {token}`, `Content-Type: application/json`; body `{ from, to: [to], subject, text, html }` con `from` como string plano. `signal: AbortSignal.timeout(timeoutMs)`. Éxito = `res.ok && json.success === true`. Cualquier otro caso (non-2xx, `success !== true`, JSON inválido, red/timeout) → `console.warn('booking-notify', status | 'network')` y `false`. **Nunca lanza.** Fallback si la prueba real rechaza el string o se quiere display-name: objeto `{ address, name: 'Reservas Dra. Tellechea' }` según el esquema que documente la API (un cambio local en `sendNotification`).

### AD-6: Contenido (BORRADOR, revisión del usuario)

| Estado | Asunto |
|---|---|
| `received` | `Nueva solicitud de cita (pendiente): {Especialidad} · {Centro}` |
| `confirmed` | `Cita confirmada automáticamente (sin acción): {Especialidad} · {Centro}` |
| `unknown` | `Posible solicitud de cita (verificar en Nubimed): {Especialidad} · {Centro}` |

Cuerpo (texto y HTML equivalentes, sin imágenes ni tracking): línea de acción por estado, paciente (nombre + apellidos), teléfono `+{prefijo} {teléfono}`, email, especialidad, centro, tipo, fecha/hora Madrid, y si hubo comentarios: "El paciente dejó comentarios (ver en Nubimed)". Enlace "Gestionar en el panel de Nubimed". En HTML **todo** valor dinámico (incluido el href) pasa por `escapeHtml` (`& < > " '`). Asunto solo con labels del catálogo (sin datos del paciente).

### AD-7: Tests (Strict TDD, `npm run test:unit`)

| Archivo | Casos RED→GREEN |
|---|---|
| `tests/unit/notification-content.test.ts` | 3 asuntos sin PII; escape de `<script>`/`"`/`&` en nombre; hora Madrid en invierno (+01:00) y verano (+02:00, DST); comentarios nunca presentes (solo indicador); `resolvePanelLink` con/sin `{id}` y sin id |
| `tests/unit/notify.test.ts` | `readNotifyConfig`: null por cada requerido ausente/blanco, account no hex, email inválido; `NOTIFY_ON` default/lista/`none`; panel URL default/https/`http:` → default. `sendNotification`: URL, headers, body, `signal` presente; non-2xx, `success:false`, red/`TimeoutError` → `false` sin throw; `console.warn` sin PII ni token |
| `tests/unit/booking-handlers.test.ts` | Con env de notify: email en `received`/`confirmed`/`unknown` (5xx y red tras enviar) vía `pending`; respeta `BOOKING_NOTIFY_ON`; **cero** envíos en honeypot, 400, 403, 409, 422, `busy`, `config`; respuesta idéntica con envío fallando o sin config; test REQ-BFF-11 ampliado (sin PII en consola) |
| `tests/unit/upstream.test.ts` | `peticionId` desde `id` number/string; ausente, `0`, negativo, `"12a"` → `undefined` |

Los tests existentes siguen verdes: el `ENV` actual no tiene vars de notify → no hay envío ni llamadas extra.

### AD-8: Tipos de env y docs

**Decision.** `BookingEnv` gana opcionales `CF_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN`, `BOOKING_NOTIFY_TO`, `BOOKING_NOTIFY_FROM`, `NUBIMED_PANEL_URL`, `BOOKING_NOTIFY_ON`. `.dev.vars.example`: bloque comentado "Optional: booking notification" con los seis nombres sin valores. Docs: lista de env en `AGENTS.md`, sección deploy de `README.md`, `docs/stack-and-deployment-context.md` (setup de Email Sending + rollback).

### AD-9: Rollout operativo (usuario)

1. Onboard `dratellechea.com` en Email Sending; comprobar que Email Routing sigue reenviando.
2. Verificar el Gmail como destination address.
3. Token con solo `Email Sending Write`.
4. Secrets/variables en Pages Production (y Preview para la prueba); redeploy.
5. Prueba real como paciente nuevo → email en ≤ ~1 min; revisar spam; confirmar esquema de `from`; anular la petición de prueba en Nubimed.

## Data / Contract Changes

- Nuevos: `functions/_lib/notification-content.ts`, `functions/_lib/notify.ts`, `tests/unit/notification-content.test.ts`, `tests/unit/notify.test.ts`.
- Modificados: `functions/_lib/handlers.ts` (paso 7), `functions/_lib/upstream.ts` (`PeticionResult.peticionId?`), `functions/_lib/env.ts` (tipos), `tests/unit/booking-handlers.test.ts`, `tests/unit/upstream.test.ts`, `.dev.vars.example`, `AGENTS.md`, `README.md`, `docs/stack-and-deployment-context.md`.
- Contrato HTTP público: **sin cambios**.

## Rollout / Rollback

- Rollout: AD-9. Merge seguro sin secrets (feature apagada).
- Rollback: borrar `CF_EMAIL_API_TOKEN` (o `BOOKING_NOTIFY_ON=none`) + redeploy; `git revert` si afecta al booking; revocar el token ante sospecha de fuga.

## Open Questions

- [ ] Copy de asuntos/cuerpo (AD-6): validación del usuario.
- [ ] Esquema de `from` (string vs objeto con nombre): se cierra en la prueba real.
- [ ] Legal: ¿enumerar Cloudflare (hosting + email) en `privacy.ts`? Ask first; no bloquea.
- [ ] `strict_tdd: false` en `openspec/config.yaml` vs TDD de `AGENTS.md`: se sigue `AGENTS.md`.
