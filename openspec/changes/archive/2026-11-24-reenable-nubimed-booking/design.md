# Design: Reactivar la reserva Nubimed (clínica 1212, con centros)

## Contexto

`BookingFlow` sigue en disco, sin montar desde release 1 (`defer-booking-cta-to-whatsapp`). La clínica 1212 añade **centros** (áreas): `area_id` es obligatorio en huecos y `area` en `/new` (exploration §7b). El hosting pasa a Cloudflare Pages, lo que habilita un proxy same-origin. Las decisiones del usuario del proposal son finales. Specs: `specs/web-booking-nubimed-client/spec.md` (REQ-1…23) y `specs/web-whatsapp-floating-cta/spec.md`.

Estrategia: **diff mínimo** sobre los módulos existentes; nada de refactors colaterales. El área viaja **dentro de la opción de tratamiento**, así que las cargas de días/franjas cambian poco.

## Architecture Decisions

### AD-1: Catálogo estático especialidad → centro → tratamiento en `config.ts`

**Decision.** `src/features/booking-nubimed/config.ts` sigue siendo la única fuente de verdad (REQ-3). Se reemplaza `SPECIALTY_CATALOG` por:

```ts
export type CentroKey = 'barcelona' | 'el-vendrell';
export const CENTROS: Record<CentroKey, { labels: Record<SiteLocale, string> }>; // "Barcelona", "El Vendrell"
export interface SpecialtyCentro {
  readonly centro: CentroKey;
  readonly areaId: number;
  readonly firstVisitTreatmentId: number;
  readonly treatmentsTreatmentId: number;
}
export interface SpecialtyCatalogEntry {
  readonly vendorId: 3 | 386;
  readonly slug: string;
  readonly matchKeys: readonly string[];
  readonly tipoHorario: 'presencial';
  readonly labels: Record<SiteLocale, string>;
  readonly centros: readonly SpecialtyCentro[];
}
export const TREATMENT_KIND_LABELS: Record<'firstVisit' | 'treatments', Record<SiteLocale, string>>;
```

Datos: `3` (`medicina-estetica`; keys `medicina-estetica`, `estetica`, `3`) → Barcelona 15070/389741/389745, El Vendrell 15072/389742/389746. `386` (`tricologia`; keys `tricologia`, `capilar`, `hair`, `medicina-capilar`, `386`) → Barcelona 15071/389743/389747, El Vendrell 15073/389744/389748. Se eliminan `4`, `5`, `244529` y el campo `clinicaTratamientoId`. Labels con tildes correctas en 4 locales. Helpers nuevos: `centroFor(entry, key)` y `centroAddressesFromEnv()` (AD-9).

**Rationale.** Los 8 ids están verificados en vivo, no hay conceptos y el label del vendor solo llega en el locale que pida el vendor. Un catálogo estático da labels en 4 idiomas y cero peticiones extra. Las etiquetas de centro se comparten entre especialidades, sin duplicarse.

**Alternatives considered.** Catálogo híbrido con tratamientos live (opción C): una petición y un punto de fallo más, y labels sin i18n. Lo descarta el proposal (fuera de alcance).

### AD-2: Tratamientos solo desde el catálogo; `fetchTreatmentsBySpecialty` se conserva con `areaId`

**Decision.** `BookingFlow` deriva `treatmentOptions` con `useMemo` a partir de `(specialty, centro, lang)`: dos opciones por centro, `label` = `TREATMENT_KIND_LABELS`, `tipoHorario`/modalidad = `'presencial'` (constante del catálogo), `id` = `${vendorId}-${treatmentId}`. Se eliminan el efecto `loadTreatments`, los estados `treatmentsLoading/treatmentsErr` y su UI. `client.fetchTreatmentsBySpecialty` pasa a exigir `areaId` (REQ-20). El flujo no lo usa, pero queda disponible para comprobar a mano si el panel cambió (drift), y la allowlist del proxy lo admite (REQ-21).

**Rationale.** Es determinista y quita un paso asíncrono. Mantener la firma correcta evita que una llamada futura salga sin área.

**Alternatives considered.** Borrar la función: la allowlist y el spec la siguen nombrando, y borrarla agranda el diff sin beneficio.

### AD-3: Paso "centro" en `BookingFlow` (stepper de 5 pasos)

**Decision.**

| Aspecto | Cambio |
|---|---|
| Tipos | `PickStep = 'specialty' \| 'area' \| 'treatment' \| 'datetime'`; `TreatmentOption` gana `areaId: number` |
| Estado | `centro: SpecialtyCentro \| null`; `resolvedSede` (de `?sede=`) |
| Derivados | `sedeEntry = specialty && centroFor(specialty, resolvedSede)`; `invalidSede = resolvedSede !== '' && hasValidPreset && !sedeEntry`; `invalidPreset \|\|= invalidSede` (banner existente) |
| Paso inicial | sin preset válido → `specialty`; preset válido y sede válida → `treatment`; preset válido → `area` |
| Selección | `onSpecialtyChange` limpia `centro` y todo lo posterior → `area`; nuevo `onCentroPick` limpia tratamiento/día/franja/profesional → `treatment` |
| Días/franjas | `loadDays`/`loadSlots` leen `selectedTreatment.areaId`; las deps de los efectos ya incluyen `selectedTreatment`, así que el abort de respuestas obsoletas se hereda (REQ-7) |
| `newUrlSelection` | añade `areaId`; quita el fallback a `specialty.clinicaTratamientoId` (igual en `onFinalize`) |
| Atrás | treatment → `area` si `showAreaPicker`, si no `specialty` si `showSpecialtyPicker`; area → `specialty` si `showSpecialtyPicker` |
| Stepper | `[1..5]`; índice specialty 1, area 2, treatment 3, datetime 4, details 5; los kickers `stepLabel(n)` se renumeran; `aria-label={strings.stepsAriaLabel}` |
| Reset tras éxito | vuelve al paso inicial y conserva especialidad/centro de preset |
| Resumen | fila de centro (label) + dirección de `centroAddresses[centro.centro]` solo si existe (REQ-16) |

**Fix del bug de preset por prop.** El `useLayoutEffect` lee **siempre** `window.location.search`. `preset = prop || url.preset`; `treatment` y `sede` se leen siempre de la URL. Así un preset por prop no bloquea `sede` (REQ-4).

**Rationale.** Es la misma forma que el paso de especialidad. Colgar el área del tratamiento evita cambiar las firmas de carga y los efectos.

**Alternatives considered.** Reescribir con `useReducer`: diff grande y regresiones en la UI de calendario ya pulida.

### AD-4: `?treatment=` se resuelve solo dentro del centro elegido

**Decision.** El auto-match de `resolvedPresetTreatmentId` se mantiene, pero solo contra las opciones del centro activo. No se deduce el centro desde el id de tratamiento.

**Rationale.** Ningún CTA usa `treatment` hoy. Deducir el centro añadiría lógica sin consumidor.

### AD-5: Precedencia del POST: scrapeado > runtime > fallback fijo; la selección y el paciente se escriben siempre

**Decision.** En `buildBookingSubmitBody` se invierte el orden:

1. `merged = { ...NUBIMED_PORTAL_SUBMIT_FIXED_FIELDS, ...nubimedPortalSubmitRuntimeFields(clinicaId), ...fieldDefaults }`, después se borran los `EXCLUDED`.
2. `params_tracking = fieldDefaults.params_tracking || buildTrackingInnerQuery(sel)` (la del portal, ordenada alfabéticamente, prevalece) y `area_seleccionada = fieldDefaults.area_seleccionada || String(sel.areaId)`.
3. `origen_widget`, `cargar_paso_detalles` y los `*_obligatorio` siguen el patrón `merged.x || default`.
4. Campos de selección/paciente (`pref_*`, `users_disponibilidad`, `clinica_especialidad_id`, `clinica_tratamiento_id`, `locale`, paciente, `check_condiciones`, `recaptcha_token`) y los forzados que salen del 201 de mayo (`origen`, `es_widget`, `prepago_total`, `motivo`, `usuario_seleccionado`) se escriben al final, como hoy.
5. Se **quita** el `Object.assign(... FIXED_FIELDS ...)` final.

`FIXED_FIELDS` se corrige a 1212 como fallback: `clinica_tratamiento_obligatorio:'true'`, `hay_areas:'true'`, `hay_mas_de_una_especialidad:'false'` (valor de `/new`); se quita `area_seleccionada` (dinámico). `buildNewUrl` y `buildTrackingInnerQuery` usan `area=<areaId>` (`NewUrlSelection.areaId`).

**Rationale.** REQ-9: el vendor es la autoridad de sus flags; lo fijo solo cubre ausencias.

**Alternatives considered.** Corregir FIXED_FIELDS y seguir aplicándolo al final: frágil ante el próximo cambio de panel.

### AD-6: Base same-origin por defecto: `/__nubimed-proxy` (relativa)

**Decision.** `nubimedBaseUrl()` queda así: si hay `PUBLIC_NUBIMED_PROXY_URL` se usa (se conserva la regla de localhost solo en dev); si no, se usa siempre `'/__nubimed-proxy'`. Se elimina el fallback al origen directo del vendor (CORS lo rompe en producción). `fetch` acepta rutas relativas. `buildNewUrl` resuelve con `new URL(\`${b}${path}\`, globalThis.location?.origin ?? 'http://localhost')` y conserva el prefijo (REQ-20). `isRuntimeLocalhost` queda solo para la regla de proxy explícito.

**Rationale.** La base relativa es la misma en dev (Vite proxy), `wrangler pages dev` y producción, y no hay error durante el SSR de la isla (no depende de `location`).

**Alternatives considered.** `${location.origin}/__nubimed-proxy`: vacío durante el SSR, lo que mostraría `networkError` en el HTML estático antes de hidratar.

### AD-7: Proxy como Cloudflare Pages Function `functions/__nubimed-proxy/[[path]].ts`

**Decision.** `export const onRequest` con un contexto tipado localmente (`{ request: Request; env: Record<string, string | undefined> }`), sin dependencia `@cloudflare/workers-types`. Comportamiento:

| Tema | Regla |
|---|---|
| Config | `env.PUBLIC_NUBIMED_CLINICA_ID` (entero > 0, si falta → **503 fail-closed**); `env.PUBLIC_NUBIMED_VENDOR_ORIGIN` (debe ser `https:`; default `https://portal.clinicaenlanube.com`). Son las mismas variables del build, configuradas una sola vez en el dashboard de Pages |
| Allowlist | `GET /clinicas/{id}/cita_peticiones/(widget\|huecos_agenda\|new)`; `POST /clinicas/{id}/cita_peticiones` (exacto); `GET /ajax/obtener_clinica_tratamientos` solo si `clinica_id={id}`. Cualquier otra ruta → 404 y otro método → 405, **sin llamar al vendor** |
| Request | Se reenvían solo `Accept`, `Accept-Language`, `Content-Type`, `X-Requested-With`, `X-CSRF-Token` y `Cookie`; `Referer = {vendor}/clinicas/{id}/cita_peticiones/widget`; en POST, `Origin = {vendor}`; `redirect: 'manual'`; el body se pasa como stream |
| Response | Se copian status y `Content-Type`. `Set-Cookie` vía `headers.getSetCookie()`, cada cookie sin `Domain=` y añadida con `append`. Un `Location` absoluto al vendor se reescribe a `/__nubimed-proxy{path}`. Siempre `Cache-Control: no-store` y `X-Robots-Tag: noindex, nofollow` |
| Logs | Ninguno. Sin `console.*` con bodies, query ni cookies (REQ-21) |

Coexistencia: Astro genera `dist/` estático; Pages compila `functions/` de la raíz del repo por separado (no hay adapter). `astro dev` sigue usando el proxy de Vite (`astro.config.mjs`, sin cambios). Para probar la Function en local: `npx wrangler pages dev dist --binding PUBLIC_NUBIMED_CLINICA_ID=1212`, sin añadir wrangler a `package.json`. `tsconfig.json` incluye `**/*`: la Function usa solo tipos Fetch del lib DOM (`getSetCookie` existe en TS ≥ 5.2), así que `astro check` la tipa sin un tsconfig aparte.

**Supuestos no verificados contra la doc de Cloudflare (validar en el preview):** (a) el routing de `functions/` con `[[path]]` catch-all en git deploy; (b) que las variables del dashboard de Pages lleguen también a `context.env` en runtime; (c) que el runtime entregue el body ya descomprimido (por eso no se copia `Content-Encoding`/`Content-Length`); (d) que las IPs de Cloudflare no las bloquee el WAF del vendor.

**Alternatives considered.** Hardcodear 1212 en la Function: dos fuentes de verdad. Workers con static assets y `run_worker_first`: el usuario eligió Pages. Worker en otro host: sería cross-origin.

### AD-8: Helper de CTA y flag `bookingPublic`

**Decision.** En `src/i18n/site-features.ts`: `export const bookingPublic = true;` (patrón `blogPublic`). En `src/i18n/booking-links.ts`: `BOOKING_PRESET_VENDOR_TRICOLOGIA = '386'` (se corrige el comentario de `…_MEDICINA_ESTETICA`) y

```ts
export function resolveBookingCta(lang: Locale, opts?: { preset?: string }): { href: string; external: boolean }
// bookingPublic → { href: preset ? bookingUrlWithPreset(lang, preset) : href(lang, 'booking'), external: false }
// si no → release 1 (wa.me / contact)
```

Callsites: capilar (`HomeCapillary`, `CapilarPillarPage` hero + FinalCta) → `{ preset: '386' }`; facial (`FacialHero`, `FacialPillarPage`) → `{ preset: '3' }`; los genéricos y corporal no cambian. `[segment].astro`: `bookingPublic ? <BookingFlow client:load lang centroAddresses={centroAddressesFromEnv()} /> : placeholder actual`. El placeholder y `bookingPlaceholderCta` se conservan para el flag off.

**Rationale.** Rollback con un solo booleano. Los callsites ya consumen `external` para `target`/`rel` (REQ-19).

### AD-9: Direcciones por centro en env, resueltas en build

**Decision.** `PUBLIC_CLINIC_ADDRESS_BARCELONA` y `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL` (nombres definitivos), tipadas en `src/env.d.ts` y documentadas en `.env.example`. `centroAddressesFromEnv(): Partial<Record<CentroKey, string>>` usa accesos literales `import.meta.env.X` y se llama en el frontmatter de Astro. `BookingFlowProps.clinicAddress` se reemplaza por `centroAddresses`. `PUBLIC_CLINIC_ADDRESS` sigue existiendo para el resto del sitio, pero `BookingFlow` ya no la lee.

**Rationale.** El acceso dinámico `import.meta.env[key]` no lo reemplaza Vite de forma fiable en las islas. Pasarlo como prop sigue el patrón actual de `clinicAddress`.

### AD-10: `WhatsAppFloat.astro` solo en la home

**Decision.** `src/components/WhatsAppFloat.astro` (`lang`): si `PUBLIC_WHATSAPP_E164` falta, devuelve nada. Si existe, renderiza `<a class="whatsapp-float" href="https://wa.me/…" target="_blank" rel="noopener noreferrer" aria-label={…}>` con un SVG inline `aria-hidden="true"` y `fill="currentColor"`. Se monta al final de `[lang]/index.astro`. CSS en `src/styles/components/whatsapp-float.css`, importado desde `components.css`:

- Fondo `--color-accent` (#5b594f) y glifo `--color-on-accent` (#fafaf8): **≈6.7:1** (AA).
- Foco: `box-shadow: 0 0 0 2px var(--color-on-accent), 0 0 0 4px var(--color-accent)`. El doble anillo da ≥3:1 tanto sobre secciones claras como oscuras (`HomeDarkAuthority`).
- `position: fixed; right/bottom: calc(var(--space-md) + env(safe-area-inset-*))`.
- `z-index: 30`, por debajo del drawer móvil (35), el header (40) y el banner de cookies (90). Mientras están abiertos lo tapan, nunca al revés.
- Transición de hover solo bajo `@media (prefers-reduced-motion: no-preference)`.
- `aria-label` en `homeContent[lang].whatsappFloat.ariaLabel` (`src/i18n/home-content.ts`, alcance home).

**Rationale.** Es un `<a>` puro sin hidratación, con tokens del tema y sin verde (REQ-5).

### AD-11: Labels de CTA (REQ-22)

**Decision.** Se editan los strings existentes: `home-content.ts` (`hero.ctaPrimary`, `finalCta.cta` en en/ca/fr) y `capilar-page.ts` (`finalCta.primary` en en/ca/fr con wording de "diagnóstico"). En `booking-nubimed/i18n.ts` se añaden `selectArea`, `areaStepDescription`, `areaLabel` y `stepsAriaLabel`, y se quita `missingVendorTreatmentId` si queda sin uso.

## Data / Contract Changes

- `config.ts`: catálogo nuevo (AD-1), `centroFor` y `centroAddressesFromEnv`.
- `types.ts`: `BookingFlowProps.centroAddresses?: Partial<Record<CentroKey, string>>` (en lugar de `clinicAddress`). `SpecialtySelection` se elimina si queda sin uso.
- `build-new-url.ts`: `NewUrlSelection.areaId: number`.
- `client.ts`: `fetchTreatmentsBySpecialty({..., areaId})`; `fetchDayStrings`/`fetchSlots` reciben `areaId` y setean `area_id`.
- `booking-submit-merge.ts` y `nubimed-portal-submit-fields.ts`: AD-5.
- `booking-links.ts`, `site-features.ts`: AD-8.
- `src/env.d.ts`, `.env.example`: dos variables nuevas.
- `robots.txt.ts`: añade `Disallow: /__nubimed-proxy/`.
- Nuevos: `functions/__nubimed-proxy/[[path]].ts`, `src/components/WhatsAppFloat.astro`, `src/styles/components/whatsapp-float.css`.
- Docs: `AGENTS.md` (hosting Cloudflare Pages, la Function como única excepción BFF acotada, prohibido loggear bodies), `docs/stack-and-deployment-context.md`, `docs/site-architecture.md` (jerarquía de CTAs: valoración → reserva; booking sigue fuera de la nav), `README.md` (deploy y `wrangler pages dev`).

## Verificación

No hay tests unitarios en el repo. Se verifica con `npm run check`, `npm run build` y un checklist manual: hrefs de los CTAs con el flag on/off, `dist/robots.txt`, el flotante solo en `dist/*/index.html`, y en el preview las peticiones de huecos y `/new` con área, más el 201 (REQ-23).

## Rollout / Rollback

- **Rollout:** PR → preview deploy de Pages. En el preview se valida la allowlist (una ruta prohibida da 404), las cookies, el WAF, reCAPTCHA y **una cita real con POST 201** en un centro, que la clínica cancela. Después merge a producción con `bookingPublic = true`. Si el preview falla, se mergea con `bookingPublic = false`.
- **Rollback:** `bookingPublic = false` + redeploy: los CTAs vuelven a WhatsApp y la ruta muestra el placeholder. La Function sigue desplegada pero sin consumidores. Si falla el build o la Function: `git revert <sha>`. El flotante es independiente.

## Open Questions

- ¿Mostrar duración/precio en las etiquetas de tratamiento? Por defecto no, porque el precio cambiaría sin tocar el código. Lo confirma el usuario en apply si lo pide.
- Los supuestos (a)–(d) de AD-7 se confirman en el preview; si (b) falla, la Function lee variables runtime propias con los mismos nombres configuradas aparte.
