# Apply progress: reenable-nubimed-booking

## Batch 1 (Phases 1-3) - DONE

Tasks completed: 1.1-1.5, 2.1-2.6, 3.1-3.11. Phase 4+ not started. `bookingPublic = false`.

### Files changed
- `src/features/booking-nubimed/config.ts`: CentroKey, CENTROS, SpecialtyCentro, TREATMENT_KIND_LABELS, catalog 3 / 386 (8 verified ids), `centroFor`, `centroAddressesFromEnv`; removed 4, 5, 244529, `clinicaTratamientoId`.
- `src/features/booking-nubimed/types.ts`: `centroAddresses` replaces `clinicAddress`; `SpecialtySelection` removed.
- `src/env.d.ts`: `PUBLIC_CLINIC_ADDRESS_BARCELONA`, `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL`.
- `src/features/booking-nubimed/build-new-url.ts`: `areaId`, `area=<id>`, relative base resolved against `location.origin`.
- `src/features/booking-nubimed/client.ts`: `area_id` required in treatments/days/slots.
- `src/features/booking-nubimed/nubimed-portal-submit-fields.ts`: FIXED_FIELDS corrected for 1212; `area_seleccionada` removed.
- `src/features/booking-nubimed/booking-submit-merge.ts`: AD-5 precedence (FIXED < runtime < scraped), final Object.assign removed.
- `src/features/booking-nubimed/i18n.ts`: `selectArea`, `areaLabel`, `areaStepDescription`, `stepsAriaLabel` (es/en/ca/fr); `missingVendorTreatmentId` removed.
- `src/features/booking-nubimed/BookingFlow.tsx`: centro step, derived treatment options, areaId plumbing, 5-step stepper, centro summary row.
- `src/i18n/site-features.ts`: `bookingPublic = false`.
- `src/pages/[lang]/[segment].astro`: `bookingPublic ? <BookingFlow client:load .../> : placeholder`.

### Deviations
- 1.4 / 2.2: `PickStep`, `TreatmentOption` and `nubimedBaseUrl()` live in `BookingFlow.tsx`, not `types.ts` / `client.ts`; edited there (minimal diff).
- Task 3.9 uses a static import of `BookingFlow`; with the flag off it is never rendered, so the placeholder and `noindex` are unchanged.
- No `.env.example` edit (Phase 7.1, not in this batch).

### Checks
- `npm run check`: 0 errors, 0 warnings, 7 hints (pre-existing `z` deprecation hints). Build not run (user rule).

### Self-review (AD-2..AD-9, REQ-4/5/7/9/14/16/20)
- Specialty change clears centro, treatment, day, slot, professional; centro pick clears treatment and later state.
- Back: treatment -> area (or specialty), area -> specialty only when the specialty picker is shown.
- Stepper 1..5; steps skipped by preset are below the active index, so they show complete.
- Abort of stale day/slot responses preserved (effects unchanged, deps include selectedTreatment).
- `?treatment=` auto-match uses only the active centro's options (empty without a centro).
- Address row only for the active centro's env value; no fallback to another address.
- AD-5: scraped hiddens win over FIXED/runtime; `params_tracking` and `area_seleccionada` prefer scraped values.
- Fixed cosmetic indentation slips introduced during editing.

### Risks
- Flow not exercised in a browser; verification is in Phase 8.
- Runtime fields (`clinica`, `url_portal_cita`) are now overridable by scraped hiddens (per AD-5).

## Batch 2 (Phase 4) - DONE

Tasks completed: 4.1-4.8 (incl. 4.7b). Phase 5+ not started. `bookingPublic = false`.

### Files changed
- `src/i18n/booking-links.ts`: `BOOKING_PRESET_VENDOR_TRICOLOGIA = '386'`; `resolveBookingCta(lang, opts?: { preset })` returns internal booking href (preset optional, `external:false`) when `bookingPublic`, else wa.me/contact as before.
- `src/components/home/HomeCapillary.astro`, `src/components/capilar/CapilarPillarPage.astro`: preset 386.
- `src/components/facial/FacialHero.astro`, `src/components/facial/FacialPillarPage.astro`: preset 3.
- `src/i18n/home-content.ts`: `hero.ctaPrimary` and `finalCta.cta` translated en/ca/fr (ca/fr hero now override the es spread).
- `src/i18n/capilar-page.ts`: `finalCta.primary` en/ca/fr; es accent fixed (diagnóstico).
- `src/i18n/page-stubs.ts`: new `bookingOnlineStub` (es/en/ca/fr).
- `src/pages/[lang]/[segment].astro`: booking stub chosen by `bookingPublic` (title/heading/lead; layout description = lead).

### Notes
- 4.5: generic callsites (BaseLayout, PrimaryNav, HomeHero, HomeFinalCta, FinalCta, segment page) call `resolveBookingCta(lang)` unchanged; they get the booking route without preset when the flag is on. All render target/rel from `external`. Corporal untouched (it also benefits from the helper with no preset: with flag on its CTA goes to generic booking; no file edited).
- `booking-links.ts` now imports `site-features` (no cycle).

### Checks
- `npm run check`: 0 errors, 0 warnings, 7 hints (pre-existing). Build not run.

## Batch 3: Phase 5 (WhatsApp floating button, home) — DONE (paralelo con Batch 4)
- [x] 5.1 `home-content.ts`: `whatsappFloat.ariaLabel` (es/en/ca/fr) + tipo `HomeContent`.
- [x] 5.2 `src/components/WhatsAppFloat.astro`: no renderiza sin `PUBLIC_WHATSAPP_E164`; `<a>` a `wa.me`, `target=_blank rel=noopener noreferrer`, SVG inline `aria-hidden`, sin hidratación.
- [x] 5.3 `src/styles/components/whatsapp-float.css` + import en `components.css`: fixed + safe-area, fondo `--color-accent`, glifo `--color-on-accent`, foco doble anillo, `z-index: 30` (< drawer 35 < header 40 < cookies 90), hover solo bajo `no-preference`.
- [x] 5.4 `src/pages/[lang]/index.astro` monta `<WhatsAppFloat lang={lang} />` (única página).
- [x] 5.5 `npm run check`: 0 errors, 0 warnings.
- Desvío: hover con `--color-accent-muted` (#6f6c61) no previsto en AD-10; contraste con `--color-on-accent` ≈ 5:1 (cálculo del orquestador, AA OK).
- aria-label: es "Escribir por WhatsApp (se abre en una pestaña nueva)"; en "Chat on WhatsApp (opens in a new tab)"; ca "Escriu-nos per WhatsApp (s'obre en una pestanya nova)"; fr "Écrire sur WhatsApp (s'ouvre dans un nouvel onglet)".

## Batch 4: Phase 6 (Cloudflare Pages Function proxy + robots) — DONE (paralelo con Batch 3)
- [x] 6.1 `functions/__nubimed-proxy/[[path]].ts`: `onRequest` con contexto tipado local; `PUBLIC_NUBIMED_CLINICA_ID` (`^[1-9]\d*$`, si no → 503) y `PUBLIC_NUBIMED_VENDOR_ORIGIN` (`https:`, default portal.clinicaenlanube.com).
- [x] 6.2 Allowlist: GET `…/cita_peticiones/(widget|huecos_agenda|new)`, POST `…/cita_peticiones` exacto, GET `/ajax/obtener_clinica_tratamientos` solo con `clinica_id={id}`; 404 ruta desconocida, 405 método (`Allow: GET, POST`), sin llamar al vendor.
- [x] 6.3 Solo reenvía Accept, Accept-Language, Content-Type, X-Requested-With, X-CSRF-Token, Cookie; Referer al widget; Origin en POST; `redirect: 'manual'`; body en stream.
- [x] 6.4 Respuesta: status + Content-Type; `Set-Cookie` vía `getSetCookie()` sin `Domain`; `Location` reescrito; `no-store` + `X-Robots-Tag`; sin `console.*`. 502 si falla el upstream.
- [x] 6.5 `robots.txt.ts`: `Disallow: /__nubimed-proxy/`.
- [x] 6.6 `npm run check`: 0 errors, 0 warnings, 7 hints preexistentes. Sin `tsconfig` extra ni `@cloudflare/workers-types`.
- Fix del orquestador en revisión: `Location` root-relative (`/clinicas/...`) también se reescribe a `/__nubimed-proxy/...` (antes solo absolutos al vendor → el navegador saldría del proxy y daría 404).
- Env en Cloudflare: `PUBLIC_NUBIMED_CLINICA_ID` (obligatoria), `PUBLIC_NUBIMED_VENDOR_ORIGIN` (opcional).
- Supuestos AD-7 (a)–(d) sin verificar hasta el preview.

## Batch 5: Phase 7 (docs, AGENTS, README) — PARTIAL (7.1 BLOCKED)
- [ ] 7.1 `.env.example`: BLOCKED, lectura/escritura denegada por permisos. El usuario debe añadir (valores placeholder):
  ```
  # Direcciones por centro (build time; visibles en el resumen de reserva)
  PUBLIC_CLINIC_ADDRESS_BARCELONA=
  PUBLIC_CLINIC_ADDRESS_EL_VENDRELL=
  # Nubimed: tambien se definen en el dashboard de Cloudflare Pages (runtime de la Function)
  PUBLIC_NUBIMED_CLINICA_ID=1212
  # Opcional (default https://portal.clinicaenlanube.com)
  PUBLIC_NUBIMED_VENDOR_ORIGIN=
  # Opcional: base del proxy (solo dev local; default same-origin /__nubimed-proxy)
  PUBLIC_NUBIMED_PROXY_URL=
  ```
- [x] 7.2 `AGENTS.md`: hosting Cloudflare Pages, Function como unica excepcion de servidor, prohibido loggear bodies, flag `bookingPublic`, CTA routing (preset 386/3), flotante en home; Ask first/Never actualizados (sin IONOS).
- [x] 7.3 `docs/stack-and-deployment-context.md`: IONOS reemplazado por Cloudflare Pages + Functions; env build vs runtime; `wrangler pages dev`; fila Booking y Forms actualizadas.
- [x] 7.4 `docs/site-architecture.md`: jerarquia de CTAs (valoracion → reserva con flag), presets, flotante, booking sigue noindex/fuera de nav y sitemap.
- [x] 7.5 `README.md`: deploy en Cloudflare Pages, env, prueba local de la Function.
- [x] 7.6 Specs de dominio: diferido a `sdd-archive`.
- Nota: `docs/seo-and-localization.md` no menciona IONOS; sin cambios.

## Ajustes de UI pedidos por el usuario (tras revisar en navegador, antes de Phase 8)
- Encabezado de booking con más aire: `.booking-page__title` margin-top `--space-lg`; nueva `.booking-page__lead` (max-width 38rem, `--space-md`, line-height 1.7, `--color-muted`, `text-wrap: balance`) aplicada en `[segment].astro`; `.booking-flow-shell` margin-top `--space-xl`.
- Sublínea dorada en tarjetas de servicio: `FIRST_VISIT_DETAIL = '45 min. - 100€'` y `treatmentsDetail` por centro en `config.ts` (estética BCN "BTX · FILLERS · BIOESTIMUL · IPL · PRP", estética El Vendrell "BTX · FILLERS · BIOESTIMUL · PRP", tricología "MESO · PRP"); `TreatmentOption.detail`; `.booking-flow__slot--treatment` + `.booking-flow__slot-detail` (Manrope 300, 0.78rem, tracking 0.08em).
- Decisión aprobada por el usuario: color de la sublínea `color-mix(champagne 55%, text)` (~4.6:1, AA) en lugar de champagne puro (~2.2:1).
- `npm run check`: 0 errors, 0 warnings.
- `.booking-flow-shell` margin-bottom `--space-xl` (aire antes del footer).
- Aviso en el paso Servicio: `<aside class="booking-flow__notice">` dentro de `.booking-flow__scroll-region`, bajo las tarjetas; strings `treatmentNotice` (3 puntos) y `treatmentNoticeLabel` (aria-label) en es/en/ca/fr (`i18n.ts`). Copy condensado del texto del usuario (valoración + plan; descuento de la consulta; mismo día según agenda). Estilo: filete izquierdo champagne 2px, fondo `bg/surface`, viñetas champagne, Manrope 0.84rem `--color-muted`.
- `npm run check` 0 errors; `lint:encoding` OK.
- Ajuste: el aviso sale de la zona con scroll y queda al pie del paso, sobre "Anterior" (`flex: 0 0 auto`, margin `--space-md` arriba y abajo). Copy en 2 puntos: (1) valoración + plan + descuento de la consulta en una sola frase; (2) mismo día según agenda. 4 locales.
- Fix: el aviso usaba `.booking-flow__notice`, clase ya existente (loading/disclaimer/reCAPTCHA) → colisión (márgenes pisados y estilo filtrado a esos textos). Renombrado a `.booking-flow__visit-notice` / `-list`.
- Lead de booking (`bookingOnlineStub`, 4 locales): "Elige el centro, el tratamiento y el momento que prefieras para tu visita." (orden real del flujo, tono silent luxury).
