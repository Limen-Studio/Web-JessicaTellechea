# Verify Report — reenable-nubimed-booking

**Fecha**: 2026-11-21
**Verificado contra**: `proposal.md`, `design.md`, `tasks.md`, `specs/web-booking-nubimed-client/spec.md` y `specs/web-whatsapp-floating-cta/spec.md` (deltas)

## Resultado global

**PASS con observaciones.** La reserva real (gate de go-live, REQ-23) se completó en los dos centros y la clínica canceló las citas de prueba. El cambio está en `main` (PR #11, `08547da`) con `bookingPublic = true`. Quedan tres verificaciones manuales sin evidencia registrada (8.4, 8.6, 8.10) que no bloquean, pero conviene cerrarlas.

---

## Gate de go-live (8.8 — REQ-11, REQ-23)

- ✅ **Reserva real en ambos centros** (Barcelona y El Vendrell), flujo completo con reCAPTCHA, desde el dominio de producción. Confirmado por el usuario el 2026-11-21; la clínica **canceló** ambas citas.
- Implica, de forma indirecta:
  - ✅ La Pages Function `functions/__nubimed-proxy/[[path]].ts` enruta en git deploy y recibe `PUBLIC_NUBIMED_CLINICA_ID` en runtime (supuestos AD-7 **a** y **b**).
  - ✅ El WAF del vendor no bloquea las IPs de Cloudflare (AD-7 **d**).
  - ✅ La key de reCAPTCHA del vendor acepta el dominio de producción.
  - ✅ `area_id` / `area` llegan correctos: la cita aparece en el centro elegido (REQ-20).
  - ✅ La precedencia de hiddens de `/new` (AD-5) produce un POST que el portal acepta.
- ⚠️ No se registró el código HTTP exacto (201) ni el tratamiento usado; la evidencia es la aparición de la cita en la agenda y su cancelación por la clínica.

## Checks automáticos

- ✅ `npm run check`: 0 errors, 0 warnings (7 hints preexistentes de `z` deprecado en `content.config.ts`).
- ✅ `npm run lint:encoding`: OK.
- ✅ Build: lo ejecuta Cloudflare Pages en cada push; el deploy de producción está activo. No se corrió en local (regla del usuario).
- ➖ `npm run verify:routes`: no aplica (no se tocaron slugs).

## Cumplimiento por área

- ✅ **Catálogo 1212** (REQ-3): especialidades 3 / 386 × centros con los 8 ids verificados contra el portal en vivo (exploration §7b).
- ✅ **Paso de centro** (REQ-4, 5, 7, 14): stepper de 5 pasos, presets `preset`/`sede`, reset de pasos posteriores; revisado en navegador por el usuario durante el apply (ajustes de UI registrados en `apply-progress.md`).
- ✅ **CTAs** (REQ-18, 19): genéricos sin preset; capilar `preset=386`; facial `preset=3`; flag off → release 1.
- ✅ **Labels** (REQ-22): CTAs de la home y CTA final de capilar traducidos en en/ca/fr; lead/heading de booking sin "por WhatsApp" con el flag activo.
- ✅ **Proxy** (REQ-21): allowlist, fail-closed sin clinic id, `Set-Cookie` sin `Domain`, `no-store`, sin logs; `Location` root-relative también reescrito (fix del orquestador).
- ✅ **Botón flotante WhatsApp** (web-whatsapp-floating-cta): solo en la home, tokens corporativos, z-index bajo drawer/header/cookies.

## Observaciones

1. **WARNING — merge con el flag activo antes de registrar la verificación.** La PR #11 se mergeó con `bookingPublic = true` (pensado solo para el preview) antes de existir este reporte. La prueba real se hizo después y pasó, así que no hay impacto, pero el gate quedó invertido respecto al plan (8.8 → merge).
2. **WARNING — sin evidencia de 8.4, 8.6 y 8.10** (ver `tasks.md`): revisión a11y del flotante en los 4 locales, respuestas 404/405 del proxy en producción y prueba de rollback con el flag en `false`.
3. **SUGGESTION — drift de REQ-16.** La PR #12 (`feat/contact-two-clinics`) muestra siempre la ubicación del centro (con fallback de dirección) como enlace a Maps; el delta spec dice "sin env, solo la etiqueta". Ajustar el requisito al archivar.
4. **SUGGESTION — páginas de tratamientos capilares** (`TreatmentHero`, `TreatmentAbout`, llegadas desde `main`) usan `resolveBookingCta(lang)` sin preset; por coherencia deberían llevar `preset=386`.
5. **INFO — bloqueo de IPs de Cloudflare en España durante partidos de LaLiga.** El dominio (`188.114.96.5` / `188.114.97.5`) da timeout TCP en algunos operadores mientras `*.pages.dev` responde. Afecta a todo el sitio, incluido el booking; no es un defecto de este cambio.

## Siguiente paso

`sdd-archive` cuando se cierren (o se acepten como riesgo) las observaciones 2 y 3.
