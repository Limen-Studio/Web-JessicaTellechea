# Tasks: Reactivar la reserva Nubimed (clínica 1212, con centros)

Reglas del cambio: diff mínimo, sin refactors colaterales; cuatro locales es/en/ca/fr; `href(lang, iaKey)`; tokens del tema; booking `noindex`; corporal fuera de alcance (ningún archivo de `corporal/` se edita). `bookingPublic` se mantiene en `false` hasta la Phase 8 (el sitio conserva el comportamiento de release 1 y cada fase deja `npm run check` en verde). Strict TDD desactivado: no hay runner de tests. Los apply batches solo ejecutan `npm run check`; `npm run build`, `lint:encoding` y los checks de preview son pasos manuales de la Phase 8 (verify).

## Phase 1: Catálogo, tipos y env

- [x] 1.1 `src/features/booking-nubimed/config.ts`: añadir `CentroKey`, `CENTROS` (labels es/en/ca/fr de Barcelona / El Vendrell), `SpecialtyCentro`, `TREATMENT_KIND_LABELS`; reemplazar `SPECIALTY_CATALOG` por entradas `3` (`medicina-estetica`) y `386` (`tricologia`, alias `capilar`, `hair`, `medicina-capilar`) con los 8 ids verificados (exploration §7b); eliminar `4`, `5`, `244529` y `clinicaTratamientoId`. Labels con tildes correctas. (REQ-3, AD-1)
- [x] 1.2 `src/features/booking-nubimed/config.ts`: añadir helpers `centroFor(entry, key)` y `centroAddressesFromEnv()` con accesos literales `import.meta.env.PUBLIC_CLINIC_ADDRESS_BARCELONA` / `..._EL_VENDRELL`. (REQ-16, AD-9)
- [x] 1.3 `src/env.d.ts`: tipar `PUBLIC_CLINIC_ADDRESS_BARCELONA` y `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL` (opcionales). (AD-9)
- [x] 1.4 `src/features/booking-nubimed/types.ts`: `BookingFlowProps.centroAddresses?: Partial<Record<CentroKey, string>>` en lugar de `clinicAddress`; `PickStep` con `'area'`; `TreatmentOption.areaId: number`; eliminar `SpecialtySelection` si queda sin uso. (AD-3, AD-9)
- [x] 1.5 `npm run check`; corregir los consumidores rotos por el cambio de catálogo/tipos solo con el diff mínimo (el cableado completo llega en la Phase 3).

## Phase 2: Plumbing vendor (cliente, URL, merge)

- [x] 2.1 `src/features/booking-nubimed/build-new-url.ts`: `NewUrlSelection.areaId: number`; `buildNewUrl` y `buildTrackingInnerQuery` usan `area=<areaId>`; resolver con `new URL(path, globalThis.location?.origin ?? 'http://localhost')` conservando el prefijo de la base relativa sin lanzar. (REQ-20, AD-5, AD-6)
- [x] 2.2 `src/features/booking-nubimed/client.ts`: `nubimedBaseUrl()` devuelve `PUBLIC_NUBIMED_PROXY_URL` si existe (regla de localhost solo en dev) o `'/__nubimed-proxy'`; eliminar el fallback al origen directo del vendor. (REQ-11, AD-6)
- [x] 2.3 `src/features/booking-nubimed/client.ts`: `fetchTreatmentsBySpecialty` exige `areaId` y envía `area_id`; `fetchDayStrings` y `fetchSlots` reciben `areaId` y setean `area_id` (nunca vacío). Formatos de respuesta sin cambios. (REQ-20, AD-2)
- [x] 2.4 `src/features/booking-nubimed/nubimed-portal-submit-fields.ts`: corregir `FIXED_FIELDS` a 1212 (`clinica_tratamiento_obligatorio:'true'`, `hay_areas:'true'`, `hay_mas_de_una_especialidad:'false'`) y quitar `area_seleccionada`. (REQ-9, AD-5)
- [x] 2.5 `src/features/booking-nubimed/booking-submit-merge.ts`: invertir precedencia (`FIXED < runtime < fieldDefaults`, luego borrar `EXCLUDED`); `params_tracking` y `area_seleccionada` con `fieldDefaults.x || derivado`; mantener `merged.x || default` en `origen_widget`, `cargar_paso_detalles` y `*_obligatorio`; selección/paciente/forzados al final; quitar el `Object.assign(... FIXED_FIELDS ...)` final. (REQ-9, AD-5)
- [x] 2.6 `npm run check`.

## Phase 3: BookingFlow (paso centro) e i18n

- [x] 3.1 `src/features/booking-nubimed/i18n.ts`: añadir `selectArea`, `areaStepDescription`, `areaLabel`, `stepsAriaLabel` en es/en/ca/fr (copy "centro"); quitar `missingVendorTreatmentId` si queda sin uso. (REQ-14, AD-11)
- [x] 3.2 `src/features/booking-nubimed/BookingFlow.tsx`: fix del `useLayoutEffect` para leer siempre `window.location.search` (`preset = prop || url.preset`; `treatment` y `sede` siempre de la URL). (REQ-4, AD-3)
- [x] 3.3 `BookingFlow.tsx`: estado `centro` + `resolvedSede`; derivados `sedeEntry`, `invalidSede` (se suma a `invalidPreset`); paso inicial según preset/sede válidos. (REQ-4, REQ-5, AD-3)
- [x] 3.4 `BookingFlow.tsx`: derivar `treatmentOptions` con `useMemo` desde `(specialty, centro, lang)` (2 opciones por centro, id `${vendorId}-${treatmentId}`, `areaId`); eliminar el efecto `loadTreatments`, `treatmentsLoading/treatmentsErr` y su UI; auto-match de `?treatment=` solo dentro del centro activo. (REQ-3, AD-2, AD-4)
- [x] 3.5 `BookingFlow.tsx`: paso `area` (UI de selección, `onCentroPick` limpia tratamiento/día/franja/profesional; `onSpecialtyChange` limpia centro y posteriores); navegación Atrás treatment → area/specialty y area → specialty. (REQ-7, REQ-14, AD-3)
- [x] 3.6 `BookingFlow.tsx`: `loadDays`/`loadSlots` leen `selectedTreatment.areaId`; `newUrlSelection` y `onFinalize` pasan `areaId` y sin fallback a `clinicaTratamientoId`; conservar el abort de respuestas obsoletas. (REQ-7, REQ-20, AD-3)
- [x] 3.7 `BookingFlow.tsx`: stepper `[1..5]` (specialty 1, area 2, treatment 3, datetime 4, details 5), renumerar `stepLabel(n)`, `aria-label={strings.stepsAriaLabel}`, pasos omitidos por preset contados como completados; reset tras éxito conserva especialidad/centro del preset. (REQ-14, AD-3)
- [x] 3.8 `BookingFlow.tsx`: resumen con fila de centro (label) y dirección de `centroAddresses[centro.centro]` solo si existe, sin fallback a otra dirección. (REQ-16, AD-3, AD-9)
- [x] 3.9 `src/pages/[lang]/[segment].astro`: rama `booking` con `bookingPublic ? <BookingFlow client:load lang centroAddresses={centroAddressesFromEnv()} /> : placeholder actual`; mantener `noindex` y el placeholder + `bookingPlaceholderCta` para flag off. Importar `bookingPublic` de `site-features`. (REQ-1, AD-8)
- [x] 3.10 `src/i18n/site-features.ts`: añadir `export const bookingPublic = false;` (patrón `blogPublic`) con comentario de que se activa en la Phase 8. (REQ-1, AD-8)
- [x] 3.11 `npm run check`.

## Phase 4: Helper de CTA, callsites y labels

- [x] 4.1 `src/i18n/booking-links.ts`: `BOOKING_PRESET_VENDOR_TRICOLOGIA = '386'` y corregir el comentario de `BOOKING_PRESET_VENDOR_MEDICINA_ESTETICA` (`'3'`). (AD-8)
- [x] 4.2 `src/i18n/booking-links.ts`: `resolveBookingCta(lang, opts?: { preset?: string })`; con `bookingPublic` → `{ href: preset ? bookingUrlWithPreset(lang, preset) : href(lang, 'booking'), external: false }`; si no → comportamiento actual (wa.me / contact, `external` según corresponda). (REQ-18, REQ-19, AD-8)
- [x] 4.3 Capilar → `resolveBookingCta(lang, { preset: BOOKING_PRESET_VENDOR_TRICOLOGIA })` en `src/components/home/HomeCapillary.astro` y `src/components/capilar/CapilarPillarPage.astro` (hero + `FinalCta` vía `bookingCta`). (REQ-18)
- [x] 4.4 Facial → `resolveBookingCta(lang, { preset: BOOKING_PRESET_VENDOR_MEDICINA_ESTETICA })` en `src/components/facial/FacialHero.astro` y `src/components/facial/FacialPillarPage.astro`. (REQ-18)
- [x] 4.5 Verificar que los callsites genéricos quedan sin preset y sin cambios: `src/layouts/BaseLayout.astro`, `src/components/PrimaryNav.astro`, `src/components/home/HomeHero.astro`, `src/components/home/HomeFinalCta.astro`, `src/components/FinalCta.astro`, `src/pages/[lang]/[segment].astro`. No tocar `src/components/corporal/**`. (REQ-18, AD-8)
- [x] 4.6 `src/i18n/home-content.ts`: traducir `hero.ctaPrimary` y `finalCta.cta` en en/ca/fr (hoy en español). (REQ-22, AD-11)
- [x] 4.7 `src/i18n/capilar-page.ts`: `finalCta.primary` en en/ca/fr con wording de "diagnóstico" equivalente a es. (REQ-22, AD-11)
- [x] 4.7b `src/i18n/page-stubs.ts` + `src/pages/[lang]/[segment].astro`: con `bookingPublic` el `<h1>`/lead de la ruta booking NO deben decir "por WhatsApp" (hoy `pageStubsBySegment['reservar-cita']`: "Reserva tu cita por WhatsApp…"). Añadir copy de booking online es/en/ca/fr (p. ej. `bookingOnlineStub`) y elegirlo según el flag; con flag off se mantiene el copy actual. También `title`/`description` del layout. (REQ-1, REQ-22) — *añadida por el orquestador tras revisar el lote 1-3.*
- [x] 4.8 `npm run check`.

## Phase 5: Botón flotante de WhatsApp (home)

- [x] 5.1 `src/i18n/home-content.ts`: añadir `whatsappFloat.ariaLabel` en es/en/ca/fr (acentos correctos). (REQ-4 floating, AD-10)
- [x] 5.2 `src/components/WhatsAppFloat.astro`: prop `lang`; sin `PUBLIC_WHATSAPP_E164` no renderiza nada; con env, `<a class="whatsapp-float" href="https://wa.me/…" target="_blank" rel="noopener noreferrer" aria-label>` con SVG inline `aria-hidden="true"` y `fill="currentColor"`, sin hidratación. (REQ-1..4 floating, AD-10)
- [x] 5.3 `src/styles/components/whatsapp-float.css` + import en `components.css`: `position: fixed` con `env(safe-area-inset-*)`, fondo `--color-accent`, glifo `--color-on-accent`, foco con doble anillo, `z-index: 30` (< drawer 35, header 40, cookies 90), hover solo bajo `prefers-reduced-motion: no-preference`; sin hex literales ni verde WhatsApp. (REQ-2, REQ-5, REQ-6 floating, AD-10)
- [x] 5.4 `src/pages/[lang]/index.astro`: montar `<WhatsAppFloat lang={lang} />` al final; ninguna otra página lo monta. (REQ-1 floating, AD-10)
- [x] 5.5 `npm run check`.

## Phase 6: Proxy Cloudflare Pages Function y robots

- [x] 6.1 `functions/__nubimed-proxy/[[path]].ts`: `onRequest` con contexto tipado local (`{ request; env }`), lectura de `PUBLIC_NUBIMED_CLINICA_ID` (entero > 0; si falta, 503 fail-closed) y `PUBLIC_NUBIMED_VENDOR_ORIGIN` (`https:`, default `https://portal.clinicaenlanube.com`). (REQ-21, AD-7)
- [x] 6.2 Misma Function: allowlist (`GET …/cita_peticiones/(widget|huecos_agenda|new)`, `POST …/cita_peticiones` exacto, `GET /ajax/obtener_clinica_tratamientos` solo con `clinica_id={id}`); otra ruta → 404, otro método → 405, sin llamar al vendor. (REQ-21, AD-7)
- [x] 6.3 Misma Function: request con solo `Accept`, `Accept-Language`, `Content-Type`, `X-Requested-With`, `X-CSRF-Token`, `Cookie`; `Referer` al widget; `Origin` en POST; `redirect: 'manual'`; body en stream. (REQ-21, AD-7)
- [x] 6.4 Misma Function: respuesta con status y `Content-Type`; `Set-Cookie` vía `getSetCookie()` sin `Domain=`; reescritura de `Location` absoluto al vendor; `Cache-Control: no-store` y `X-Robots-Tag: noindex, nofollow`; sin `console.*` con bodies/query/cookies. (REQ-21, AD-7)
- [x] 6.5 `src/pages/robots.txt.ts`: añadir `Disallow: /__nubimed-proxy/`. (REQ-1, AD-7)
- [x] 6.6 `npm run check` (tipa `functions/` por `tsconfig` `**/*`; sin añadir wrangler ni `@cloudflare/workers-types`).

## Phase 7: Docs, .env.example y AGENTS

- [ ] 7.1 (BLOCKED: `.env.example` denegado por permisos; el usuario debe añadir las líneas, ver apply-progress) `.env.example`: documentar `PUBLIC_CLINIC_ADDRESS_BARCELONA`, `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL`, y las variables que lee la Function (`PUBLIC_NUBIMED_CLINICA_ID`, `PUBLIC_NUBIMED_VENDOR_ORIGIN`, `PUBLIC_NUBIMED_PROXY_URL` opcional). (AD-9, AD-7)
- [x] 7.2 `AGENTS.md`: hosting Cloudflare Pages, la Function como única excepción BFF acotada, prohibido loggear bodies; flag `bookingPublic`. (AD-7, AD-8)
- [x] 7.3 `docs/stack-and-deployment-context.md`: Cloudflare Pages + Functions, variables de entorno en el dashboard, `npx wrangler pages dev dist --binding PUBLIC_NUBIMED_CLINICA_ID=1212`. (AD-7)
- [x] 7.4 `docs/site-architecture.md`: jerarquía de CTAs (valoración → reserva); booking sigue fuera de la nav y `noindex`. (REQ-1, REQ-18)
- [x] 7.5 `README.md`: deploy en Cloudflare Pages y prueba local de la Function. (AD-7)
- [x] 7.6 (diferido a `sdd-archive`; no se sincronizó en esta fase) Specs del dominio (`openspec/specs/web-booking-nubimed-client`, `web-whatsapp-floating-cta`): sincronizar los deltas solo si el flujo del proyecto lo pide en esta fase; en caso contrario queda para `sdd-archive`.

## Phase 8: Verificación y activación

- [ ] 8.1 Confirmar que `bookingPublic = false` en `src/i18n/site-features.ts` durante toda la verificación (el flag solo se activa en 8.9). — *Desviación: el preview se probó con el flag en `true` (decisión del usuario); la PR #11 se mergeó con `true`. Ver verify-report, observación 1.*
- [x] 8.2 `npm run check` (0 errors) y `npm run build` (manual, no por cada apply batch). Inspeccionar `dist/`: `robots.txt` con `Disallow: /__nubimed-proxy/`, flotante solo en `dist/*/index.html`, `hrefs` de CTAs con flag off = wa.me/contact sin `preset=`. (REQ-1, REQ-18, REQ-19) — *check local OK; build vía Cloudflare Pages (deploy activo).*
- [x] 8.3 `npm run lint:encoding` (varios archivos de texto tocados en Windows). `npm run verify:routes` solo si se tocaron slugs (no debería). — *lint:encoding OK; verify:routes no aplica.*
- [ ] 8.4 Revisión manual del flotante: 4 locales, contraste AA, foco por teclado, no tapa banner de cookies ni drawer móvil, ausente sin `PUBLIC_WHATSAPP_E164`. (REQ-1..6 floating)
- [x] 8.5 Preview deploy de Pages con variables configuradas; validar los supuestos de AD-7: (a) routing `[[path]]` en git deploy, (b) variables del dashboard disponibles en `context.env`, (c) body ya descomprimido, (d) WAF del vendor no bloquea IPs de Cloudflare; si (b) falla, usar variables runtime propias con los mismos nombres. — *Supuestos (a), (b) y (d) verificados indirectamente por la reserva real (8.8); (c) sin incidencias observadas.*
- [ ] 8.6 En el preview: ruta fuera de allowlist → 404 y método no permitido → 405 sin llegar al vendor; `Set-Cookie` sin `Domain`; `Cache-Control: no-store`; sin logs de bodies. (REQ-21)
- [x] 8.7 Con el flag activo en el preview (o build local de prueba, sin mergear): comprobar que huecos y `/new` incluyen `area_id=<id>` / `area=<id>` y que los CTAs llevan `preset=386` (capilar), `preset=3` (facial) y ninguno en los genéricos. (REQ-18, REQ-20) — *Verificado indirectamente: las citas aparecieron en el centro elegido.*
- [x] 8.8 Cita real de prueba por el flujo completo (reCAPTCHA incluido) en un centro: `POST …/cita_peticiones` devuelve 201, aparece en el centro elegido y la clínica la cancela. Registrar en el verify-report. Si falla (201 / WAF / reCAPTCHA), dejar `bookingPublic = false` y mergear así. (REQ-11, REQ-23) — *Hecho 2026-11-21 en ambos centros; la clínica canceló las citas. Ver verify-report.*
- [x] 8.9 Solo si 8.5-8.8 pasan: cambiar `bookingPublic = true` en `src/i18n/site-features.ts`, `npm run check`, redeploy y repetir un smoke de los hrefs de los CTAs. (REQ-1, REQ-18, REQ-23) — *Flag en `true` en `main` (PR #11, `08547da`).*
- [ ] 8.10 Confirmar el rollback: `bookingPublic = false` restaura WhatsApp/contacto y el placeholder, sin peticiones al vendor. (REQ-1)
