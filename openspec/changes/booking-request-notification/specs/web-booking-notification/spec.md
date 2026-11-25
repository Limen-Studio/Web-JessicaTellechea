# Web booking notification — Specification

**Capability:** `web-booking-notification` (NUEVA, spec completo). Cambio: `booking-request-notification`.

> **Nota de baseline:** la capability `web-booking-bff` aún **no** está archivada en `openspec/specs/`; su spec vive en `openspec/changes/nubimed-api-booking/specs/web-booking-bff/spec.md`. Este documento referencia sus requisitos por id (REQ-BFF-2, 6, 8, 9, 10, 11) y **no** los modifica.

## Purpose

Avisar por email a la doctora cuando el BFF crea una petición de cita en Nubimed. Nubimed solo autoacepta a pacientes existentes y su script de email no se dispara para peticiones creadas por API; este aviso evita que las peticiones pendientes pasen inadvertidas. El aviso es un efecto lateral **opcional y asíncrono**: nunca altera la respuesta al paciente ni el flujo de booking. Palabras clave (RFC 2119): **SHALL** / **SHALL NOT**, **SHOULD**, **MAY**.

Proveedor: Cloudflare Email Sending REST API (beta), vía `fetch`, sin dependencias.

---

## Requirements

### REQ-NOTIFY-1 Disparo por resultado

El BFF **SHALL** programar una notificación cuando, en `POST /api/booking/request`, el `POST /cita_peticiones` upstream (REQ-BFF-8 paso 7) termine con:

- éxito con `status = 'received'` (REQ-BFF-6);
- éxito con `status = 'confirmed'` (REQ-BFF-6);
- resultado `unknown` (REQ-BFF-10: timeout, error de red o 5xx **tras enviar** el POST).

El BFF **SHALL NOT** notificar en: honeypot relleno, `invalid`, `forbidden`, `turnstile_failed`, `slot_unavailable`, `busy`, `config`, ni `upstream` (fallo previo al envío). La notificación **SHALL** programarse con `waitUntil` (asíncrona) y **SHALL NOT** retrasar ni condicionar la respuesta al paciente. La respuesta HTTP (código, cuerpo, cabeceras) **SHALL** ser idéntica con el email enviado, fallido o desactivado.

#### Scenario: Petición pendiente

- GIVEN Nubimed responde 200 con `state: 'pendiente'` (status `received`) y la notificación está configurada
- WHEN el BFF responde al paciente
- THEN **SHALL** haberse programado exactamente un envío vía `waitUntil`
- AND la respuesta **SHALL** ser `{ ok: true, status: 'received' }`

#### Scenario: Petición confirmada

- GIVEN Nubimed devuelve `assigned_time` no vacío (status `confirmed`)
- WHEN el BFF responde
- THEN **SHALL** programar un envío con el asunto de "confirmada"

#### Scenario: Resultado desconocido

- GIVEN el POST se envió y la conexión falla antes de recibir respuesta (502 `unknown`)
- WHEN el BFF responde
- THEN **SHALL** programar un envío con el asunto de "posible solicitud"
- AND la respuesta al cliente **SHALL** seguir siendo 502 `{ code: 'unknown' }`

#### Scenario: Honeypot

- GIVEN `website` no vacío
- WHEN el BFF lo procesa
- THEN **SHALL NOT** enviar ninguna notificación

#### Scenario: Salidas sin petición creada

- GIVEN la petición termina en `invalid`, `forbidden`, `turnstile_failed`, `slot_unavailable`, `busy`, `config` o `upstream`
- WHEN el BFF responde
- THEN **SHALL NOT** llamar al proveedor de email

#### Scenario: Respuesta idéntica ante fallo del email

- GIVEN el proveedor devuelve 500 o excede el timeout
- WHEN el BFF responde al paciente
- THEN la respuesta **SHALL** ser idéntica a la de un envío correcto

### REQ-NOTIFY-2 Configuración y desactivación silenciosa

El BFF **SHALL** leer del entorno de runtime (Pages Production/Preview; `.dev.vars` en local):

| Nombre | Tipo | Requerido |
|---|---|---|
| `BOOKING_NOTIFY_TO` | secret | Sí |
| `BOOKING_NOTIFY_FROM` | variable | Sí |
| `CF_ACCOUNT_ID` | variable | Sí |
| `CF_EMAIL_API_TOKEN` | secret | Sí |
| `NUBIMED_PANEL_URL` | variable | No |
| `BOOKING_NOTIFY_ON` | variable | No |

Si falta cualquiera de los cuatro requeridos (o están vacíos), o si están mal formados (`CF_ACCOUNT_ID` que no sea un identificador hexadecimal de 32 caracteres; `BOOKING_NOTIFY_TO` o `BOOKING_NOTIFY_FROM` que no tengan forma de email), la notificación **SHALL** quedar desactivada **silenciosamente**: sin llamada al proveedor, sin error visible y sin cambio en el booking. La ausencia de esta configuración **SHALL NOT** provocar el fallo cerrado de REQ-BFF-2 (503 `config`); la validación de configuración de REQ-BFF-2 **SHALL** seguir dependiendo únicamente de las variables de Nubimed y Turnstile. Ninguno de estos valores **SHALL** exponerse con prefijo `PUBLIC_*`, en respuestas, logs ni errores.

`BOOKING_NOTIFY_ON` es una lista separada por comas de estados entre `received`, `confirmed`, `unknown`; por defecto `received,confirmed,unknown`. Los tokens desconocidos **SHALL** ignorarse (con espacios recortados y sin distinguir mayúsculas). Un valor vacío o sin tokens válidos **SHALL** desactivar todos los disparos.

#### Scenario: Sin configuración

- GIVEN `CF_EMAIL_API_TOKEN` no definido y las variables de Nubimed correctas
- WHEN llega una petición válida que crea la petición
- THEN el BFF **SHALL** responder normalmente (no 503 `config`)
- AND **SHALL NOT** llamar al proveedor de email

#### Scenario: Filtro por estado

- GIVEN `BOOKING_NOTIFY_ON=received`
- WHEN la petición resulta `confirmed`
- THEN **SHALL NOT** enviarse email

#### Scenario: Tokens desconocidos

- GIVEN `BOOKING_NOTIFY_ON=received, foo ,UNKNOWN`
- WHEN se interpreta
- THEN **SHALL** activar `received` y `unknown` e ignorar `foo`

#### Scenario: Valor sin tokens válidos

- GIVEN `BOOKING_NOTIFY_ON` vacío
- WHEN se crea una petición
- THEN **SHALL NOT** enviarse email

### REQ-NOTIFY-3 Llamada al proveedor

El envío **SHALL** ser `POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/email/sending/send` con `Authorization: Bearer {CF_EMAIL_API_TOKEN}`, `Content-Type: application/json` y cuerpo `{ from, to: [BOOKING_NOTIFY_TO], subject, text, html }`. **SHALL** tener un timeout de ~5 s, **SHALL NOT** reintentarse, y **SHALL NOT** lanzar nunca una excepción hacia la ruta de la petición (todo error se captura). No **SHALL** incluir `reply_to`, `cc`, `bcc` ni adjuntos. El esquema exacto de `from` (cadena u objeto con nombre) **MAY** ajustarse tras la prueba real.

Ante respuesta no 2xx, error de red o timeout, el BFF **SHALL** emitir **una** línea de log genérica que contenga solo el endpoint y el estado HTTP o el literal `network` (coherente con REQ-BFF-11).

#### Scenario: Envío correcto

- GIVEN configuración completa y estado notificable
- WHEN se envía
- THEN **SHALL** hacerse un único `fetch` al endpoint con Bearer y cuerpo JSON con `from`, `to` (array de un elemento), `subject`, `text` y `html`

#### Scenario: Proveedor responde error

- GIVEN el proveedor responde 401 o 429
- WHEN el BFF lo procesa
- THEN **SHALL** registrar una línea con endpoint y estado únicamente
- AND **SHALL NOT** reintentar ni propagar el error

#### Scenario: Fallo de red o timeout

- GIVEN `fetch` lanza un error o excede ~5 s
- WHEN el BFF lo procesa
- THEN **SHALL** registrar una línea con el endpoint y `network`
- AND **SHALL NOT** lanzar excepción

#### Scenario: Token inválido no afecta al booking

- GIVEN `CF_EMAIL_API_TOKEN` inválido
- WHEN un paciente envía una petición válida
- THEN la petición **SHALL** crearse en Nubimed y el paciente **SHALL** ver el mismo resultado de siempre

### REQ-NOTIFY-4 Contenido del email

El email **SHALL** estar en español y llevar versión `text` y `html` simple, sin imágenes ni tracking. 

**Asunto** (sin PII del paciente; solo especialidad y centro legibles):

| Resultado | Asunto |
|---|---|
| `received` | `Nueva solicitud de cita (pendiente): {Especialidad} · {Centro}` |
| `confirmed` | `Cita confirmada automáticamente (sin acción): {Especialidad} · {Centro}` |
| `unknown` | `Posible solicitud de cita (verificar en Nubimed): {Especialidad} · {Centro}` |

**Cuerpo** (texto y HTML): nombre y apellidos, teléfono con prefijo, email, especialidad, centro, tipo de servicio, fecha y hora de la cita en `Europe/Madrid`, estado, una línea de acción acorde al estado (`received`: gestionar la petición; `confirmed`: sin acción requerida; `unknown`: verificar en Nubimed por si se creó o está duplicada) y el enlace al panel (REQ-NOTIFY-5).

Los `comments` del paciente **SHALL NOT** incluirse jamás; si existen, **MAY** añadirse solo la frase "El paciente dejó comentarios (ver en Nubimed)". Todo dato procedente del usuario **SHALL** escaparse en el HTML (`& < > " '`). El asunto **SHALL NOT** contener nombre, teléfono, email ni comentarios, ni caracteres de control/saltos de línea. Las etiquetas legibles (especialidad, centro, servicio) **SHALL** definirse en un módulo servidor puro, sin depender del catálogo del cliente.

#### Scenario: Asunto por estado sin PII

- GIVEN pacientes con nombre "Ana García" y teléfono "600123123"
- WHEN se construye el email para cada estado
- THEN los tres asuntos **SHALL** ser distintos entre sí y **SHALL NOT** contener "Ana", "García" ni "600123123"

#### Scenario: Cuerpo completo

- GIVEN una petición `received` con `requestedTime` `2026-12-01T10:30:00+01:00`
- WHEN se construye el cuerpo
- THEN **SHALL** incluir nombre y apellidos, `+prefijo teléfono`, email, especialidad, centro, servicio, la hora local de Madrid, el estado, la línea de acción y el enlace

#### Scenario: Comentarios excluidos

- GIVEN `comments: 'Tengo diabetes'`
- WHEN se construye el email
- THEN ni `subject`, ni `text`, ni `html` **SHALL** contener "diabetes"
- AND **MAY** contener "El paciente dejó comentarios (ver en Nubimed)"

#### Scenario: Escape HTML

- GIVEN `patient.name = '<script>alert(1)</script>'`
- WHEN se construye `html`
- THEN **SHALL** aparecer escapado (`&lt;script&gt;…`) y **SHALL NOT** aparecer `<script>`

#### Scenario: Sin reply_to

- GIVEN cualquier envío
- WHEN se inspecciona el cuerpo JSON enviado
- THEN **SHALL NOT** contener `reply_to`

### REQ-NOTIFY-5 Enlace al panel de Nubimed

El enlace **SHALL** ser, por defecto, `https://app.clinicaenlanube.com/agenda/cita_peticiones`. Si `NUBIMED_PANEL_URL` existe, **SHALL** usarse en su lugar siempre que sea `https:`; si no es `https:` o no es una URL válida, **SHALL** usarse el valor por defecto. Si contiene el marcador `{id}`, **SHALL** sustituirse únicamente por un id de petición que cumpla `^\d+$`; si no hay id válido, el enlace **SHALL** caer al valor por defecto (nunca dejar `{id}` literal ni insertar valores no validados). Sin `{id}`, el enlace se usa tal cual.

#### Scenario: Valor por defecto

- GIVEN `NUBIMED_PANEL_URL` no definido
- WHEN se construye el email
- THEN el enlace **SHALL** ser `https://app.clinicaenlanube.com/agenda/cita_peticiones`

#### Scenario: Sustitución de id

- GIVEN `NUBIMED_PANEL_URL=https://panel.example/p/{id}` y petición con id `12345`
- WHEN se construye el enlace
- THEN **SHALL** ser `https://panel.example/p/12345`

#### Scenario: Id no numérico

- GIVEN `NUBIMED_PANEL_URL` con `{id}` y un id `12a/../`
- WHEN se construye el enlace
- THEN **SHALL** usar el enlace por defecto y **SHALL NOT** incluir el id

#### Scenario: Esquema no permitido

- GIVEN `NUBIMED_PANEL_URL=http://panel.example/` o `javascript:alert(1)`
- WHEN se construye el enlace
- THEN **SHALL** usar el enlace por defecto

### REQ-NOTIFY-6 Id de la petición y privacidad

El BFF **SHALL** extraer el `id` de la petición de la respuesta upstream de `POST /cita_peticiones` únicamente en el servidor y solo para construir el enlace (REQ-NOTIFY-5). Ese id **SHALL NOT** devolverse al cliente (coherente con REQ-BFF-6) ni escribirse en logs. Si el id no está disponible (incluido el caso `unknown`), la notificación **SHALL** enviarse igualmente con el enlace por defecto.

#### Scenario: Id interno

- GIVEN Nubimed responde con `id: 987`
- WHEN el BFF responde al paciente
- THEN el cuerpo **SHALL NOT** contener `987` ni campo `id`
- AND ningún log **SHALL** contenerlo

#### Scenario: Sin id

- GIVEN resultado `unknown` (sin cuerpo)
- WHEN se envía la notificación
- THEN **SHALL** enviarse con el enlace por defecto

### REQ-NOTIFY-7 Sin PII ni secretos en logs

La notificación **SHALL** respetar REQ-BFF-11: **SHALL NOT** registrar destinatario, remitente, asunto, cuerpo, datos del paciente, id de petición, token, ni el cuerpo de respuesta del proveedor. Los únicos logs permitidos son los de REQ-NOTIFY-3 (endpoint y estado/`network`).

#### Scenario: Inspección de logs

- GIVEN envíos correctos y fallidos con datos personales
- WHEN se inspecciona toda la salida de logs
- THEN **SHALL NOT** aparecer ningún dato personal, dirección de email, id de petición ni secreto

### REQ-NOTIFY-8 Aislamiento y sin dependencias

La integración **SHALL** implementarse con `fetch` y sin dependencias nuevas; el proveedor **SHALL** estar aislado en un módulo propio (intercambiable) y la construcción de contenido **SHALL** ser una función pura sin I/O. El comportamiento de REQ-BFF-8 (orden de comprobaciones), REQ-BFF-9 (sin reintento del POST) y REQ-BFF-10 (mapeo de errores) **SHALL** permanecer inalterado, incluida la ausencia de nuevos subrequests previos a la respuesta.

#### Scenario: Orden de comprobaciones intacto

- GIVEN cualquier petición
- WHEN se procesa
- THEN la notificación **SHALL** ocurrir solo después del paso 7 de REQ-BFF-8

---

## Criterios de aceptación manual

1. Con la configuración cargada en Pages (Preview/Production), crear una petición real como paciente nuevo: el Gmail de la doctora **SHALL** recibir el email "pendiente" en ~1 min con datos correctos y enlace al panel.
2. Revisar la carpeta de spam; si cae allí, ajustar filtro/contacto en Gmail.
3. Los asuntos de `confirmed` y `unknown` **SHALL** ser distinguibles del de `received`.
4. Ni el asunto ni los logs de Pages **SHALL** contener PII.
5. Con `CF_EMAIL_API_TOKEN` inválido, el booking **SHALL** funcionar igual y el paciente ver la misma pantalla de éxito.
6. Confirmar el esquema de `from` aceptado por la API.
