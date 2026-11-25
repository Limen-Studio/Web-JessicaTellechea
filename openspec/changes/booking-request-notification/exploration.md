# Exploración: booking-request-notification

**Fecha**: 2026-11-25 · **Fase**: sdd-explore · **Store**: openspec · **Siguiente**: sdd-propose

## Contexto (decisiones del usuario)

- El booking crea **peticiones de cita** (`POST /cita_peticiones`) desde `functions/_lib/handlers.ts` (`handleRequest`).
- Prueba real: Nubimed **autoacepta solo a pacientes existentes**; los **nuevos quedan pendientes** y la doctora los gestiona a mano. El script de email de Nubimed **no se dispara** para peticiones creadas por API.
- Decisión: **no pedir DNI ni fecha de nacimiento**. Al crearse una petición, el BFF envía un **aviso instantáneo a la doctora** con los datos y un enlace a Nubimed. Canal: **email** (WhatsApp Business API = fase 2, fuera de alcance).
- DNI/fecha opcionales para confirmación inmediata = plan B diferido (fuera de alcance).

## Resumen ejecutivo

El binding `send_email` (`cloudflare:email`) **no está soportado en Pages Functions** (no figura en la lista de bindings de Pages). Recomendado: **REST API de Cloudflare Email Sending** (beta) vía `fetch` desde el BFF: cero dependencias, sin MIME manual, sin Worker auxiliar, sin proveedor nuevo. Se envía con `ctx.waitUntil` tras un `POST /cita_peticiones` exitoso, a una dirección verificada de la doctora (coste 0 a destinatarios verificados). Datos mínimos y enlace configurable al panel de Nubimed.

## 1. Envío de email desde Pages Functions

### 1.1 Binding `send_email`
- Docs de Email Workers: solo Workers; `EmailMessage` es API legacy (MIME crudo con `From` y `Message-ID`; ejemplo con dependencia `mimetext`).
- Bindings de Pages: lista KV, DO, R2, D1, Vectorize, Workers AI, Service bindings, Queues, Hyperdrive, Analytics Engine, env/secrets. **Email no aparece** → no recomendado (requeriría además `wrangler.toml`, que hoy no existe).

### 1.2 Cloudflare Email Sending REST API — recomendado
- Beta. `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send`, `Authorization: Bearer <token>` con permiso `Email Sending Write`.
- Body JSON: `from`, `to[]`, `subject`, `text` y/o `html`; opcionales `reply_to`, `cc`, `bcc`, `headers`, `attachments`. Respuesta `success` + `result { message_id, delivered, permanent_bounces, queued, suppressed_recipients }`; 429 con código 10004.
- Onboarding: Dashboard › Compute › Email Service › Email Sending › Onboard Domain; DNS en `cf-bounce` (MX, SPF, DKIM); DMARC `_dmarc` con `p=reject` **solo si no existía** → revisar SPF/DMARC si el dominio ya tiene correo (empezar con `p=none`). No requiere Email Routing.
- Precio: envíos a **destinatarios verificados de la cuenta gratis** en cualquier plan.
- Pendiente de confirmar con prueba real: esquema exacto de `from` (string vs objeto con nombre).

### 1.3 Comparativa

| Opción | Coste | Deps | RGPD | Veredicto |
|---|---|---|---|---|
| **CF Email Sending REST** | 0 (destinatario verificado) | 0 | Cloudflare ya es encargado (hosting) | **Recomendada** (riesgo: beta) |
| `send_email` en Pages | 0 | `mimetext` o MIME manual | Igual | Descartada (no documentado, legacy) |
| Worker aparte + Service Binding | 0 | sí | Igual | Sobreingeniería; solo si falla la REST |
| Resend/Postmark/Brevo | free tier | 0 | **Encargado nuevo** (DPA, transferencias, política) | Plan B |

Turnstile/plan de Pages: sin impacto (≈4 subrequests por petición, lejos del límite de 50 en Free).

## 2. Semántica de entrega
- En `handleRequest`, tras `createPeticion` correcto: `deps.waitUntil(notify(...))` (`UpstreamDeps` ya expone `waitUntil`).
- **Nunca** notificar en honeypot, validación, Turnstile, 409 ni errores upstream definidos.
- **Sí** notificar en `unknown` (timeout/red tras enviar o 5xx del POST) con asunto distinto: mejor falso positivo que perder una solicitud.
- La petición **nunca** se reintenta; el email tampoco en v1. Falla silenciosa para el paciente; timeout propio (~5 s, `AbortSignal.timeout`).
- Sin idempotencia/estado: un doble envío del paciente = dos peticiones y dos emails (igual que en Nubimed).

## 3. Contenido y privacidad
- **Asunto** sin PII, por estado: `Nueva solicitud de cita (pendiente): {Especialidad} · {Centro}` / `Cita confirmada automáticamente: …` / `Posible solicitud (verificar en Nubimed): …`.
- **Cuerpo** (texto + HTML simple, español, sin imágenes ni tracking): nombre y apellidos, teléfono con prefijo, email, especialidad, centro, tipo de servicio, fecha y hora (Europe/Madrid), estado, acción requerida, enlace a Nubimed.
- **Comentarios: NO** incluirlos (posibles datos de salud; el email queda en buzón/móvil). Como mucho "El paciente dejó comentarios (ver en Nubimed)".
- Escapar HTML en datos del usuario; asunto sin datos del paciente (evita PII en notificaciones push).
- Etiquetas legibles en un módulo puro, sin tocar `catalog.ts` del cliente.
- Config: `BOOKING_NOTIFY_TO` (buzón de la doctora), `BOOKING_NOTIFY_FROM` (p. ej. `reservas@dratellechea.com`), `CF_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN` (secret), `NUBIMED_PANEL_URL` (opcional), `BOOKING_NOTIFY_ON` (opcional, default `received,confirmed,unknown`).
- `reply_to` al email del paciente: no en v1.

## 4. Enlace a Nubimed
- No hay documentación pública del patrón de URL del panel. `NUBIMED_PANEL_URL` configurable; si contiene `{id}`, se sustituye por el `id` de la petición (solo `^\d+$`, host `https`); si no, se enlaza tal cual (lista). Sin variable → texto "Gestionar en el panel de Nubimed".
- `createPeticion` hoy descarta el cuerpo: añadir `peticionId` interno (nunca devuelto al cliente ni logueado).

## 5. Estados a notificar
- `received`: siempre. `confirmed`: FYI con asunto distinto ("sin acción"). `unknown`: sí. Configurable con `BOOKING_NOTIFY_ON`.

## 6. Inventario de código
- `functions/_lib/handlers.ts` (l. 112-114): `waitUntil(notify(...))` tras éxito y en `unknown`.
- `functions/_lib/upstream.ts`: `PeticionResult` ok + `peticionId?`.
- **Nuevo** `functions/_lib/notification-content.ts` (puro, TDD): `buildNotification(input) → { subject, text, html }`.
- **Nuevo** `functions/_lib/notify.ts`: `readNotifyConfig(env)` (null si faltan vars) + `sendNotification(content, cfg, fetch)` (timeout, nunca lanza).
- `functions/_lib/env.ts`: campos opcionales; **`readConfig` no cambia** (notificación opcional, degrada).
- Tests: `notification-content.test.ts`, `notify.test.ts`, ampliar `booking-handlers.test.ts` y `upstream.test.ts`; sin PII en logs/respuestas.
- Docs: `AGENTS.md`, README, doc de stack, `.dev.vars.example`.

## 7. Legal
- Mismo responsable y finalidad; con Cloudflare Email Sending no hay tercero nuevo. `privacy.ts` (apartado Encargados) hoy solo menciona Nubimed: revisar si se enumera Cloudflare (requiere validación del usuario).
- Con Resend/Postmark/Brevo sí habría encargado nuevo y DPA.

## 8. Enfoque recomendado
1. Cloudflare Email Sending REST vía `fetch`, sin dependencias.
2. `notification-content.ts` (puro) + `notify.ts` (I/O inyectable), con TDD.
3. `waitUntil` tras éxito y en `unknown`.
4. Sin comentarios en el email; enlace configurable.
5. Config opcional: sin variables, el booking funciona igual.

## Riesgos (priorizados)
1. Email Sending en **beta** → aislar en `notify.ts` para cambiar de proveedor.
2. Token de cuenta: mínimo privilegio, nunca `PUBLIC_*`.
3. **DMARC/SPF**: el onboarding puede añadir `p=reject` y romper correo existente del dominio.
4. Fallo silencioso del email → solo log genérico sin PII.
5. Datos de salud → excluidos.
6. Destinatario no verificado → verificar antes del deploy.
7. Deliverability (remitente nuevo) → revisar spam.
8. Duplicados tras `unknown` → señalados en el asunto.
9. Patrón del panel desconocido → enlace genérico.
10. Subrequests (holgura amplia).
11. Inyección HTML/cabeceras → escape y asunto sin PII.

## Preguntas abiertas (default recomendado)
1. Proveedor → Cloudflare Email Sending REST (plan B: Resend / Worker).
2. Dirección de la doctora (`BOOKING_NOTIFY_TO`) → la indica y verifica el usuario. ¿Buzón en el dominio o externo (Gmail)?
3. Remitente → `reservas@dratellechea.com`; confirmar DNS en Cloudflare y qué correo existe hoy en el dominio (SPF/DMARC).
4. Comentarios → NO.
5. Notificar `unknown` → SÍ, asunto distinto.
6. Notificar `confirmed` → SÍ como FYI, configurable.
7. Patrón de URL del panel de Nubimed → ¿abre por `id` o solo lista?
8. `reply_to` → NO en v1.
9. Fallo del envío → log genérico sin PII, sin reintentos.
10. Texto legal (encargados) → validación del usuario.

## Respuestas del usuario y DNS verificado (2026-11-25)

- **Destinatario**: la doctora quiere los avisos en su **cuenta de Gmail** → `BOOKING_NOTIFY_TO` = su Gmail (secret); debe figurar como *destination address verificada* en Cloudflare (probablemente ya lo esté si Email Routing le reenvía correo).
- **Panel de Nubimed**: `https://app.clinicaenlanube.com/agenda/cita_peticiones` (lista de peticiones, sin `{id}`). Default en código, sobreescribible con `NUBIMED_PANEL_URL`.
- **DNS del dominio** (consultado con 1.1.1.1):
  - NS: `leanna.ns.cloudflare.com`, `lochlan.ns.cloudflare.com` → dominio gestionado en Cloudflare.
  - MX: `route1/2/3.mx.cloudflare.net` → **Cloudflare Email Routing** (sin buzón propio, sin Google Workspace).
  - SPF: `v=spf1 include:_spf.mx.cloudflare.net -all`.
  - DMARC: `v=DMARC1; p=quarantine; rua=…@dmarc-reports.cloudflare.net` → **ya existe**, el onboarding de Email Sending **no** añadirá `p=reject`.
  - `google-site-verification` presente (Search Console; no afecta al correo).
- **Impacto en riesgos**: el riesgo 3 (DMARC/SPF rompiendo correo existente) pasa a **bajo**: todo el correo del dominio es Cloudflare; Email Sending usa el subdominio `cf-bounce` para MX/SPF de rebote y firma DKIM del dominio (alineación DMARC por DKIM). Verificar tras el onboarding que el correo reenviado sigue llegando.
- Preguntas abiertas 2, 3 y 7 → **resueltas**.

## Fuentes
- https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
- https://developers.cloudflare.com/api/resources/email_sending/methods/send/
- https://developers.cloudflare.com/email-service/configuration/domains/
- https://developers.cloudflare.com/email-service/platform/pricing/
