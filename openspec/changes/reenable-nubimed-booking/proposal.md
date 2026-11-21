# Proposal: Reactivar la reserva Nubimed (clínica 1212, con sedes)

## Intent

La release 1 difirió `BookingFlow` y mandó todos los CTAs a WhatsApp. La clínica migró a Nubimed **1212**, que añade **sedes** (áreas) y otros IDs: el código actual (especialidades `3|4|5`, sin `area_id`, `FIXED_FIELDS` erróneos) rompería la reserva. Además el hosting pasó a **Cloudflare** (decisión del usuario), lo que permite un proxy same-origin. Éxito = el paciente reserva desde el sitio eligiendo especialidad → centro → tratamiento → día/hora → datos.

## Scope

### In Scope
- Catálogo estático (opción A) con los 8 IDs verificados (§7b de `exploration.md`): especialidades 3 / 386 × sedes Barcelona (C. Calvet 16) / El Vendrell (C. de Mar 41).
- Dimensión `area` en tratamientos, huecos y `/new`.
- Paso nuevo de sede en `BookingFlow` (stepper de 5 pasos), i18n es/en/ca/fr. Copy recomendado: **"centro"** ("Elige tu centro").
- Merge del POST: hidden scrapeados de `/new` **prevalecen** sobre `NUBIMED_PORTAL_SUBMIT_FIXED_FIELDS` (este queda como fallback).
- Helper `resolveBookingCta(lang, { preset? })` + flag `bookingPublic`: genéricos ("Reservar cita", "Solicitar valoración") sin preset; capilar → 386; facial → 3.
- Botón flotante de WhatsApp en la home (abajo a la derecha, tokens corporativos, no verde).
- Proxy same-origin `/__nubimed-proxy/*` en Cloudflare (allowlist, cookies, Referer/Origin, `no-store`, sin logs de bodies).
- Actualizar `AGENTS.md`, `docs/*.md`, `README.md`, `.env.example`, `robots.txt.ts`.

### Out of Scope
- Página de contacto con dos direcciones; publicar `corporal`.
- Fetch live de tratamientos (opcional, futuro).
- Indexar booking o meterlo en la nav principal (sigue `noindex`, fuera de sitemap).

## Capabilities

### New Capabilities
- `web-whatsapp-floating-cta`: botón flotante WhatsApp en home (href, a11y, tokens, no render sin env).

### Modified Capabilities
- `web-booking-nubimed-client`: Purpose, REQ-1 (montar flujo), REQ-3 (catálogo 3/386 + sedes), REQ-4/5 (presets + `sede`), REQ-7/14 (paso sede, reset), REQ-9 (precedencia de campos), REQ-11 (proxy same-origin Cloudflare), REQ-16 (dirección por sede), REQ-18/19 (CTAs → booking).

## Approach

1. Catálogo + plumbing de área (`config.ts`, `client.ts`, `build-new-url.ts`).
2. Paso sede en `BookingFlow` + i18n; corregir bug de preset por prop.
3. Fix de merge en `booking-submit-merge.ts`.
4. Helper CTA + callsites + `bookingPublic` en `site-features.ts`.
5. `WhatsAppFloat.astro` sin hidratación, solo en `[lang]/index.astro`.
6. Proxy Cloudflare Pages Function (`functions/__nubimed-proxy/[[path]].ts`).
7. Docs/spec/AGENTS.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/features/booking-nubimed/**` | Modified |
| `src/i18n/booking-links.ts`, `src/i18n/site-features.ts` | Modified |
| Header, `PrimaryNav`, `home/*`, `facial/*`, `capilar/*`, `FinalCta` | Modified |
| `src/pages/[lang]/[segment].astro`, `[lang]/index.astro` | Modified |
| `src/components/WhatsAppFloat.astro`, `src/styles/components/` | New |
| `functions/__nubimed-proxy/[[path]].ts` | New |
| `.env.example` (direcciones por sede) | Modified |
| `AGENTS.md`, `docs/*.md`, `README.md`, `robots.txt.ts` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| POST 201 nunca capturado | Med | Cita de prueba real en verify, cancelada por la clínica |
| WAF del vendor bloquea IPs de Cloudflare | Med | Probar en preview; flag off |
| reCAPTCHA no autoriza el dominio | Med | Validar en preview/producción antes de activar flag |
| Open proxy / datos de pacientes en logs | Low | Allowlist de métodos/paths; sin logging de bodies |
| `buildNewUrl` con base relativa lanza | Med | Resolver contra `location.origin` |

## Rollback Plan

1. `bookingPublic = false` → CTAs vuelven a WhatsApp y la ruta muestra el placeholder (rebuild + deploy, sin tocar código del flujo).
2. Si falla el proxy/build: `git revert <sha>` del cambio.
3. El botón flotante es independiente y se puede quitar solo.

## Dependencies

- Env de 1212 en Cloudflare; `PUBLIC_WHATSAPP_E164`.
- Clínica disponible para cancelar la cita de prueba.

## Success Criteria

- [ ] Reserva de prueba devuelve 201 y aparece en la sede elegida.
- [ ] CTAs genéricos sin preset; capilar `preset=386`, facial `preset=3`.
- [ ] Flag off restaura el comportamiento de release 1.
- [ ] Flotante solo en home, contraste AA, 4 locales.
- [ ] `npm run check` y `npm run build` pasan.

## Decisiones del usuario (2026-11-21, antes "Open Questions")

1. Direcciones de sede: **env** — `PUBLIC_CLINIC_ADDRESS_BARCELONA` y `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL` (nombres a confirmar en design), documentadas en `.env.example`; el catálogo referencia la clave de env por sede. Sin env → la sede muestra solo su label (sin dirección).
2. Hosting: **Cloudflare Pages + Functions**, deploy por git. Proxy en `functions/__nubimed-proxy/[[path]].ts`; no se añade adapter de Astro.
3. Corporal: **fuera de alcance por completo**. No se tocan sus callsites; al cambiar el helper heredan el comportamiento por defecto (booking sin preset). Sin trabajo dedicado.
4. Labels: **sí, en este cambio** — FinalCta capilar en/ca/fr con wording de "diagnóstico" y CTAs de la home que quedaron en español.
5. Flotante WhatsApp: **solo home**.
