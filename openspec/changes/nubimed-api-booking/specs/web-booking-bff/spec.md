# Web booking BFF — Specification

**Capability:** `web-booking-bff` (NUEVA, spec completo). Cambio: `nubimed-api-booking`.

## Purpose

BFF same-origin en Cloudflare Pages Functions que expone `/api/booking/*`, guarda las credenciales de la API Nubimed como secretos de servidor, sirve disponibilidad con caché y crea **peticiones de cita** (`POST /cita_peticiones`) validando todo contra el catálogo. Palabras clave (RFC 2119): **SHALL** / **SHALL NOT**, **SHOULD**, **MAY**. El comportamiento del cliente está en `web-booking-nubimed-client`.

Upstream: `NUBIMED_API_BASE` (por defecto `https://api.clinicaenlanube.com/api/v1`), cabeceras `X-User-Email`, `X-User-Token`, `User-Agent: JT`. Cuota compartida 600 req / 10 min.

**Enum de códigos de error** (idéntico en `web-booking-nubimed-client`): `invalid`, `forbidden`, `turnstile_failed`, `slot_unavailable`, `busy`, `config`, `upstream`, `unknown`.

---

## Requirements

### REQ-BFF-1 Endpoints y cabeceras de respuesta

El BFF **SHALL** exponer `GET /api/booking/availability` y `POST /api/booking/request`; **MAY** exponer `GET /api/booking/health` (200 si hay configuración, 503 si falta; **SHALL NOT** llamar a Nubimed ni revelar valores). Otros métodos o rutas bajo `/api/booking/` **SHALL** responder 404/405 sin llamar a Nubimed. Toda respuesta **SHALL** ser JSON con `Cache-Control: no-store` y `X-Robots-Tag: noindex, nofollow`. Los errores **SHALL** tener la forma `{ ok: false, code, fields? }` con `code` del enum.

#### Scenario: Método no permitido

- GIVEN `DELETE /api/booking/request`
- WHEN el BFF lo procesa
- THEN **SHALL** responder 405 y no emitir llamadas a Nubimed

#### Scenario: Cabeceras de respuesta

- GIVEN cualquier respuesta del BFF
- WHEN se inspecciona
- THEN **SHALL** incluir `Cache-Control: no-store` y `X-Robots-Tag: noindex, nofollow`

### REQ-BFF-2 Secretos y configuración

`NUBIMED_API_EMAIL`, `NUBIMED_API_TOKEN`, `TURNSTILE_SECRET_KEY` y `NUBIMED_CLINIC_ID` **SHALL** leerse solo del entorno de runtime (Pages Production y Preview; `.dev.vars` en local). `NUBIMED_API_BASE`, si existe, **SHALL** ser `https:`. El BFF **SHALL** enviar `User-Agent: JT`, `Accept: application/json` y las cabeceras de autenticación en cada llamada a Nubimed, y **SHALL NOT** incluir secretos en respuestas, logs ni errores. Si falta cualquier valor requerido, **SHALL** fallar cerrado: 503 `{ code: 'config' }` sin llamar a Nubimed ni a Turnstile.

#### Scenario: Configuración ausente

- GIVEN `NUBIMED_API_TOKEN` no definido
- WHEN llega una petición válida
- THEN **SHALL** responder 503 `{ code: 'config' }` y no llamar a Nubimed

#### Scenario: Cabeceras upstream

- GIVEN una consulta de disponibilidad válida
- WHEN el BFF consulta a Nubimed
- THEN **SHALL** incluir `X-User-Email`, `X-User-Token` y `User-Agent: JT`
- AND esos valores **SHALL NOT** aparecer en la respuesta al navegador

### REQ-BFF-3 Validación contra catálogo

El BFF **SHALL** aceptar solo claves de catálogo (`specialty` ∈ {3, 386}, `centro` ∈ {`barcelona`, `el-vendrell`}, `kind` ∈ {`firstVisit`, `treatments`}) y **SHALL** resolver `agendaId` (`barcelona` 29537, `el-vendrell` 26912), `serviceId` y `speciality_id` desde el catálogo, inyectando `clinica_id`, `speciality_id`, `service_id` y `schedule_id` en la llamada upstream. Claves desconocidas, parámetros no reconocidos o ids crudos de vendor en query/cuerpo **SHALL** rechazarse con 400 `{ code: 'invalid' }` sin llamar a Nubimed. La modalidad **SHALL** ser fija `presencial`.

#### Scenario: Clave desconocida

- GIVEN `centro=madrid` en availability
- WHEN el BFF valida
- THEN **SHALL** responder 400 `{ code: 'invalid' }` sin llamada upstream

#### Scenario: Id crudo del cliente

- GIVEN un cuerpo de request con `schedule_id`
- WHEN el BFF valida
- THEN **SHALL** rechazarlo con 400 `invalid` y **SHALL NOT** usar ese valor

#### Scenario: Inyección desde catálogo

- GIVEN `specialty=386`, `centro=el-vendrell`, `kind=firstVisit`
- WHEN el BFF llama a Nubimed
- THEN **SHALL** usar `schedule_id=26912` y `service_id=389744`

### REQ-BFF-4 Disponibilidad (ventana fija del servidor)

`GET /api/booking/availability?specialty&centro&kind` **SHALL** calcular el rango en servidor: `from` = hoy en `Europe/Madrid`, `to` = `from` + 90 días (91 días). El BFF **SHALL NOT** aceptar `from`/`to` del cliente (su presencia **SHALL** tratarse como parámetro no reconocido, 400 `invalid`). Hará **una** consulta de rango a `GET /agendas/{agendaId}` (`start_date`, `end_date`, `service_id`, `modality=presencial`) y responderá 200 `{ ok: true, from, to, days: { 'YYYY-MM-DD': string[] } }` con las franjas agrupadas por día en `Europe/Madrid` y ordenadas, conservando cada ISO exactamente como lo devolvió Nubimed. **SHALL** descartar `user_ids` y metadatos.

#### Scenario: Agrupado en Madrid

- GIVEN una franja `2026-12-01T23:30:00+01:00`
- WHEN el BFF agrupa
- THEN **SHALL** quedar bajo `2026-12-01` y conservar el ISO original

#### Scenario: Rango fijado por el servidor

- GIVEN una llamada con `from=2020-01-01`
- WHEN el BFF valida
- THEN **SHALL** responder 400 `invalid` sin llamada upstream

#### Scenario: Sin huecos

- GIVEN Nubimed devuelve una lista vacía
- WHEN responde el BFF
- THEN **SHALL** responder 200 con `days` vacío

#### Scenario: Sin datos de profesionales

- GIVEN una respuesta 200
- WHEN se inspecciona
- THEN **SHALL NOT** contener `user_ids`, ids de agenda ni nombres de profesionales

### REQ-BFF-5 Caché y degradación

La disponibilidad **SHALL** cachearse con la Cache API con TTL de **60 s**, con clave por (agenda, servicio, `from`) sin PII, almacenando el JSON normalizado. Si la Cache API no está disponible o lanza error, el BFF **SHALL** degradar a consulta sin caché sin error visible. Las respuestas al navegador **SHALL** seguir siendo `no-store`. Los `POST` **SHALL NOT** cachearse. El BFF **SHALL NOT** llamar a `GET /agendas` (listado) en ninguna ruta.

#### Scenario: Acierto de caché

- GIVEN dos peticiones idénticas dentro de 60 s
- WHEN el BFF las procesa
- THEN solo la primera **SHALL** consultar a Nubimed

#### Scenario: Caché no operativa

- GIVEN la Cache API lanza error
- WHEN llega una petición de disponibilidad
- THEN **SHALL** responder normalmente consultando a Nubimed

### REQ-BFF-6 Petición de cita

`POST /api/booking/request` (JSON, ≤ 8 KB) **SHALL** aceptar `{ specialty, centro, kind, requestedTime, patient: { name, surname, phonePrefix, phone, email }, comments?, consent: true, turnstileToken, website? }`. Tras superar REQ-BFF-8, **SHALL** llamar a `POST /cita_peticiones` con `clinica_id`, `speciality_id`, `schedule_id`, `service_id`, `requested_time` (idéntico a `requestedTime`), `patient_name`, `patient_surname`, `patient_phone`, `patient_country_calling_code`, `patient_email`, `comments` (si existe) y `modality: 'presencial'`. `requestedTime` **SHALL** existir en la disponibilidad actual de esa agenda y servicio (re-check); si no, 409 `{ code: 'slot_unavailable' }` sin crear la petición.

Éxito: `{ ok: true, status }` con `status = 'confirmed'` **solo si** Nubimed devuelve un `assigned_time` no vacío **o** el estado de aceptación (`state === 'aceptada'`; valor exacto a confirmar en la prueba real); en cualquier otro caso (incluido `pendiente` o un estado de rechazo) `status = 'received'`. La respuesta **SHALL NOT** incluir el `id` de la petición, PII ni el cuerpo de Nubimed.

#### Scenario: Autoaceptada con hora asignada

- GIVEN Nubimed responde 200 con `assigned_time` no vacío
- WHEN responde el BFF
- THEN **SHALL** devolver `{ ok: true, status: 'confirmed' }`

#### Scenario: Pendiente

- GIVEN Nubimed responde 200 con `state: 'pendiente'` y sin `assigned_time`
- WHEN responde el BFF
- THEN **SHALL** devolver `{ ok: true, status: 'received' }`

#### Scenario: Estado no aceptado

- GIVEN Nubimed responde 200 con un estado distinto de `pendiente` y de aceptación (p. ej. rechazada) y sin `assigned_time`
- WHEN responde el BFF
- THEN **SHALL** devolver `status: 'received'` y **SHALL NOT** devolver `'confirmed'`

#### Scenario: Hora inexistente

- GIVEN `requestedTime` ausente de la disponibilidad de la agenda
- WHEN se envía la petición
- THEN **SHALL** responder 409 `{ code: 'slot_unavailable' }` sin `POST /cita_peticiones`

#### Scenario: Sin PII en la respuesta

- GIVEN una petición exitosa
- WHEN se inspecciona la respuesta
- THEN **SHALL NOT** contener nombre, teléfono, email, comentarios ni el `id` de Nubimed

### REQ-BFF-7 Límites de validación

El BFF **SHALL** rechazar con 400 `{ code: 'invalid', fields: [...] }` (solo nombres de campo propios) cuando: nombre o apellidos vacíos o > 80 caracteres tras `trim`; `phonePrefix` fuera de `^[1-9]\d{0,3}$`; teléfono fuera de 6–15 dígitos tras quitar espacios y guiones; email ausente, > 254 caracteres o con formato no razonable; `comments` > 500; `consent` distinto de `true`; `requestedTime` ausente o con formato inválido. Obligatorios por defecto: nombre, apellidos, prefijo, teléfono y email; `comments` es opcional. Un `Content-Type` distinto de `application/json` o JSON inválido **SHALL** dar 400 `invalid`; un cuerpo > 8 KB, 413 `invalid`.

#### Scenario: Comentarios largos

- GIVEN `comments` de 501 caracteres
- WHEN se valida
- THEN **SHALL** responder 400 con `fields` incluyendo `comments` y sin llamada upstream

#### Scenario: Teléfono inválido

- GIVEN un teléfono de 4 dígitos
- WHEN se valida
- THEN **SHALL** responder 400 con `fields` incluyendo `phone`

#### Scenario: Sin consentimiento

- GIVEN `consent: false`
- WHEN se valida
- THEN **SHALL** responder 400 `invalid` sin llamada upstream

#### Scenario: Cuerpo excesivo

- GIVEN un cuerpo de más de 8 KB
- WHEN el BFF lo recibe
- THEN **SHALL** responder 413 `{ code: 'invalid' }`

### REQ-BFF-8 Antiabuso y orden de comprobaciones

El `POST /api/booking/request` **SHALL** aplicar, en este orden, sin llamar a Nubimed hasta el último paso:

1. `Content-Type: application/json` y tamaño; si no, 400/413 `invalid`.
2. Same-origin: `Origin` igual al origen de la petición o, sin `Origin`, `Sec-Fetch-Site: same-origin`; si no, 403 `forbidden`.
3. Honeypot `website` no vacío: **SHALL** responder 200 `{ ok: true, status: 'received' }` sin efectos (ni Turnstile ni Nubimed).
4. Validación y resolución de catálogo (REQ-BFF-3, REQ-BFF-7): 400 `invalid` con `fields`.
5. Turnstile en servidor: `siteverify` con `TURNSTILE_SECRET_KEY`, `response` y `remoteip` = `CF-Connecting-IP`, timeout 5 s; **SHALL** exigir `success === true` y `action === 'booking'`. Fallo, token ausente, error o timeout de siteverify ⇒ 403 `{ code: 'turnstile_failed' }` (fail-closed).
6. Re-check de disponibilidad (REQ-BFF-6): 409 `slot_unavailable`.
7. Llamada a `POST /cita_peticiones`.

El secreto de Turnstile **SHALL NOT** exponerse; solo la site key es pública. El BFF **SHOULD** apoyarse en una regla WAF de rate limiting por IP sobre `POST /api/booking/request` si el plan lo permite.

#### Scenario: Origen ajeno

- GIVEN un POST con `Origin` de otro dominio
- WHEN el BFF lo procesa
- THEN **SHALL** responder 403 `{ code: 'forbidden' }` sin siteverify ni llamada a Nubimed

#### Scenario: Honeypot relleno

- GIVEN `website` no vacío
- WHEN el BFF lo procesa
- THEN **SHALL** responder 200 `{ ok: true, status: 'received' }`
- AND **SHALL NOT** llamar a Turnstile ni a Nubimed

#### Scenario: Turnstile inválido

- GIVEN siteverify devuelve fallo, `action` distinta de `booking`, error o timeout
- WHEN el BFF lo procesa
- THEN **SHALL** responder 403 `{ code: 'turnstile_failed' }` sin llamar a Nubimed

#### Scenario: Turnstile válido

- GIVEN siteverify devuelve éxito con `action: 'booking'` y el resto es válido
- WHEN el BFF lo procesa
- THEN **SHALL** llamar a `POST /cita_peticiones` exactamente una vez

### REQ-BFF-9 Timeouts y reintentos

Cada llamada upstream **SHALL** tener timeout acotado: 8 s en GET y 10 s en POST. Los **GET** **SHALL** reintentarse **una vez** (tras ~300 ms) solo ante 5xx, error de red o timeout. El `POST /cita_peticiones` **SHALL NOT** reintentarse nunca.

#### Scenario: POST con timeout

- GIVEN el POST upstream excede el timeout
- WHEN el BFF lo detecta
- THEN **SHALL** responder 502 `{ code: 'unknown' }`
- AND **SHALL NOT** reintentar el POST

#### Scenario: GET con 5xx transitorio

- GIVEN la disponibilidad devuelve 503 y luego 200
- WHEN el BFF la consulta
- THEN **SHALL** reintentar una vez y responder con el 200

### REQ-BFF-10 Mapeo de errores

El BFF **SHALL** mapear los errores de Nubimed como sigue y **SHALL NOT** reenviar jamás el cuerpo de error de Nubimed al navegador:

| Upstream | `availability` | `request` |
|---|---|---|
| 429 | 503 `busy` + `Retry-After` (valor upstream o 60) | igual |
| 422 | 502 `config` | 422 `invalid` + `fields` (solo nombres propios) |
| 400 | 502 `config` | 400 `invalid` |
| 404 | 502 `config` | 409 `slot_unavailable` |
| 401 / 403 | 502 `config` | 502 `config` |
| 5xx / red / timeout | 502 `upstream` | fallo antes de enviar (red/DNS/configuración): 502 `upstream`; **respuesta 5xx, timeout o error de red tras enviar el POST: 502 `unknown`** (no se puede garantizar que la petición no se creara; la UI pide no reenviar y ofrece WhatsApp/teléfono) |

`unknown` indica que la petición pudo haberse creado; el cliente **SHALL NOT** reenviarla automáticamente.

#### Scenario: Rate limit

- GIVEN Nubimed responde 429
- WHEN el BFF mapea
- THEN **SHALL** responder 503 `{ code: 'busy' }` con cabecera `Retry-After`

#### Scenario: Credenciales rechazadas

- GIVEN Nubimed responde 401
- WHEN el BFF mapea
- THEN **SHALL** responder 502 `{ code: 'config' }` sin el texto del error original

#### Scenario: 422 sin cuerpo upstream

- GIVEN Nubimed responde 422 con mensajes que incluyen datos del paciente
- WHEN el BFF mapea
- THEN la respuesta **SHALL** contener solo nombres de campo propios

#### Scenario: Resultado desconocido tras enviar

- GIVEN el POST se envió y la conexión falla antes de recibir respuesta
- WHEN el BFF mapea
- THEN **SHALL** responder 502 `{ code: 'unknown' }`

### REQ-BFF-11 Sin PII en logs

El BFF **SHALL NOT** registrar cuerpos de petición ni de respuesta, query, cabeceras, nombres, teléfonos, emails, `comments`, tokens ni mensajes de error de Nubimed. Los logs **MAY** contener solo el endpoint y el estado/`code` (p. ej. en `config` y `upstream`).

#### Scenario: Petición con datos personales

- GIVEN un POST con datos personales (éxito o error)
- WHEN se inspecciona la salida de logs
- THEN **SHALL NOT** aparecer ningún dato personal, comentario ni secreto

### REQ-BFF-12 Exclusión de indexación

`robots.txt` **SHALL** incluir `Disallow: /api/booking/`.

#### Scenario: robots.txt

- GIVEN el sitio construido
- WHEN se lee `robots.txt`
- THEN **SHALL** contener `Disallow: /api/booking/`
