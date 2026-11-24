# Web booking Nubimed client — Specification

**Capability:** `web-booking-nubimed-client`  
**Source of truth:** `openspec/specs/web-booking-nubimed-client/spec.md` (merged from archived changes `nubimed-booking-client-flow`, `legal-content-rgpd-i18n`, `booking-component-and-page-redesign`, `defer-booking-cta-to-whatsapp`, `reenable-nubimed-booking`)

## Purpose

Especifica el comportamiento de un **flujo de reserva propio** que usa el portal Nubimed / Clínica en la nube (clínica **1212**) como **sistema de registro** de especialidades, centros (áreas), tratamientos y disponibilidad, sin depender del widget embebido del vendor como única UX. El sitio público sigue siendo **estático en origen**; el acceso al vendor **SHALL** hacerse mediante un **proxy same-origin** alojado en Cloudflare Pages Functions (ver REQ-11 y REQ-21).

## Normative keywords

**SHALL** / **SHALL NOT** (mandatory), **SHOULD** (recommended), **MAY** (optional).

---

## Requirements

### REQ-1 Booking route hosts the interactive flow

Con el flag `bookingPublic` activo, para cada locale la página utilitaria de reserva **SHALL** montar el módulo interactivo `BookingFlow` y **SHALL** solicitar al vendor catálogo de disponibilidad. Con `bookingPublic` inactivo, la página **SHALL** mostrar el placeholder estático de release 1 (CTA de WhatsApp y enlace secundario de contacto), **SHALL NOT** montar `BookingFlow` y **SHALL NOT** enviar ninguna petición al vendor. En ambos casos la ruta **SHALL** seguir `noindex`, **SHALL** quedar fuera del sitemap y **SHALL NOT** aparecer en la navegación principal; la matriz de URLs de `web-localized-routing` **SHALL** permanecer sin cambios.

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
- AND ninguna petición **SHALL** llegar al vendor ni al proxy

#### Scenario: Placeholder localisation

- GIVEN the booking URL for any supported locale and `bookingPublic` inactivo
- WHEN the placeholder is rendered
- THEN heading, lead, WhatsApp CTA label and secondary link label **SHALL** be in that locale

#### Scenario: Reserva fuera de navegación e indexación

- GIVEN el sitio construido con `bookingPublic` activo
- WHEN se inspeccionan la navegación principal, el sitemap y `robots.txt`
- THEN la reserva **SHALL NOT** estar en la navegación principal ni en el sitemap
- AND `robots.txt` **SHALL** incluir `Disallow: /__nubimed-proxy/`

---

### REQ-2 UI internationalization

All user-visible strings (labels, errors, Continue button, notices) **SHALL** exist for **es**, **en**, **ca**, and **fr**. The `locale` (or equivalent) query parameter sent to the vendor for availability calls **SHALL** map from the site locale per the table implemented in code (see `openspec/changes/archive/2026-05-03-nubimed-booking-client-flow/design.md` for rationale). The module **SHALL NOT** mix languages in one session except when the user navigates to another locale page.

#### Scenario: Network error message

- GIVEN a network failure while loading days
- WHEN the error state is shown
- THEN the message **SHALL** be in the active module locale

---

### REQ-3 Central specialty and centro catalog

Los ids de especialidad del vendor, alias, orden, centros (áreas) y etiquetas i18n **SHALL** vivir en **una única** configuración versionada del repo. El catálogo **SHALL** incluir exactamente las especialidades Medicina estética (`3`) y Tricología/Capilar (`386`), y para cada una dos centros con estos ids verificados contra el portal en vivo:

| Especialidad | Centro | `area_id` | Tratamiento primera visita | Tratamiento "Tratamientos" |
|---|---|---|---|---|
| 3 | Barcelona | `15070` | `389741` | `389745` |
| 3 | El Vendrell | `15072` | `389742` | `389746` |
| 386 | Barcelona | `15071` | `389743` | `389747` |
| 386 | El Vendrell | `15073` | `389744` | `389748` |

Cada tratamiento **SHALL** tratarse como un único tratamiento presencial sin conceptos (`pref_conceptos` vacío). Estos ids **SHALL NOT** duplicarse fuera de esa configuración como fuente de verdad. Los ids `4`, `5` y `244529` de la clínica anterior **SHALL NOT** permanecer en el catálogo.

#### Scenario: Edición de etiqueta en inglés

- GIVEN un cambio solo en etiquetas en inglés de la configuración central
- WHEN el sitio se construye y despliega
- THEN la UI `en` **SHALL** mostrar las nuevas etiquetas sin cambiar el cableado de peticiones

#### Scenario: Mapeo de áreas

- GIVEN la especialidad `386` y el centro El Vendrell
- WHEN el módulo resuelve el contexto de reserva
- THEN **SHALL** usar `area_id=15073` y los tratamientos `389744` y `389748`

#### Scenario: Ids obsoletos

- GIVEN el catálogo construido
- WHEN se inspeccionan las especialidades disponibles
- THEN **SHALL NOT** existir entradas con ids `4` ni `5`

---

### REQ-4 Optional preset specialty and centro from the host page

Si el host pasa una **especialidad preset** (slug o id del catálogo, incluidos los alias `capilar` y `hair` que **SHALL** resolver a `386`) y, opcionalmente, un parámetro **`sede`** (clave de centro):

- Si el preset es **válido**, el módulo **SHALL NOT** mostrar el selector de especialidad y **SHALL** avanzar al paso de centro.
- Si además `sede` es **válido** para esa especialidad, el módulo **SHALL NOT** mostrar el selector de centro y **SHALL** avanzar al paso de tratamiento.
- Si el preset o `sede` son **inválidos**, el módulo **SHALL** mostrar un error funcional claro, **SHALL NOT** llamar al vendor con esa clave y **SHALL** permitir al usuario elegir manualmente un valor válido.
- El preset **SHALL** poder provenir de la query string (`preset`, `sede`) incluso cuando el host no pase props; un preset recibido por prop **SHALL NOT** impedir la lectura de `sede` desde la URL.

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
- THEN los pasos de especialidad y centro **SHALL NOT** aparecer y el paso de tratamiento **SHALL** cargarse con `area_id=15073`

#### Scenario: Preset desconocido

- GIVEN `preset` no coincide con ninguna entrada del catálogo
- WHEN el módulo monta
- THEN **SHALL** mostrarse un error y ninguna llamada al vendor **SHALL** usar esa clave

#### Scenario: Sede inválida

- GIVEN `preset=3` y `sede` no corresponde a ningún centro de esa especialidad
- WHEN el módulo monta
- THEN **SHALL** mostrarse el error de preset inválido
- AND ninguna petición de tratamientos, días o franjas **SHALL** enviarse hasta que el usuario elija un centro válido

---

### REQ-5 No preset

Sin preset, el módulo **SHALL** mostrar la selección de especialidad (REQ-3) y, tras elegirla, la selección de centro, antes de cargar tratamientos o días.

#### Scenario: Entrada genérica

- GIVEN sin preset ni `sede`
- WHEN el usuario llega a la página
- THEN el selector de especialidad **SHALL** aparecer primero
- AND tras elegir especialidad **SHALL** aparecer el selector de centro antes del calendario

---

### REQ-6 Time horizon

Selectable future days **SHALL NOT** exceed **91** calendar days from the reference date (e.g. today in clinic timezone, typically `Europe/Madrid`). If vendor bootstrap exposes a smaller maximum, the effective horizon **SHALL** be the **minimum** of 91 and that maximum.

#### Scenario: Vendor caps at 30 days

- GIVEN bootstrap indicates 30-day maximum
- WHEN the calendar is built
- THEN the user **SHALL NOT** select a day beyond 30 days from the reference date

---

### REQ-7 Days and slots; reset on context change

El orden del flujo **SHALL** ser especialidad → centro → tratamiento → día/hora → datos. Tras elegir especialidad, centro y tratamiento, y luego el día, el módulo **SHALL** cargar las franjas de ese día. Cambiar de **especialidad** **SHALL** limpiar centro, tratamiento, día, franja, profesional y todo estado derivado. Cambiar de **centro** **SHALL** limpiar tratamiento, día, franja, profesional y todo estado derivado. Cambiar de **día** **SHALL** limpiar la franja (y el profesional). Las peticiones en vuelo de un contexto obsoleto **SHALL** abortarse o ignorarse para que respuestas antiguas **SHALL NOT** sobrescribir la UI actual.

#### Scenario: Cambio rápido de día

- GIVEN una petición de franjas en vuelo para el día A
- WHEN el usuario selecciona el día B antes de que A responda
- THEN el resultado de A **SHALL NOT** actualizar la UI si B ya es el contexto activo

#### Scenario: Cambio de centro

- GIVEN un usuario con centro, tratamiento, día y franja seleccionados
- WHEN cambia el centro
- THEN tratamiento, día, franja y profesional **SHALL** limpiarse
- AND una respuesta en vuelo del centro anterior **SHALL NOT** actualizar la UI

#### Scenario: Cambio de especialidad

- GIVEN un usuario con especialidad y centro seleccionados
- WHEN cambia la especialidad
- THEN el centro y todo el estado posterior **SHALL** limpiarse

---

### REQ-8 Multiple professionals per slot

When a normalized slot lists more than one professional id, the user **SHALL** pick **exactly one** professional before Continue is enabled. The system **SHALL NOT** invent professional ids outside the vendor response.

#### Scenario: Two professionals

- GIVEN a slot with ids `[12002, 13203]`
- WHEN the user selects that slot
- THEN a professional choice **SHALL** be required and Continue **SHALL** stay disabled until one is chosen

---

### REQ-9 Continue, vendor entry, and final submission

Los pasos de especialidad, centro, tratamiento y hora **SHALL** avanzar automáticamente ante una elección válida y **SHALL NOT** requerir botones **Continue**. El sistema **SHALL NOT** navegar directamente a una URL final del vendor solo por la selección.

Con un contexto de reserva válido, el módulo **SHALL** cargar la entrada del vendor (`GET …/cita_peticiones/new`) con parámetros coherentes con la selección, incluyendo `area=<area_id>`. Los campos ocultos obtenidos de `/new` **SHALL** tener **precedencia** sobre cualquier valor fijo por defecto (`NUBIMED_PORTAL_SUBMIT_FIXED_FIELDS`); los valores fijos **SHALL** usarse solo como fallback cuando el campo no exista en `/new` y **SHALL NOT** sobrescribir los valores scrapeados. El módulo **SHALL** completar solo los campos dinámicos de la selección. La reserva final **SHALL** hacerse con **`POST …/cita_peticiones`** con cuerpo `application/x-www-form-urlencoded` coherente con el formulario del vendor y la sesión actual.

#### Scenario: Camino feliz

- GIVEN contexto de reserva válido y datos de paciente y legales requeridos
- WHEN se confirma el envío final
- THEN el vendor **SHALL** recibir un envío cuyos campos de selección sean coherentes con la franja y el centro elegidos

#### Scenario: Hidden scrapeados prevalecen

- GIVEN `/new` devuelve `hay_areas=true`, `area_seleccionada=15073` y `clinica_tratamiento_obligatorio=true`
- WHEN se construye el cuerpo del POST
- THEN esos valores **SHALL** conservarse tal como los entrega el vendor
- AND ningún valor fijo por defecto **SHALL** reemplazarlos

#### Scenario: Campo ausente en /new

- GIVEN un campo con valor fijo por defecto que `/new` no incluye
- WHEN se construye el cuerpo del POST
- THEN el valor fijo **MAY** usarse como fallback

---

### REQ-10 Required UI states

The module **SHALL** represent at least: loading days, loading slots, no availability, network error, invalid or unexpected response, and **retry** where applicable. A notice that availability may change **SHALL** appear before confirming with Continue.

#### Scenario: Empty day list

- GIVEN the vendor returns an empty day list
- WHEN the user views the calendar step
- THEN an explicit **no availability** state **SHALL** show (not a generic network error)

---

### REQ-11 Vendor access via same-origin proxy

Antes del go-live en producción, el proyecto **SHALL** documentar el resultado de la validación (CORS, cookies, CSRF, WAF, reCAPTCHA) desde el origen público real. En producción, el flujo de reserva **SHALL** usar una **base same-origin** (`/__nubimed-proxy`) servida por una Cloudflare Pages Function; el spec **SHALL NOT** requerir un proxy off-origin. Si la validación falla, el comportamiento publicado **SHALL** degradarse mediante `bookingPublic` inactivo (REQ-1, REQ-18).

#### Scenario: Producción usa same-origin

- GIVEN el build de producción
- WHEN `BookingFlow` realiza peticiones al vendor
- THEN todas **SHALL** dirigirse a `/__nubimed-proxy/*` del mismo origen

#### Scenario: Validación fallida

- GIVEN la validación en preview o producción falla (WAF o reCAPTCHA)
- WHEN se decide el despliegue
- THEN `bookingPublic` **SHALL** permanecer inactivo y los CTAs **SHALL** mantener el comportamiento de release 1

---

### REQ-12 Secrets and public env

Secrets **SHALL NOT** be stored in `PUBLIC_*` variables. Vendor URL query parameters **SHALL** be built only from vendor responses or from non-secret configuration.

#### Scenario: Production build

- GIVEN only public env vars at build time
- WHEN the client bundle is emitted
- THEN server credentials **SHALL NOT** ship in the client

---

### REQ-13 Legal information and consent at booking capture

Before the user may submit a booking request to the vendor, the module **SHALL** show concise information identifying the **controller**, the **purpose** (appointment management), the **legal basis** (performance of a service), and that data **SHALL** be processed via the **Nubimed** platform as a processor following the controller's instructions. The module **SHALL** provide a **link** to the site's **privacy policy** in the **active locale**.

The module **SHALL** require an explicit, **not pre-checked** checkbox confirming acceptance of the privacy policy before final submission. A **separate** optional checkbox for commercial communications **SHALL** exist and **SHALL NOT** be pre-checked.

The module **SHALL** display the mandatory **reCAPTCHA** disclosure text required by Google's program, including links to Google's privacy policy and terms of service, near the consent area.

#### Scenario: Privacy checkbox not pre-checked

- GIVEN the user reaches the final booking confirmation step
- WHEN the privacy checkbox has not been checked
- THEN final submit **SHALL** be blocked and **SHALL** surface a message in the active locale

#### Scenario: Marketing optional and independent

- GIVEN the user reaches the final booking confirmation step
- WHEN the privacy checkbox is checked but the marketing checkbox is left unchecked
- THEN the user **SHALL** still be allowed to submit the appointment request (subject to other validations)

#### Scenario: Locale-correct privacy link

- GIVEN the site locale is Catalan
- WHEN the user activates the privacy policy link from the booking flow
- THEN the destination **SHALL** be the Catalan privacy policy path for this site

#### Scenario: reCAPTCHA disclosure visible

- GIVEN reCAPTCHA is used for the booking submission
- WHEN the user views the final confirmation step
- THEN disclosure text and Google policy links **SHALL** be visible without opening an external modal solely for that text

---

### REQ-14 Single-step stepper and automatic progression

El módulo **SHALL** comportarse como un stepper de **5 pasos** (especialidad, centro, tratamiento, día y hora, datos personales) con exactamente un paso visible a la vez. En los pasos de especialidad, centro y tratamiento el módulo **SHALL NOT** renderizar botones "Continue" y **SHALL** avanzar automáticamente ante una selección válida. En día y hora, seleccionar una hora válida (y profesional si se requiere) **SHALL** avanzar automáticamente a Datos personales. Los pasos omitidos por preset **SHALL** contarse como completados en el indicador del stepper. La etiqueta accesible del stepper **SHALL** estar localizada.

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
- WHEN el usuario selecciona una franja válida (y profesional si se requiere)
- THEN el paso de Datos personales **SHALL** ser el único visible

#### Scenario: Stepper localizado

- GIVEN el módulo en `ca`
- WHEN se inspecciona el `aria-label` del stepper
- THEN **SHALL** estar en catalán

---

### REQ-15 Date-time interaction and selection rules

Date & Time step **SHALL** show calendar first and times only after valid day selection. Past days and days without availability **SHALL NOT** be selectable. Days with availability **SHOULD** be visually emphasized using existing design-system tokens.

#### Scenario: Disable invalid dates

- GIVEN a past day or no-availability day
- WHEN the user attempts selection
- THEN the day **SHALL NOT** be selectable and no slot list **SHALL** load

#### Scenario: Show slots after day selection

- GIVEN Date & Time step is visible
- WHEN the user selects a valid available day
- THEN time slots for that day **SHALL** be shown

---

### REQ-16 Personal details variants and summary contract

Personal Details **SHALL** provide "New patient" (default) and "Returning patient". All active-variant fields **SHALL** be required. Returning patient **SHALL** require DNI and Fecha. Appointment summary **SHALL** include specialty, treatment/service, date, time, and the centro chosen, with its address.

The centro **SHALL** always appear in the summary as a link to Google Maps:

- The address **SHALL** be read at build time per centro from `PUBLIC_CLINIC_ADDRESS_BARCELONA` and `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL` (names **MAY** be refined in design; **SHALL** be documented in `.env.example`).
- If the centro's address variable is not defined, the summary **SHALL** show the Nubimed portal street address for that centro as fallback (`C. Calvet 16, Barcelona` for Barcelona; `C. de Mar 41, El Vendrell` for El Vendrell). The summary **SHALL NOT** show the address of another centro.
- The link target **SHALL** be the per-centro Maps URL from `PUBLIC_GOOGLE_MAPS_URL_BARCELONA` or `PUBLIC_GOOGLE_MAPS_URL_EL_VENDRELL` when defined; otherwise a Google Maps search URL built from the address shown.

#### Scenario: Returning patient required fields

- GIVEN Returning patient is selected
- WHEN DNI or Fecha is missing
- THEN final submission eligibility **SHALL** remain blocked

#### Scenario: Resumen con dirección por centro

- GIVEN un flujo válido con centro El Vendrell, `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL` definida y `PUBLIC_GOOGLE_MAPS_URL_EL_VENDRELL` definida
- WHEN se renderiza el resumen
- THEN **SHALL** mostrarse especialidad, tratamiento, centro, fecha, hora y esa dirección enlazada a la URL de Maps configurada

#### Scenario: Dirección ausente con fallback de Nubimed

- GIVEN centro Barcelona y `PUBLIC_CLINIC_ADDRESS_BARCELONA` no definida
- WHEN se renderiza el resumen
- THEN **SHALL** mostrarse la dirección de Nubimed `C. Calvet 16, Barcelona` enlazada a una búsqueda de Google Maps
- AND **SHALL NOT** mostrarse la dirección de otro centro

---

### REQ-17 Confirmation popup continuity

The existing confirmation popup **SHALL** be preserved and **SHALL** remain compatible with the current design system in this change.

#### Scenario: Popup remains active

- GIVEN user reaches confirmation stage
- WHEN confirmation is triggered
- THEN the existing popup **SHALL** appear with functional parity

---

### REQ-18 Site-wide booking CTAs route per `bookingPublic`

Un helper único `resolveBookingCta(lang, { preset? })` **SHALL** decidir el destino de cada CTA de reserva según el flag `bookingPublic`:

- **Activo**: el CTA **SHALL** enlazar a la página de reserva (`href(lang, 'booking')`), enlace interno sin `target`. Los CTAs genéricos ("Reservar cita" en cabecera y drawer móvil; "Solicitar valoración" en hero y CTA final de home) **SHALL** apuntar a la reserva **sin** preset. Los CTAs de capilar **SHALL** llevar `preset=386`; los de facial **SHALL** llevar `preset=3`.
- **Inactivo**: **SHALL** aplicarse el comportamiento de release 1: `https://wa.me/{PUBLIC_WHATSAPP_E164}` y, si falta la env, `href(lang, 'contact')`.

Los CTAs de corporal quedan fuera de alcance: **SHALL NOT** recibir trabajo dedicado y heredan el comportamiento por defecto del helper (reserva sin preset con flag activo).

#### Scenario: CTA genérico con flag activo

- GIVEN `bookingPublic` activo
- WHEN se renderizan los CTAs de cabecera, drawer, hero y CTA final de home
- THEN su `href` **SHALL** ser la ruta de reserva del locale sin `preset=`

#### Scenario: CTA capilar

- GIVEN `bookingPublic` activo
- WHEN se renderiza cualquier CTA de la página capilar o de la sección capilar de home
- THEN su `href` **SHALL** contener `preset=386`

#### Scenario: CTA facial

- GIVEN `bookingPublic` activo
- WHEN se renderiza cualquier CTA de la página facial
- THEN su `href` **SHALL** contener `preset=3`

#### Scenario: Flag inactivo con WhatsApp

- GIVEN `bookingPublic` inactivo y `PUBLIC_WHATSAPP_E164` definida
- WHEN se renderiza cualquier CTA de reserva
- THEN su `href` **SHALL** ser `https://wa.me/{PUBLIC_WHATSAPP_E164}`
- AND ningún `href` **SHALL** contener `preset=`

#### Scenario: Flag inactivo sin WhatsApp

- GIVEN `bookingPublic` inactivo y `PUBLIC_WHATSAPP_E164` no definida
- WHEN se renderiza cualquier CTA de reserva
- THEN su `href` **SHALL** ser `href(lang, 'contact')`

---

### REQ-19 External CTAs open in a new browser tab

Todo ancla cuyo `href` resuelva a `https://wa.me/{PUBLIC_WHATSAPP_E164}` **SHALL** llevar `target="_blank"` y `rel="noopener noreferrer"`. Los anclas que resuelvan a rutas internas (reserva o contacto) **SHALL NOT** definir `target`.

#### Scenario: Ancla externa de WhatsApp

- GIVEN `bookingPublic` inactivo y `PUBLIC_WHATSAPP_E164` definida
- WHEN se renderiza un CTA de reserva
- THEN el ancla **SHALL** incluir `target="_blank"` y `rel="noopener noreferrer"`

#### Scenario: Ancla interna de reserva

- GIVEN `bookingPublic` activo
- WHEN se renderiza un CTA de reserva
- THEN el ancla **SHALL NOT** definir `target`

---

### REQ-20 Area dimension in vendor requests

Toda petición al vendor que dependa de la sede **SHALL** incluir el `area_id` del centro elegido:

- Tratamientos: `GET /ajax/obtener_clinica_tratamientos` con `especialidad_id` y `area_id`.
- Días y franjas: `GET …/cita_peticiones/huecos_agenda` con `area_id=<area_id>` (no vacío).
- Entrada: `GET …/cita_peticiones/new` con `area=<area_id>`, y el mismo `area` dentro de `params_tracking`.

El módulo **SHALL NOT** enviar `area_id` vacío ni omitirlo. Los formatos de respuesta esperados (días como array ISO; franjas como `[iso, [userId], meta]`) **SHALL** permanecer sin cambios. `buildNewUrl` **SHALL** funcionar con una base relativa same-origin resolviéndola contra `location.origin` y **SHALL NOT** lanzar excepción por base relativa.

#### Scenario: Huecos con área

- GIVEN especialidad `386`, centro El Vendrell y tratamiento `389744`
- WHEN el módulo solicita días
- THEN la petición **SHALL** incluir `especialidad_id=386`, `clinica_tratamiento_id=389744` y `area_id=15073`

#### Scenario: Tratamientos con área

- GIVEN especialidad `3` y centro Barcelona
- WHEN el módulo solicita tratamientos
- THEN la petición **SHALL** incluir `area_id=15070`

#### Scenario: Entrada /new con área

- GIVEN una franja elegida en el centro Barcelona de la especialidad `386`
- WHEN el módulo construye la URL de `/new`
- THEN la URL **SHALL** incluir `area=15071` y `pref_tratamiento` del catálogo

#### Scenario: Base relativa

- GIVEN la base same-origin `/__nubimed-proxy` en el navegador
- WHEN se construye la URL de `/new`
- THEN la construcción **SHALL** resolverse contra `location.origin` sin lanzar

---

### REQ-21 Same-origin proxy on Cloudflare Pages Functions

El proxy **SHALL** implementarse como Cloudflare Pages Function en `/__nubimed-proxy/*` y **SHALL**:

- Aceptar únicamente métodos y rutas de una **allowlist** correspondiente a los endpoints del portal usados por el flujo (tratamientos, huecos, `new`, `POST cita_peticiones`); cualquier otro método o ruta **SHALL** rechazarse y **SHALL NOT** reenviarse al vendor.
- Reenviar solo a la clínica 1212 del host del vendor configurado.
- Gestionar cookies de sesión, `Referer` y, cuando aplique, `Origin` necesarios para el vendor, sin exponer `Domain` del vendor al navegador.
- No seguir redirecciones automáticamente.
- Responder con `Cache-Control: no-store` y **SHALL NOT** cachear respuestas.
- **SHALL NOT** registrar en logs cuerpos de petición ni de respuesta ni datos de pacientes.

No **SHALL** añadirse un adaptador de Astro; el sitio sigue siendo estático en origen.

#### Scenario: Ruta permitida

- GIVEN una petición `GET /__nubimed-proxy/ajax/obtener_clinica_tratamientos?…`
- WHEN la Function la procesa
- THEN **SHALL** reenviarse al vendor y responder con `Cache-Control: no-store`

#### Scenario: Ruta o método no permitido

- GIVEN una petición a una ruta fuera de la allowlist o con método no permitido
- WHEN la Function la procesa
- THEN **SHALL** rechazarse sin llamar al vendor

#### Scenario: Sin logs de datos de paciente

- GIVEN un `POST` con datos personales
- WHEN la Function lo reenvía
- THEN el cuerpo **SHALL NOT** aparecer en ningún log

#### Scenario: Sin cacheo

- GIVEN dos peticiones idénticas de huecos
- WHEN ambas pasan por el proxy
- THEN cada una **SHALL** consultar al vendor y **SHALL NOT** servirse desde caché

---

### REQ-22 Localized labels for booking CTAs

Todos los textos visibles de CTAs de reserva **SHALL** existir en es, en, ca y fr en el idioma correspondiente. El CTA final de la página capilar en `en`, `ca` y `fr` **SHALL** usar el wording de "diagnóstico" equivalente a es (no "Book Medical Appointment"). Los CTAs de home que hoy están en español en `en`, `ca` y `fr` (hero y CTA final) **SHALL** estar traducidos al locale.

#### Scenario: CTA final capilar en inglés

- GIVEN la página capilar en `en`
- WHEN se renderiza el CTA final
- THEN su etiqueta **SHALL** expresar solicitud de diagnóstico capilar y **SHALL NOT** ser "Book Medical Appointment"

#### Scenario: CTAs de home traducidos

- GIVEN la home en `en`, `ca` o `fr`
- WHEN se renderizan el CTA del hero y el CTA final
- THEN sus etiquetas **SHALL** estar en el idioma del locale y **SHALL NOT** estar en español

---

### REQ-23 Real submission acceptance

Antes de activar `bookingPublic` en producción, el equipo **SHALL** completar una **verificación manual** de envío real en preview o producción: una cita de prueba por el flujo completo (incluido reCAPTCHA) cuyo `POST …/cita_peticiones` devuelva **201**, que figure en el centro elegido y que la clínica cancele después. Esta verificación **SHALL** registrarse en el informe de verify.

#### Scenario: Cita de prueba

- GIVEN el flujo desplegado en preview o producción con proxy activo
- WHEN se completa una reserva real de prueba en un centro
- THEN el `POST` **SHALL** devolver 201
- AND la cita **SHALL** aparecer en el centro elegido en el panel de la clínica

#### Scenario: Verificación fallida

- GIVEN el POST no devuelve 201 o reCAPTCHA rechaza el dominio
- WHEN se evalúa el go-live
- THEN `bookingPublic` **SHALL** permanecer inactivo
