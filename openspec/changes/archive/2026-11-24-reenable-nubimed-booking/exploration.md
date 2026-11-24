# Exploración: reenable-nubimed-booking

**Fecha**: 2026-11-21 · **Fase**: sdd-explore · **Siguiente**: sdd-propose (bloqueado parcialmente por Q1/Q2)

## Contexto de entrada (confirmado por el usuario)

- Clínica Nubimed nueva: **1212** (`https://portal.clinicaenlanube.com/clinicas/1212/cita_peticiones/new`). Env actualizadas por el usuario.
- Áreas = **sedes geográficas**.

**Mapeo VERIFICADO contra el portal en vivo (2026-11-21)** — prevalece sobre la tabla facilitada a mano (que tenía los `area_id` cruzados entre especialidades). Fuente: `<select id="cuenta_area_id">` con `data-especialidad` del widget y `obtener_clinica_tratamientos` por área.

| Especialidad | Sede | area_id | Primera visita (45 min, 100 €) | Tratamientos |
|---|---|---|---|---|
| Medicina estética (3) | Barcelona (C. Calvet 16) | **15070** | 389741 | 389745 (BTX, FILLERS, BIOESTIMUL, IPL, PRP) |
| Medicina estética (3) | El Vendrell (C. de Mar 41) | **15072** | 389742 | 389746 (BTX, FILLERS, BIOESTIMUL, PRP) |
| Tricología (386) | Barcelona (C. Calvet 16) | **15071** | 389743 | 389747 (MESO, PRP) |
| Tricología (386) | El Vendrell (C. de Mar 41) | **15073** | 389744 | 389748 (MESO, PRP) |

Todos los tratamientos: `data-modalidad="presencial"`, `data-conceptos="false"`.

- Hosting: **IONOS → Cloudflare**.
- Routing de CTAs pedido: genéricos "Reservar cita" **y "Solicitar valoración"** → booking sin preset (Q3 resuelta 2026-11-21); capilar → preset 386; facial → preset 3.
- **Nuevo (2026-11-21)**: botón flotante de WhatsApp en la **home**, sticky abajo a la derecha, que abre el chat (`wa.me/${PUBLIC_WHATSAPP_E164}`). Icono de WhatsApp con **colores corporativos, no verde** (ver §8).

## Resumen ejecutivo

`BookingFlow` no está montado; catálogo, builder de URL y campos del POST asumen la clínica vieja sin áreas. Reactivar requiere: (1) catálogo nuevo especialidad → sede → tratamiento, (2) dimensión `area` en todas las requests al vendor, (3) proxy same-origin en Cloudflare. El rewire de CTAs es mecánico (helper con opción `preset`). Recomendado: catálogo estático de especialidad/sede, tratamientos live (o estáticos si el endpoint no acepta `area_id`) y feature flag `bookingPublic` para rollback.

## 1. Inventario de CTAs

Todos usan `resolveBookingCta(lang)` (hoy → WhatsApp / contacto).

| Archivo:línea | Label es | Hoy | Propuesto |
|---|---|---|---|
| `layouts/BaseLayout.astro:86,159-166` (header desktop) | `nav.ts:40` "RESERVAR CITA" | WhatsApp | Booking genérico |
| `components/PrimaryNav.astro:53-60` (drawer móvil) | idem | WhatsApp | Booking genérico |
| `home/HomeHero.astro:54-61` | "SOLICITAR VALORACIÓN" | WhatsApp | Booking genérico (Q3) |
| `home/HomeCapillary.astro:42-49` | "SOLICITAR DIAGNÓSTICO CAPILAR" | WhatsApp | Preset 386 |
| `home/HomeFinalCta.astro:27-32` | "SOLICITAR VALORACIÓN" (en es en los 4 locales) | WhatsApp | Booking genérico (Q3) |
| `facial/FacialHero.astro:33-38` | "Solicitar valoración facial" | WhatsApp | Preset 3 |
| `facial/FacialPillarPage.astro:20,49-56` → FinalCta | idem | WhatsApp | Preset 3 |
| `capilar/CapilarPillarPage.astro:39-44` (hero) | "Solicitar diagnostico capilar" | WhatsApp | Preset 386 |
| `capilar/CapilarPillarPage.astro:177-184` (FinalCta) | es diagnóstico; en/ca/fr "Book Medical Appointment" | WhatsApp | Preset 386 |
| `corporal/CorporalPillarPage.astro:39-46,202-209` | "Solicitar valoración corporal" (página diferida) | WhatsApp | Preset 3 o genérico (Q6) |
| `components/FinalCta.astro:17-19` | fallback a `resolveBookingCta` | WhatsApp | Mantener fallback; pilares pasan href explícito |
| `pages/[lang]/[segment].astro:39,108-122` | placeholder WhatsApp | Placeholder | Montar `BookingFlow` |

**Se mantienen**: `TrustPage.astro` (WhatsApp secundario; "Solicitar valoración" → contacto). No existe botón flotante de WhatsApp. `ValoracionForm.astro` no se importa en ningún sitio.

**Gaps i18n existentes**: `home-content.ts` `finalCta.cta` en español en los 4 locales; `ctaPrimary` hero en es para en (ca/fr probablemente heredan); semántica de `finalCta.primary` capilar inconsistente entre locales.

**Forma**: `resolveBookingCta(lang, { preset? })`; con booking activo devuelve `bookingUrlWithPreset` / `href(lang,'booking')` (`external:false`). Añadir `BOOKING_PRESET_VENDOR_TRICOLOGIA = '386'`. Flag `bookingPublic` en `site-features.ts` (patrón `blogPublic`/`corporalPublic`).

## 2. Máquina de estados de BookingFlow

- `Phase = pick | details | success`; `PickStep = specialty | treatment | datetime`; stepper hardcodeado `[1,2,3,4]` (l. 893).
- Presets leídos de `window.location.search` en `useLayoutEffect` (188-200). **Bug**: si la prop viene no vacía, retorna antes y no lee `?treatment=`.
- `loadTreatments` → `fetchTreatmentsBySpecialty` (sin `area_id`); ids compuestos `${vendorId}-${optionId}`; auto-match de preset (290-302).
- **Paso sede**: `PickStep = specialty | area | treatment | datetime`. Preset válido de especialidad → salta a `area`; param `sede` válido salta `area`.
- Tocar: estado `area`; `loadTreatments/loadDays/loadSlots`; effects 224-233, 281-288, 430-442, 534-547; `newUrlSelection` (336-350); `onFinalize` (752-830); `resetAfterSuccess`; resumen (1312-1331, `locationLabel` por sede); stepper a 5 pasos.
- Montaje: `<BookingFlow client:load lang clinicAddress />` sin preset por prop (static build).
- i18n (`booking-nubimed/i18n.ts`, 4 locales): añadir `selectArea`, `areaStepDescription`, `areaLabel`; quitar `missingVendorTreatmentId`; `invalidPreset` cubre sede; `aria-label="Booking steps"` (l. 892) hardcodeado en inglés. Labels del catálogo actual sin tildes.

## 3. Campos del vendor que pasan a dinámicos

| Dónde | Hoy | Necesario |
|---|---|---|
| `client.ts:157` huecos | `area_id=''` | `area_id=<areaId>` |
| `client.ts:108-133` tratamientos | sin área | probablemente `area_id` (Q2) |
| `build-new-url.ts:32` y `:49` (params_tracking) | `area=undefined` | `area=<id>` |
| `NewUrlSelection` | sin área | `areaId` |
| `nubimed-portal-submit-fields.ts:19-20` | `hay_areas:'false'`, `area_seleccionada:''` | `'true'`, `<areaId>` |
| idem l. 26 | `hay_mas_de_una_especialidad:'false'` | `'true'` |
| idem l. 16, 18 | `maximo_dias:'91'`, `hay_tratamientos:'true'` | verificar con widget 1212 |
| `booking-submit-merge.ts:102` | FIXED_FIELDS pisa hidden scrapeados de `/new` | no pisar flags del vendor; solo setear dinámicos |
| `config.ts:4` | `3\|4\|5`, `244529` | obsoleto |

## 4. Diseño del catálogo

| Opción | Pros | Contras |
|---|---|---|
| A. Estático completo | Determinista, labels/direcciones por locale | Deriva si cambian el panel |
| B. Dinámico completo | Siempre sincronizado | Endpoints desconocidos, scraping frágil, sin i18n |
| C. Híbrido: especialidad+sede estáticos, tratamientos live con `area_id`, fallback estático | Control de labels + tratamientos al día | Depende de Q2 |

**Recomendado: C** (fallback a A si Q2 descarta `area_id`). Forma: `{ vendorId: 3|386, slug, matchKeys, labels, areas: [{ key: 'barcelona'|'el-vendrell', areaId, labels, address, firstVisitTreatmentId, treatmentsTreatmentId }] }`. `preset` acepta slug o id; alias `capilar`/`hair` → 386. Nuevo param opcional `sede`.

Ambigüedad: el id "Tratamientos" (389745…) ¿es un tratamiento genérico con conceptos (`pref_conceptos`) o varios? (Q1).

## 5. Proxy en Cloudflare

Replicar: strip `/__nubimed-proxy`; `Referer` a `.../clinicas/<id>/cita_peticiones/widget` (también para `/ajax/obtener_clinica_tratamientos` vía `clinica_id`); posible `Origin` en POST; reescritura de `Set-Cookie` (sin `Domain`, `getSetCookie()`); `redirect:'manual'`; `Cache-Control: no-store`; **allowlist** de métodos/paths (no open proxy); no loggear bodies (datos de pacientes). Riesgo: WAF del vendor bloqueando IPs de Cloudflare.

Encaje: build estático sin adapter. Pages → `functions/__nubimed-proxy/[[path]].ts`; Workers static assets → `wrangler.jsonc` con `run_worker_first: ['/__nubimed-proxy/*']` (Q5). Worker en otro host = cross-origin, no recomendado. (No verificado contra docs de Cloudflare; confirmar en design.)

**Gotcha**: `buildNewUrl` hace `new URL(...)`; base relativa lanza. Producción necesita base absoluta o resolver contra `location.origin`; same-origin debería ser el default en producción.

**Conflicto de gobernanza**: Function/Worker = BFF. Choca con `AGENTS.md` (Ask first hosting; Never Node/SSR IONOS; "No BFF") y REQ-11. Actualizar en el mismo cambio. Añadir `Disallow: /__nubimed-proxy/` en `robots.txt.ts`.

## 6. reCAPTCHA

Site key extraída del HTML de `/new` (no env). Riesgos: dominio de producción no autorizado en la key del vendor; verificación vía proxy; CSP futura debe permitir `google.com/recaptcha`.

## 7. Drift de docs/spec

- `AGENTS.md` (l. 36, 45, 77, 80, 91-92), `docs/stack-and-deployment-context.md` (8, 18-21, 35, 47, 62-72), `README.md` (50, 96), `docs/site-architecture.md` (14, 25, 38, 43-46, 50, 72), `.env.example` (no legible).
- Spec `web-booking-nubimed-client`: REQ-1, 3, 4/5, 7, 9/14, 11, 16, 18/19 + Purpose.
- Código/copy: stub `reservar-cita` y `bookingPlaceholderCta` (`page-stubs.ts`); comentario de `BOOKING_PRESET_VENDOR_MEDICINA_ESTETICA`; `ContactPage` con una sola dirección (fuera de alcance, flag).

## 7b. Captura en vivo del portal 1212 (2026-11-21, navegador integrado, sin enviar cita)

Flujo del widget oficial (`/clinicas/1212/cita_peticiones/widget`): especialidad → área → servicio → calendario → franja → `/new`.

1. **Widget hidden fields** (bootstrap): `clinica=1212`, `maximo_dias=91`, `clinica_tratamiento_obligatorio=true`, `hay_tratamientos=true`, `hay_areas=true`, `area_seleccionada=''`, `hay_mutuas=false`, `hay_mas_de_una_especialidad=true`, `lanzar_busqueda_al_iniciar=false`, `url_portal_cita=…/clinicas/1212/cita_peticiones/new`. Selects: `clinica_especialidad_id` (3, 386), `cuenta_area_id` (opciones con `data-especialidad`), `clinica_tratamiento_id`.
2. **Tratamientos**: `GET /ajax/obtener_clinica_tratamientos?locale=es&clinica_id=1212&especialidad_id=<esp>&area_id=<area>` → `<option data-modalidad data-conceptos value>`. **Q2 resuelta**: acepta `area_id`; sin él devuelve los tratamientos de las dos sedes mezclados con labels duplicados → `area_id` es obligatorio en la práctica.
3. **Días**: `GET /clinicas/1212/cita_peticiones/huecos_agenda?locale=es&role_id=undefined&especialidad_id=386&dia_seleccionado=&clinica_tratamiento_id=389744&clinica_mutua_id=&area_id=15073&tipo_horario=presencial` → array de ISO (`"2026-11-25T09:00:00+01:00"`). Mismo formato que hoy.
4. **Franjas**: igual con `dia_seleccionado=25/11/2026` → `[[iso, [userId], {day_of_week, day_of_week_iso8601}], …]`. Mismo formato que hoy.
5. **/new**: `GET …/cita_peticiones/new?origen=widget&pref_hora=<iso>&pref_users_dispo=21022&especialidad=386&area=15073&pref_tratamiento=389744&agenda=undefined&mutua=undefined&pref_tipo_horario=presencial&prepago_total=false&pref_conceptos=` → solo cambia `area=<id>` respecto a `buildNewUrl`.
6. **Form POST** (`action=/clinicas/1212/cita_peticiones`, no enviado). Hidden que el portal ya rellena: `area_seleccionada=15073`, `hay_areas=true`, `clinica_tratamiento_obligatorio=true`, `hay_mas_de_una_especialidad=false` (en `/new` vale false aunque en el widget valga true), `params_tracking` (ordenado alfabéticamente, `pref_hora` url-encoded), `origen_widget=true`, `cargar_paso_detalles=true`, `token_pac`, `email_obligatorio=true`. reCAPTCHA presente.

**Conclusiones para el diseño**:
- `NUBIMED_PORTAL_SUBMIT_FIXED_FIELDS` actual es **incorrecto** para 1212 (`clinica_tratamiento_obligatorio:'false'`, `hay_areas:'false'`, `area_seleccionada:''`). Como `booking-submit-merge.ts:102` aplica FIXED_FIELDS al final, **pisaría** los hidden correctos. Decisión recomendada: confiar en los hidden scrapeados de `/new` y dejar FIXED_FIELDS solo como fallback (aplicado antes, no después).
- Catálogo: **opción A (estático completo) es viable y suficiente** — los 8 IDs están verificados, no hay conceptos. Fetch live de tratamientos queda opcional.
- Q1 resuelta: "Tratamientos (…)" es **un único tratamiento** por área; BTX/FILLERS/… son solo texto del label (`conceptos=false`).
- Cambios mínimos en requests: añadir `area_id` en tratamientos y huecos, y `area` en `/new`. Formatos de respuesta sin cambios.

## 8. Botón flotante de WhatsApp (home)

- Hoy no existe ningún botón flotante. Al rehabilitar booking, WhatsApp deja de ser el destino de los CTAs y pasa a ser un **canal secundario** visible solo como flotante en la home (más los enlaces ya existentes de `TrustPage`).
- Href: mismo patrón que `TrustPage.astro` / `resolveBookingCta` → `https://wa.me/${PUBLIC_WHATSAPP_E164}`; si la env falta, **no renderizar** el botón (no fallback a contacto).
- Colores: tokens de `src/styles/theme.css` — candidatos `--color-accent` (#5b594f) de fondo con glifo `--color-on-accent` (#fafaf8), o `--color-champagne` (#c9ad7a) como acento. Validar contraste AA del glifo y del foco.
- Componente Astro sin hidratación (es un `<a>`), CSS en `src/styles/components/`, SVG inline del glifo con `aria-label` traducido en los 4 locales, `target="_blank" rel="noopener noreferrer"`, safe-area (`env(safe-area-inset-*)`), `motion-safe:` para cualquier entrada animada, z-index por encima del contenido y por debajo del banner de cookies/drawer móvil.
- Montaje: solo en `src/pages/[lang]/index.astro` (home). Verificar que no tape el banner de consentimiento ni el CTA del drawer móvil.
- Abierto: ¿solo home o todo el sitio salvo booking? (el usuario pidió home).

## Enfoque recomendado

1. Un cambio con fases: catálogo + plumbing de área → paso sede en BookingFlow → helper CTA + callsites → proxy Cloudflare → docs/spec.
2. Flag `bookingPublic` (off = WhatsApp) para rollback.
3. Catálogo híbrido C.
4. Proxy same-origin con allowlist y manejo de cookie/Referer/Origin.
5. Booking sigue `noindex`, fuera de sitemap y nav principal.

## Riesgos (priorizados)

1. Comportamiento del vendor con áreas desconocido → requiere captura live (bloquea design).
2. Viabilidad del proxy (cookies/Referer/Origin, WAF).
3. FIXED_FIELDS pisando hidden scrapeados.
4. reCAPTCHA y dominio de producción.
5. Gobernanza AGENTS.md (requiere aprobación explícita + docs).
6. Base de proxy relativa rompe `buildNewUrl`.
7. Datos de pacientes por nuestro Worker (texto legal REQ-13, sin logs).
8. Jerarquía de CTAs: con "Solicitar valoración" → booking, `docs/site-architecture.md` (valuation-first; booking secundario y fuera de nav) queda desalineado y debe actualizarse en el cambio.
9. Gaps i18n existentes más expuestos.

## Preguntas abiertas

1. ~~Captura del portal 1212~~ **Resuelta** (§7b). Pendiente solo: body real de un POST 201 (no se envió ninguna cita).
2. ~~¿`obtener_clinica_tratamientos` acepta `area_id`?~~ **Resuelta**: sí, y es necesario.
3. ~~¿"Solicitar valoración" genérico → booking o formulario?~~ **Resuelta**: booking sin preset.
4. Direcciones de sede: ¿catálogo (copy) o env `PUBLIC_CLINIC_ADDRESS_*`?
5. ¿Cloudflare Pages o Workers static assets? ¿Deploy git o wrangler? ¿Dominio en DNS de Cloudflare?
6. CTAs corporal: ¿preset 3 o genérico? (puede esperar)
7. ¿Alinear labels en/ca/fr del FinalCta capilar con "diagnóstico" en este cambio?

Nota: `gate-checklist.md` y `design.md` del cambio archivado de mayo están en UTF-16 y no se revisaron.
