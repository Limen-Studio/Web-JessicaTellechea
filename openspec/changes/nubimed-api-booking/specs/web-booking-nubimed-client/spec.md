# Delta para web-booking-nubimed-client (cambio `nubimed-api-booking`)

Sustituye el scraping del portal Nubimed (`/widget`, `/new`, reCAPTCHA del vendor, proxy `/__nubimed-proxy`) por un cliente mínimo del BFF `/api/booking/*` (capability `web-booking-bff`). Palabras clave normativas (RFC 2119): **SHALL** / **SHALL NOT**, **SHOULD**, **MAY**. Los REQ conservan su id.

**Baseline**: `openspec/specs/web-booking-nubimed-client/spec.md` (REQ-1..23, ya sincronizado con `reenable-nubimed-booking`). Cada "(Previously: …)" se refiere a ese texto.

**Sin cambios** (no aparecen aquí): REQ-5, REQ-10, REQ-15, REQ-17, REQ-18, REQ-19, REQ-22.

**Invariantes**: orden del flujo especialidad → centro → tratamiento → día → hora → datos → confirmación; reserva `noindex`, fuera de sitemap y navegación; `bookingPublic` gobierna el flujo; textos en es/en/ca/fr.

**Códigos de error** (idénticos en `web-booking-bff`): `invalid`, `forbidden`, `turnstile_failed`, `slot_unavailable`, `busy`, `config`, `upstream`, `unknown`.

---

## MODIFIED Requirements

### Purpose

Especifica un **flujo de reserva propio** que crea **peticiones de cita** en Nubimed (clínica **1212**) mediante un **BFF same-origin** alojado en Cloudflare Pages Functions (`web-booking-bff`), sin depender del widget ni del portal del vendor. El navegador **SHALL NOT** comunicarse con Nubimed ni con su portal; no hay bootstrap, sesión ni scraping. El sitio público sigue siendo **estático en origen**.

(Previously: el acceso al vendor se hacía mediante un proxy same-origin del portal (REQ-11 y REQ-21), con centros (áreas), tratamientos y disponibilidad del portal.)

### REQ-1 Booking route hosts the interactive flow

Con el flag `bookingPublic` activo, para cada locale la página utilitaria de reserva **SHALL** montar `BookingFlow`, que **SHALL** comunicarse únicamente con `/api/booking/*`. Con `bookingPublic` inactivo, la página **SHALL** mostrar el placeholder estático de release 1 (CTA de WhatsApp y enlace secundario de contacto), **SHALL NOT** montar `BookingFlow` y **SHALL NOT** realizar ninguna petición a `/api/booking/*` ni al vendor. En ambos casos la ruta **SHALL** seguir `noindex`, quedar fuera del sitemap y de la navegación principal; la matriz de URLs de `web-localized-routing` **SHALL** permanecer sin cambios.

(Previously: con el flag activo `BookingFlow` solicitaba al vendor el catálogo de disponibilidad; con el flag inactivo no llegaba ninguna petición "al vendor ni al proxy"; `robots.txt` incluía `Disallow: /__nubimed-proxy/`.)

#### Scenario: Flag activo, usuario abre la reserva

- GIVEN `bookingPublic` activo y una URL de reserva válida para `es`, `en`, `ca` o `fr`
- WHEN la página carga
- THEN `BookingFlow` **SHALL** montarse en ese locale
- AND la página **SHALL** conservar `noindex` y **SHALL NOT** figurar en el sitemap

#### Scenario: Flag inactivo (rollback)

- GIVEN `bookingPublic` inactivo
- WHEN la página de reserva carga en cualquier locale
- THEN **SHALL** mostrarse el placeholder con CTA de WhatsApp y enlace de contacto
- AND `BookingFlow` **SHALL NOT** montarse
- AND **cero** peticiones a `/api/booking/*` **SHALL** emitirse

#### Scenario: Placeholder localisation

- GIVEN the booking URL for any supported locale and `bookingPublic` inactivo
- WHEN the placeholder is rendered
- THEN heading, lead, WhatsApp CTA label and secondary link label **SHALL** be in that locale

#### Scenario: Reserva fuera de navegación e indexación

- GIVEN el sitio construido con `bookingPublic` activo
- WHEN se inspeccionan la navegación principal, el sitemap y `robots.txt`
- THEN la reserva **SHALL NOT** estar en la navegación principal ni en el sitemap
- AND `robots.txt` **SHALL** incluir `Disallow: /api/booking/`
- AND `robots.txt` **SHALL NOT** incluir `/__nubimed-proxy/`

### REQ-2 UI internationalization

All user-visible strings (labels, errors, success copy, notices) **SHALL** exist for **es**, **en**, **ca**, and **fr**. The module **SHALL NOT** mix languages in one session except when the user navigates to another locale page. No locale parameter **SHALL** be sent to the vendor. Las claves de portal, reCAPTCHA y paciente recurrente **SHALL** retirarse y **SHALL** existir en los cuatro locales las nuevas: `fieldComments`, `commentsHealthNotice`, `turnstileNotice`, `turnstileFailed`, `slotUnavailable`, `busy`, `submitUnknown`, `submitSuccessConfirmed`, `submitSuccessReceived`.

(Previously: the `locale` query parameter sent to the vendor for availability calls SHALL map from the site locale; "Continue button" listed among the strings.)

#### Scenario: Network error message

- GIVEN a network failure while loading availability
- WHEN the error state is shown
- THEN the message **SHALL** be in the active module locale

#### Scenario: Claves nuevas en los cuatro locales

- GIVEN el diccionario de booking
- WHEN se comparan es, en, ca y fr
- THEN todas las claves nuevas listadas **SHALL** existir en los cuatro

### REQ-3 Central specialty and centro catalog

Los ids de especialidad, agendas, servicios, alias, orden, centros y etiquetas i18n **SHALL** vivir en **una única** configuración versionada del repo. El catálogo **SHALL** incluir exactamente Medicina estética (`3`) y Tricología/Capilar (`386`), y los centros Barcelona y El Vendrell. Cada centro **SHALL** tener un `agendaId` (`barcelona` → `29537`, `el-vendrell` → `26912`) y cada combinación (especialidad × centro × tipo `firstVisit`/`treatments`) un `serviceId`:

| Especialidad | Centro | `firstVisit` | `treatments` |
|---|---|---|---|
| 3 | Barcelona | `389741` | `389745` |
| 3 | El Vendrell | `389742` | `389746` |
| 386 | Barcelona | `389743` | `389747` |
| 386 | El Vendrell | `389744` | `389748` |

El catálogo **SHALL NOT** contener `area_id` ni los ids `4`, `5`, `244529`. El cliente **SHALL** identificar la selección solo con claves de catálogo (`specialty`, `centro`, `kind`) y **SHALL NOT** enviar ids crudos de vendor (`schedule_id`, `service_id`, `speciality_id`, `clinica_id`). Estos ids **SHALL NOT** duplicarse fuera de la configuración como fuente de verdad.

(Previously: catálogo con `area_id` por centro (15070–15073) y tratamientos tratados como presenciales sin conceptos (`pref_conceptos` vacío); sin `agendaId`.)

#### Scenario: Edición de etiqueta en inglés

- GIVEN un cambio solo en etiquetas en inglés de la configuración central
- WHEN el sitio se construye y despliega
- THEN la UI `en` **SHALL** mostrar las nuevas etiquetas sin cambiar el cableado de peticiones

#### Scenario: Mapeo de agenda y servicio

- GIVEN especialidad `386`, centro El Vendrell y tipo `treatments`
- WHEN el módulo resuelve el contexto de reserva
- THEN la agenda **SHALL** ser `26912` y el servicio `389748`

#### Scenario: Sin ids crudos en el cliente

- GIVEN cualquier petición del cliente a `/api/booking/*`
- WHEN se inspeccionan su query y su cuerpo
- THEN **SHALL NOT** contener `schedule_id`, `service_id`, `speciality_id`, `clinica_id` ni `area_id`

#### Scenario: Ids obsoletos

- GIVEN el catálogo construido
- WHEN se inspeccionan las especialidades disponibles
- THEN **SHALL NOT** existir entradas con ids `4` ni `5`

### REQ-4 Optional preset specialty and centro from the host page

Si el host pasa una **especialidad preset** (slug o id del catálogo, incluidos los alias `capilar` y `hair` que **SHALL** resolver a `386`) y, opcionalmente, un parámetro **`sede`** (clave de centro):

- Si el preset es **válido**, el módulo **SHALL NOT** mostrar el selector de especialidad y **SHALL** avanzar al paso de centro.
- Si además `sede` es **válido** para esa especialidad, el módulo **SHALL NOT** mostrar el selector de centro y **SHALL** avanzar al paso de tratamiento.
- Si el preset o `sede` son **inválidos**, el módulo **SHALL** mostrar un error funcional claro, **SHALL NOT** llamar al BFF con esa clave y **SHALL** permitir elegir manualmente un valor válido.
- El preset **SHALL** poder provenir de la query string (`preset`, `sede`) incluso cuando el host no pase props; un preset recibido por prop **SHALL NOT** impedir la lectura de `sede` desde la URL.

(Previously: igual; los escenarios hablaban de `area_id=15073`, de llamar "al vendor" y de peticiones de tratamientos, días o franjas.)

#### Scenario: Preset válido

- GIVEN `preset=3`
- WHEN el módulo monta
- THEN el selector de especialidad **SHALL NOT** aparecer y el paso de centro **SHALL** ser el visible

#### Scenario: Alias capilar

- GIVEN `preset=capilar` o `preset=hair`
- WHEN el módulo monta
- THEN el preset **SHALL** resolver a la especialidad `386`

#### Scenario: Preset y sede válidos

- GIVEN `preset=386` y `sede=el-vendrell`
- WHEN el módulo monta
- THEN los pasos de especialidad y centro **SHALL NOT** aparecer y el paso de tratamiento **SHALL** mostrarse para la agenda `26912`

#### Scenario: Preset desconocido

- GIVEN `preset` no coincide con ninguna entrada del catálogo
- WHEN el módulo monta
- THEN **SHALL** mostrarse un error y ninguna llamada al BFF **SHALL** usar esa clave

#### Scenario: Sede inválida

- GIVEN `preset=3` y `sede` no corresponde a ningún centro de esa especialidad
- WHEN el módulo monta
- THEN **SHALL** mostrarse el error de preset inválido
- AND ninguna petición de disponibilidad **SHALL** enviarse hasta que el usuario elija un centro válido

### REQ-6 Time horizon

Los días futuros seleccionables **SHALL NOT** exceder **91** días naturales desde hoy en `Europe/Madrid`. El horizonte es **constante**: el cliente **SHALL NOT** depender de un máximo del vendor ni de bootstrap, y **SHALL NOT** enviar rango de fechas (lo fija el servidor, `web-booking-bff`).

(Previously: if vendor bootstrap exposes a smaller maximum, the effective horizon SHALL be the minimum of 91 and that maximum.)

#### Scenario: Límite de horizonte

- GIVEN hoy en Madrid
- WHEN se construye el calendario
- THEN el usuario **SHALL NOT** poder seleccionar un día posterior a hoy + 91 días

### REQ-7 Days and slots; reset on context change

El orden del flujo **SHALL** ser especialidad → centro → tratamiento → día/hora → datos. Tras elegir especialidad, centro y tratamiento, el módulo **SHALL** cargar la disponibilidad con **una sola petición** a `GET /api/booking/availability?specialty&centro&kind` al entrar en el paso de día y hora (y de nuevo solo al cambiar el tratamiento), y **SHALL** derivar de esa respuesta los días disponibles y las franjas de cada día. Elegir un día o cambiar de mes **SHALL NOT** emitir peticiones. La agrupación por día y la visualización de horas (incluido el resumen) **SHALL** usar `Europe/Madrid`, con independencia de la zona del navegador. Cambiar de **especialidad** **SHALL** limpiar centro, tratamiento, día, franja y todo estado derivado. Cambiar de **centro** o de **tratamiento** **SHALL** limpiar día, franja y todo estado derivado. Cambiar de **día** **SHALL** limpiar la franja. Las peticiones en vuelo de un contexto obsoleto **SHALL** abortarse o ignorarse para que respuestas antiguas **SHALL NOT** sobrescribir la UI actual.

(Previously: las franjas se cargaban por día; el cambio de especialidad y de centro limpiaba también el profesional; la hora se mostraba sin zona explícita.)

#### Scenario: Una petición de disponibilidad

- GIVEN especialidad, centro y tratamiento elegidos
- WHEN el usuario llega al paso de día y hora y luego elige un día
- THEN **SHALL** emitirse exactamente una petición a `/api/booking/availability`
- AND la petición **SHALL NOT** incluir parámetros de fecha

#### Scenario: Zona horaria de la clínica

- GIVEN un navegador en zona `America/New_York` y una franja `2026-12-01T09:30:00+01:00`
- WHEN se muestran la franja y el resumen
- THEN la hora **SHALL** mostrarse como 09:30 y el día como 1 de diciembre (Madrid)

#### Scenario: Cambio de centro con respuesta en vuelo

- GIVEN un usuario con centro, tratamiento, día y franja seleccionados
- WHEN cambia el centro
- THEN tratamiento, día y franja **SHALL** limpiarse
- AND una respuesta en vuelo del centro anterior **SHALL NOT** actualizar la UI

#### Scenario: Cambio de especialidad

- GIVEN un usuario con especialidad y centro seleccionados
- WHEN cambia la especialidad
- THEN el centro y todo el estado posterior **SHALL** limpiarse

#### Scenario: Sin disponibilidad

- GIVEN el BFF responde con `days` vacío
- WHEN el usuario ve el paso de día y hora
- THEN **SHALL** mostrarse un estado explícito de **sin disponibilidad**, no un error de red

### REQ-9 Continue, request submission and result copy

Los pasos de especialidad, centro, tratamiento y hora **SHALL** avanzar automáticamente ante una elección válida y **SHALL NOT** requerir botones **Continue**. Al elegir una hora el módulo **SHALL** pasar directamente a Datos personales, sin petición intermedia ni pantalla de carga.

La confirmación final **SHALL** enviar `POST /api/booking/request` (JSON) con: `specialty`, `centro`, `kind`, `requestedTime` **exactamente tal como lo devolvió la disponibilidad** (sin reformatear ni cambiar de zona), `patient` (nombre, apellidos, prefijo, teléfono, email), `comments`, `consent`, `turnstileToken` y el honeypot `website`. El botón de envío (y el cierre del modal) **SHALL** quedar bloqueado mientras hay un envío en curso, y el módulo **SHALL NOT** reintentar el POST automáticamente. El token de Turnstile es de un solo uso: tras cualquier respuesta del POST el módulo **SHALL** obtener uno nuevo antes de permitir otro envío.

El copy de éxito **SHALL** depender de la respuesta `{ ok: true, status }`: con `status: 'confirmed'` **SHALL** mostrar "cita confirmada"; con `status: 'received'` **SHALL** mostrar "solicitud recibida, confirmación por email". El módulo **SHALL NOT** hardcodear "confirmada". Los errores **SHALL** tratarse por `code` (no por subcadenas): `busy` → mensaje de reintentar más tarde; `slot_unavailable` → "esa hora ya no está disponible" y volver a elegir franja con disponibilidad refrescada; `invalid` → marcar los campos de `fields`; `turnstile_failed` → aviso `turnstileFailed` con enlaces a WhatsApp y contacto; `unknown` → mensaje de que la solicitud **podría haberse recibido**, que **no debe repetirse el envío** y enlaces a WhatsApp/teléfono; `config`, `upstream` y `forbidden` → error genérico de envío con enlaces a WhatsApp/teléfono.

(Previously: carga de `GET …/cita_peticiones/new`, hidden scrapeados con precedencia sobre valores fijos, `POST …/cita_peticiones` urlencoded al portal con la sesión del vendor, con reCAPTCHA; errores por subcadenas; un único copy de éxito.)

#### Scenario: Camino feliz confirmado

- GIVEN datos válidos, consentimiento y Turnstile resuelto
- WHEN el BFF responde `{ ok: true, status: 'confirmed' }`
- THEN **SHALL** mostrarse el copy "cita confirmada" en el locale activo

#### Scenario: Solicitud recibida

- GIVEN datos válidos
- WHEN el BFF responde `{ ok: true, status: 'received' }`
- THEN **SHALL** mostrarse "solicitud recibida, confirmación por email"
- AND el texto **SHALL NOT** afirmar que la cita está confirmada

#### Scenario: requestedTime sin transformar

- GIVEN la disponibilidad devolvió `2026-12-01T09:30:00+01:00`
- WHEN el usuario elige esa franja y confirma
- THEN el cuerpo del POST **SHALL** contener `requestedTime` idéntico a esa cadena

#### Scenario: Doble envío

- GIVEN un envío en curso
- WHEN el usuario intenta enviar de nuevo
- THEN **SHALL NOT** emitirse un segundo POST

#### Scenario: Franja ya no disponible

- GIVEN el BFF responde `409 { code: 'slot_unavailable' }`
- WHEN el módulo procesa el error
- THEN **SHALL** mostrar "esa hora ya no está disponible" y permitir elegir otra franja

#### Scenario: Servicio ocupado

- GIVEN el BFF responde `503 { code: 'busy' }`
- WHEN el módulo procesa el error
- THEN **SHALL** mostrar el mensaje de reintento en el locale activo y **SHALL NOT** reenviar automáticamente

#### Scenario: Resultado desconocido

- GIVEN el BFF responde `502 { code: 'unknown' }`
- WHEN el módulo procesa el error
- THEN **SHALL** indicar que la solicitud podría haberse recibido y que no debe repetirse
- AND **SHALL** ofrecer enlaces a WhatsApp/teléfono
- AND **SHALL NOT** reenviar automáticamente

### REQ-11 Vendor access via BFF

El flujo **SHALL** acceder a Nubimed **solo** mediante los endpoints same-origin `/api/booking/*` (`web-booking-bff`). El navegador **SHALL NOT** contactar con el vendor ni con ningún proxy genérico. Antes del go-live **SHALL** documentarse el resultado de la verificación en preview/producción (BFF, Turnstile, Cache API). Si la verificación falla, el comportamiento publicado **SHALL** degradarse mediante `bookingPublic` inactivo (REQ-1, REQ-18).

(Previously: base same-origin `/__nubimed-proxy` servida por una Cloudflare Pages Function; validación de CORS, cookies, CSRF, WAF y reCAPTCHA.)

#### Scenario: Producción usa el BFF

- GIVEN el build de producción con `bookingPublic` activo
- WHEN `BookingFlow` realiza peticiones
- THEN todas **SHALL** dirigirse a `/api/booking/*` del mismo origen
- AND ninguna **SHALL** dirigirse a `/__nubimed-proxy` ni al dominio del vendor

#### Scenario: Validación fallida

- GIVEN la verificación en preview o producción falla
- WHEN se decide el despliegue
- THEN `bookingPublic` **SHALL** permanecer inactivo y los CTAs **SHALL** mantener el comportamiento de release 1

### REQ-12 Secrets and public env

Los secretos **SHALL NOT** almacenarse en variables `PUBLIC_*`, en el repositorio ni en el bundle del cliente. `NUBIMED_API_EMAIL`, `NUBIMED_API_TOKEN` y `TURNSTILE_SECRET_KEY` **SHALL** ser secretos de runtime de Cloudflare (y `.dev.vars` local); `NUBIMED_CLINIC_ID` (`1212`) y, opcionalmente, `NUBIMED_API_BASE` (solo `https:`) son variables de runtime. La única variable pública nueva **SHALL** ser `PUBLIC_TURNSTILE_SITE_KEY`. `PUBLIC_NUBIMED_CLINICA_ID`, `PUBLIC_NUBIMED_VENDOR_ORIGIN`, `PUBLIC_NUBIMED_PROXY_URL` y `PUBLIC_NUBIMED_PORTAL_NEW_URL` **SHALL** retirarse. `.dev.vars` y `.wrangler/` **SHALL** estar en `.gitignore` y `.dev.vars.example` **SHALL** existir sin valores.

(Previously: solo "Secrets SHALL NOT be stored in PUBLIC_* variables" y "Vendor URL query parameters SHALL be built only from vendor responses or non-secret configuration".)

#### Scenario: Production build

- GIVEN solo variables públicas en build
- WHEN se emite el bundle del cliente
- THEN **SHALL NOT** contener el token de API, el email de API ni `TURNSTILE_SECRET_KEY`

#### Scenario: Higiene del repositorio

- GIVEN el repositorio
- WHEN se revisan `.gitignore` y los archivos versionados
- THEN `.dev.vars` y `.wrangler/` **SHALL** estar ignorados
- AND `.dev.vars.example` **SHALL** carecer de valores reales

#### Scenario: Variables retiradas

- GIVEN `env.d.ts` y `.env.example`
- WHEN se buscan `PUBLIC_NUBIMED_*`
- THEN **SHALL NOT** existir ninguna

### REQ-13 Legal information and consent at booking capture

Before the user may submit a booking request, the module **SHALL** show concise information identifying the **controller**, the **purpose** (appointment management), the **legal basis** (performance of a service), and that data **SHALL** be processed via the **Nubimed** platform as a processor following the controller's instructions. The module **SHALL** provide a **link** to the site's **privacy policy** in the **active locale**.

The module **SHALL** require an explicit, **not pre-checked** checkbox confirming acceptance of the privacy policy before final submission. The module **SHALL NOT** offer a commercial-communications (marketing) checkbox, because the Nubimed API has no field to store it.

The module **SHALL** display, near the consent area, a notice that the anti-spam check is provided by **Cloudflare Turnstile** (Cloudflare as provider), with a link to Cloudflare's policy. The module **SHALL NOT** show the reCAPTCHA / Google disclosure.

(Previously: a separate optional marketing checkbox SHALL exist; the mandatory reCAPTCHA disclosure with Google's privacy policy and terms links SHALL be displayed.)

#### Scenario: Privacy checkbox not pre-checked

- GIVEN the user reaches the final booking confirmation step
- WHEN the privacy checkbox has not been checked
- THEN final submit **SHALL** be blocked and **SHALL** surface a message in the active locale

#### Scenario: Sin casilla de marketing

- GIVEN el paso de confirmación final
- WHEN se renderiza
- THEN **SHALL NOT** existir ninguna casilla de comunicaciones comerciales
- AND con solo la casilla de privacidad marcada el envío **SHALL** permitirse (sujeto a otras validaciones)

#### Scenario: Locale-correct privacy link

- GIVEN the site locale is Catalan
- WHEN the user activates the privacy policy link from the booking flow
- THEN the destination **SHALL** be the Catalan privacy policy path for this site

#### Scenario: Divulgación de Turnstile

- GIVEN el paso de confirmación final
- WHEN el usuario lo visualiza
- THEN el aviso de Cloudflare Turnstile **SHALL** ser visible sin abrir un modal externo
- AND **SHALL NOT** aparecer texto de reCAPTCHA ni enlaces de Google

### REQ-14 Single-step stepper and automatic progression

El módulo **SHALL** comportarse como un stepper de **5 pasos** (especialidad, centro, tratamiento, día y hora, datos personales) con exactamente un paso visible a la vez. En los pasos de especialidad, centro y tratamiento el módulo **SHALL NOT** renderizar botones "Continue" y **SHALL** avanzar automáticamente ante una selección válida. En día y hora, seleccionar una hora válida **SHALL** avanzar automáticamente a Datos personales. Los pasos omitidos por preset **SHALL** contarse como completados. La etiqueta accesible del stepper **SHALL** estar localizada.

(Previously: "seleccionar una hora válida (y profesional si se requiere)".)

#### Scenario: Especialidad a centro

- GIVEN el paso de especialidad visible
- WHEN el usuario elige una especialidad válida
- THEN el paso de centro **SHALL** ser el único visible

#### Scenario: Centro a tratamiento

- GIVEN el paso de centro visible
- WHEN el usuario elige un centro válido
- THEN el paso de tratamiento **SHALL** ser el único visible

#### Scenario: Hora a datos personales

- GIVEN el paso de día y hora con día y franjas válidos
- WHEN el usuario selecciona una franja válida
- THEN el paso de Datos personales **SHALL** ser el único visible

#### Scenario: Stepper localizado

- GIVEN el módulo en `ca`
- WHEN se inspecciona el `aria-label` del stepper
- THEN **SHALL** estar en catalán

### REQ-16 Personal details and summary contract

Datos personales **SHALL** ofrecer un único formulario de petición: **SHALL NOT** existir variante "Paciente recurrente" ni campos DNI o fecha de nacimiento. **Obligatorios por defecto**: nombre, apellidos, prefijo telefónico, teléfono y email. El campo **`comments`** (motivo de consulta) **SHALL** ser opcional, **SHALL** limitarse a 500 caracteres y **SHALL** mostrar un aviso visible en los cuatro locales de que no debe incluir datos de salud innecesarios. Un campo honeypot **SHALL** existir, oculto a usuarios y lectores de pantalla. El resumen de la cita **SHALL** incluir especialidad, tratamiento/servicio, fecha, hora (en `Europe/Madrid`) y el centro elegido con su dirección.

El centro **SHALL** aparecer siempre en el resumen como enlace a Google Maps:

- La dirección **SHALL** leerse en build por centro de `PUBLIC_CLINIC_ADDRESS_BARCELONA` y `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL` (documentadas en `.env.example`).
- Si la variable de dirección del centro no está definida, el resumen **SHALL** mostrar la dirección de calle de Nubimed de ese centro como fallback (`C. Calvet 16, Barcelona` para Barcelona; `C. de Mar 41, El Vendrell` para El Vendrell) y **SHALL NOT** mostrar la dirección de otro centro. La dirección devuelta por la API de Nubimed (`center_address`) **SHALL NOT** usarse.
- El destino del enlace **SHALL** ser la URL de Maps por centro de `PUBLIC_GOOGLE_MAPS_URL_BARCELONA` o `PUBLIC_GOOGLE_MAPS_URL_EL_VENDRELL` si están definidas; si no, una URL de búsqueda de Google Maps construida con la dirección mostrada.

(Previously: ofrecía "Paciente nuevo" y "Paciente recurrente", todos los campos de la variante activa obligatorios y DNI y Fecha para el recurrente; sin `comments` ni honeypot; hora sin zona explícita. La regla de dirección/Maps se conserva.)

#### Scenario: Pestaña Ya registrado eliminada

- GIVEN el paso de datos personales
- WHEN se renderiza
- THEN **SHALL NOT** existir selector de paciente recurrente ni campos DNI o fecha de nacimiento

#### Scenario: Campos obligatorios

- GIVEN el paso de datos personales
- WHEN falta nombre, apellidos, prefijo, teléfono o email
- THEN la elegibilidad de envío final **SHALL** seguir bloqueada

#### Scenario: Comentarios opcionales con límite y aviso

- GIVEN `comments` vacío
- WHEN se valida el formulario
- THEN **SHALL** ser válido
- AND con más de 500 caracteres **SHALL** ser inválido
- AND el aviso de datos de salud **SHALL** ser visible

#### Scenario: Resumen con dirección por centro

- GIVEN un flujo válido con centro El Vendrell, `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL` y `PUBLIC_GOOGLE_MAPS_URL_EL_VENDRELL` definidas
- WHEN se renderiza el resumen
- THEN **SHALL** mostrarse especialidad, tratamiento, centro, fecha, hora de Madrid y esa dirección enlazada a la URL de Maps configurada

#### Scenario: Dirección ausente con fallback de Nubimed

- GIVEN centro Barcelona y `PUBLIC_CLINIC_ADDRESS_BARCELONA` no definida
- WHEN se renderiza el resumen
- THEN **SHALL** mostrarse `C. Calvet 16, Barcelona` enlazada a una búsqueda de Google Maps
- AND **SHALL NOT** mostrarse la dirección de otro centro

### REQ-23 Real submission acceptance

Antes de activar `bookingPublic` en producción, el equipo **SHALL** completar una **verificación manual** en preview o producción con secretos reales: **una petición real por centro** (Barcelona, agenda `29537`; El Vendrell, agenda `26912`) por el flujo completo (incluido Turnstile). Cada petición **SHALL** aparecer en Nubimed con el hueco y servicio correctos y **SHALL** anularse después (`POST /cita_peticiones/{id}/anular` o panel). El **estado devuelto** (`state`, presencia de `assigned_time`) **SHALL** registrarse en el informe de verify, junto con el valor exacto del estado de aceptación y el copy que mostró la UI. También **SHALL** revisarse el email de Nubimed recibido (dirección del centro) y el funcionamiento de la Cache API en preview.

(Previously: una cita de prueba por el flujo completo con reCAPTCHA cuyo `POST …/cita_peticiones` del portal devolviera 201, que figurase en el centro elegido y que la clínica cancelase.)

#### Scenario: Petición de prueba por centro

- GIVEN el flujo desplegado en preview con secretos reales
- WHEN se envía una petición real en Barcelona y otra en El Vendrell
- THEN cada una **SHALL** aparecer en Nubimed con la agenda, hueco y servicio elegidos
- AND **SHALL** anularse tras la verificación

#### Scenario: Registro del estado

- GIVEN una petición de prueba enviada
- WHEN se redacta el informe de verify
- THEN **SHALL** constar el `state`, si hubo `assigned_time` y qué copy mostró la UI

#### Scenario: Verificación fallida

- GIVEN la petición no aparece, o el BFF devuelve `invalid`, `config` o `turnstile_failed` en el flujo correcto
- WHEN se evalúa el go-live
- THEN `bookingPublic` **SHALL** permanecer inactivo

---

## REMOVED Requirements

### REQ-8 Multiple professionals per slot

(Reason: cada centro tiene una agenda fija (`agendaId`), es decir, una única profesional; el BFF descarta los `user_ids` y no existe elección de profesional.)

### REQ-20 Area dimension in vendor requests

(Reason: la API no usa `area_id`; la sede la determina la agenda del catálogo (REQ-3). Desaparecen `buildNewUrl`, `/new`, `huecos_agenda` y `obtener_clinica_tratamientos`.)

### REQ-21 Same-origin proxy on Cloudflare Pages Functions

(Reason: el proxy genérico `/__nubimed-proxy` se elimina por completo, junto con el proxy Vite del portal; lo sustituyen los requisitos de `web-booking-bff`.)

#### Scenario: Proxy y scraping eliminados

- GIVEN el repositorio
- WHEN se buscan `functions/__nubimed-proxy`, `parse-widget`, `parse-new-booking-html`, `build-new-url`, `booking-submit-merge`, `nubimed-portal-submit-fields` y `recaptcha`
- THEN **SHALL NOT** existir ninguno
