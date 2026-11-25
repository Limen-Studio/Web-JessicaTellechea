# Proposal: Aviso por email a la doctora al crearse una petición de cita

## Intent

Nubimed solo autoacepta a pacientes existentes; las peticiones de pacientes nuevos quedan **pendientes** y su script de email **no se dispara** para peticiones creadas por API. La doctora no se entera a tiempo. Éxito = cada petición creada desde la web genera, en ~1 min, un email a su Gmail con los datos necesarios y un enlace al panel de Nubimed, sin afectar al booking.

## Decisiones del usuario (2026-11-25)

1. Canal: email vía **Cloudflare Email Sending REST API** (`fetch`, cero deps); `send_email` no está soportado en Pages.
2. Destino: Gmail de la doctora (`BOOKING_NOTIFY_TO`, destination address verificada). Remitente `reservas@dratellechea.com`.
3. DNS verificado: NS Cloudflare, Email Routing, SPF Cloudflare, DMARC `p=quarantine` existente → el onboarding no añade `p=reject`.
4. Enlace por defecto `https://app.clinicaenlanube.com/agenda/cita_peticiones`, sobreescribible con `NUBIMED_PANEL_URL` (`{id}` opcional, id `^\d+$`).
5. Sin comentarios (datos de salud), sin `reply_to`, sin reintento; notificar `received`, `confirmed` (FYI) y `unknown` (verificar) con asuntos distintos sin PII.

## Scope

### In Scope
- Módulo puro `notification-content.ts` (asunto/texto/HTML, escape, etiquetas) con TDD.
- Módulo I/O `notify.ts`: `readNotifyConfig(env)` (null si falta config) + `sendNotification` (timeout ~5 s, nunca lanza, log genérico sin PII).
- `handleRequest`: `waitUntil(notify)` tras `POST /cita_peticiones` exitoso y en `unknown`.
- `createPeticion` expone `peticionId` interno (nunca al cliente ni a logs).
- `BOOKING_NOTIFY_ON` configurable; docs y `.dev.vars.example`.

### Out of Scope
- WhatsApp (fase 2); DNI/fecha opcionales para confirmación inmediata (plan B); emails al paciente; reintentos/cola; idempotencia.

## Capabilities

### New Capabilities
- `web-booking-notification`: disparo por estado, contenido mínimo sin PII en asunto ni comentarios, config opcional, fallo silencioso, enlace al panel, no-logging.

### Modified Capabilities
- None.

**Justificación**: concern separado y aislado (proveedor beta intercambiable) y `web-booking-bff` **no existe** en `openspec/specs/` (el cambio `nubimed-api-booking` no está archivado; su spec vive en `openspec/changes/nubimed-api-booking/specs/web-booking-bff/spec.md`). Un delta sobre ese baseline no sincronizado sería frágil. La nueva spec **referencia** los resultados de REQ-BFF-6/8/10 y respeta REQ-BFF-2 (la config de notificación **no** provoca fail-closed) y REQ-BFF-11 (sin PII en logs).

## Approach

1. TDD de `notification-content.ts` (`buildNotification(input) → { subject, text, html }`).
2. `notify.ts` con `fetch` inyectable: `POST /accounts/{CF_ACCOUNT_ID}/email/sending/send`, Bearer `CF_EMAIL_API_TOKEN`, `AbortSignal.timeout`.
3. `upstream.ts`: `PeticionResult` ok + `peticionId?`.
4. `handlers.ts`: `deps.waitUntil(...)` solo en éxito/`unknown`; nunca en honeypot, validación, Turnstile, 409 ni errores upstream definidos. `readConfig` sin cambios.
5. Docs: `AGENTS.md`, `README.md`, `docs/stack-and-deployment-context.md`, `.dev.vars.example`.

## Affected Areas

| Area | Impact |
|------|--------|
| `functions/_lib/notification-content.ts`, `functions/_lib/notify.ts` (+ tests) | New |
| `functions/_lib/handlers.ts`, `upstream.ts`, `env.ts` (+ tests) | Modified |
| `AGENTS.md`, `README.md`, `docs/stack-and-deployment-context.md`, `.dev.vars.example` | Modified |
| `src/i18n/legal-content/privacy.ts` | Ask first (ver Open Questions) |

## Env / secrets (Pages Production; `.dev.vars` en local)

| Nombre | Tipo | Requerido |
|---|---|---|
| `CF_ACCOUNT_ID` | variable | Sí (para activar) |
| `CF_EMAIL_API_TOKEN` | secret (`Email Sending Write`) | Sí |
| `BOOKING_NOTIFY_TO` | secret (Gmail) | Sí |
| `BOOKING_NOTIFY_FROM` | variable (`reservas@dratellechea.com`) | Sí |
| `NUBIMED_PANEL_URL` | variable | No (default lista) |
| `BOOKING_NOTIFY_ON` | variable | No (default `received,confirmed,unknown`) |

Si falta cualquiera de los requeridos → notificación desactivada, booking intacto.

## Setup operativo (usuario)

1. Dashboard › Email Service › Email Sending › **Onboard Domain** `dratellechea.com`; comprobar que el correo reenviado por Email Routing sigue llegando.
2. Verificar el Gmail como **destination address**.
3. Crear API token con **solo** `Email Sending Write` sobre la cuenta.
4. Cargar las variables/secrets en Pages **Production** (y Preview para la prueba).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API en beta (cambios/caídas) | Med | Aislada en `notify.ts`; plan B Resend/Worker |
| Fuga/abuso del token | Low | Mínimo privilegio, secret, nunca `PUBLIC_*`; rotable |
| Gmail marca como spam (remitente nuevo) | Med | DKIM alineado; filtro/contacto en Gmail; revisar en prueba |
| Fallo silencioso del email | Med | Log genérico sin PII; panel de Nubimed sigue siendo la fuente |
| Duplicados/falsos positivos en `unknown` | Low | Asunto "verificar en Nubimed" |
| PII/datos de salud | Low | Sin comentarios ni PII en asunto; escape HTML; sin logs de body |
| `strict_tdd: false` en `openspec/config.yaml` vs TDD de `AGENTS.md` | Low | Seguir `AGENTS.md` (`npm run test:unit`) |

## Rollback Plan

1. **Sin deploy de código**: borrar `CF_EMAIL_API_TOKEN` (o `BOOKING_NOTIFY_TO`) en Pages → `readNotifyConfig` devuelve null y la feature queda apagada en el siguiente deploy/redeploy del entorno. Alternativa fina: `BOOKING_NOTIFY_ON` vacío.
2. `git revert <sha>` del merge si afecta al flujo de booking.
3. Revocar el token en Cloudflare ante sospecha de fuga.

## Dependencies

- Dominio onboarded en Email Sending, Gmail verificado, token creado (pasos de setup).

## Success Criteria

- [ ] Petición real `received` → la doctora recibe el email en ≤ ~1 min con datos correctos y enlace al panel.
- [ ] `confirmed` y `unknown` producen asuntos distintos.
- [ ] Sin PII en asunto ni logs; sin comentarios en el cuerpo.
- [ ] Con el envío fallando o sin config, el paciente ve el mismo resultado y la petición se crea.
- [ ] Tests unitarios y `npm run check` pasan.

## Open Questions

1. **Legal (Ask first)**: ¿enumerar Cloudflare como encargado (hosting + email) en `privacy.ts`? Requiere validación del usuario; no bloquea la implementación técnica.
2. Esquema exacto de `from` (string vs objeto con nombre) → confirmar en la prueba real.
