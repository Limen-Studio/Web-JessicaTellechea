# Archive Report — reenable-nubimed-booking

**Fecha de archive**: 2026-11-24
**Change name**: `reenable-nubimed-booking`
**Destino**: `openspec/changes/archive/2026-11-24-reenable-nubimed-booking/`
**Estado de cierre**: ARCHIVADO CON PROBLEMAS CONOCIDOS. Superado por el cambio `nubimed-api-booking`.

## Aviso de estado (leer primero)

- **La reserva en producción falla en el envío.** Nubimed rechaza el reCAPTCHA ("Recaptcha Validation Error") porque no autoriza el dominio de producción en su clave. El gate de go-live (REQ-23, tarea 8.8) **no está superado**.
- **Hotfix**: PR #15 fija `bookingPublic = false`. Dato aportado por el usuario; no verificado por este archive.
- **Retractación**: la afirmación de que las reservas de prueba pasaron, incluida en `verify-report.md`, fue retirada por el usuario. La copia de auditoría de `verify-report.md` se conserva sin modificar; esta sección prevalece sobre ella.
- El veredicto "PASS con observaciones" de `verify-report.md` no debe leerse como gate superado.

## Estado del ciclo SDD

| Fase | Artefacto | Estado |
|------|-----------|--------|
| Explore | `exploration.md` | ✅ |
| Propose | `proposal.md` | ✅ |
| Design | `design.md` | ✅ |
| Spec (delta) | `specs/web-booking-nubimed-client/spec.md`, `specs/web-whatsapp-floating-cta/spec.md` | ✅ |
| Tasks | `tasks.md`: 53/58 completadas | ⚠️ 5 abiertas (ver abajo) |
| Apply | `apply-progress.md` (batches 1-5 + ajustes de UI) | ✅ (7.1 bloqueada) |
| Verify | `verify-report.md`: sin CRITICAL; 2 WARNING, 2 SUGGESTION, 1 INFO | ⚠️ con observaciones abiertas |
| Archive | este documento | ✅ |

### Tareas abiertas en `tasks.md`

- **7.1** `.env.example` sin documentar: lectura y escritura denegadas por permisos (apply-progress, batch 5). Las variables `PUBLIC_CLINIC_ADDRESS_*`, `PUBLIC_GOOGLE_MAPS_URL_*` y las de la Function no constan en el repo.
- **8.1** `bookingPublic` en `false` durante toda la verificación: desviación confirmada, la PR #11 se mergeó con el flag en `true`.
- **8.4** Revisión manual del flotante (4 locales, contraste, foco, solape con cookies y drawer): sin evidencia.
- **8.6** Respuestas 404/405 del proxy, `Set-Cookie` sin `Domain`, `no-store` y ausencia de logs en preview: sin evidencia.
- **8.10** Rollback con `bookingPublic = false`: sin evidencia.
- **8.8** figura como `[x]` en `tasks.md`, pero el resultado que declara queda **retractado** (ver aviso de estado).

### Observaciones de `verify-report.md`

| # | Severidad | Tema | Estado al archivar |
|---|-----------|------|--------------------|
| 1 | WARNING | Merge con el flag activo antes de registrar la verificación | Abierta (gate invertido respecto al plan) |
| 2 | WARNING | Sin evidencia de 8.4, 8.6, 8.10 | Abierta |
| 3 | SUGGESTION | Drift de REQ-16 (ubicación de centro) | **Cerrada en esta sincronización** (ver abajo) |
| 4 | SUGGESTION | Páginas de tratamientos capilares (`TreatmentHero`, `TreatmentAbout`) sin `preset=386` | Abierta, no sincronizada |
| 5 | INFO | Bloqueo de IPs de Cloudflare en algunos operadores durante partidos | Informativa, sin acción en el spec |

## Merge realizado sobre specs principales

### `web-booking-nubimed-client`

**Archivo destino**: `openspec/specs/web-booking-nubimed-client/spec.md`

| Sección delta | Acción | Detalle |
|---------------|--------|---------|
| `MODIFIED` Purpose | Reemplazado | Sin la frase "MAY direct from the browser"; proxy same-origin obligatorio |
| `MODIFIED` REQ-1, REQ-3, REQ-4, REQ-5, REQ-7, REQ-9, REQ-11, REQ-14, REQ-18, REQ-19 | Reemplazados | Texto y escenarios de la delta; marcadores "(Previously: …)" eliminados |
| `MODIFIED` REQ-16 | Reemplazado con **sincronización de drift** (ver abajo) | No es literal de la delta |
| `ADDED` REQ-20, REQ-21, REQ-22, REQ-23 | Añadidos al final | Sin cambios |
| `REMOVED` | Ninguno | La delta lo declara así |

Requisitos conservados sin cambios: REQ-2, REQ-6, REQ-8, REQ-10, REQ-12, REQ-13, REQ-15, REQ-17. Total tras el merge: **23 REQ** (REQ-1..REQ-23), sin duplicados.

#### Drift de REQ-16 sincronizado

- **Delta / spec anterior**: dirección solo desde `PUBLIC_CLINIC_ADDRESS_<CENTRO>`; sin env, solo la etiqueta del centro.
- **Comportamiento enviado** (PR #12, `src/i18n/clinic-locations.ts`, función `clinicLocationsFromEnv`):
  - La dirección sale de `PUBLIC_CLINIC_ADDRESS_BARCELONA` / `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL`; si falta, usa la calle de Nubimed: `C. Calvet 16, Barcelona` y `C. de Mar 41, El Vendrell`.
  - El resumen **siempre** enlaza a Google Maps: `PUBLIC_GOOGLE_MAPS_URL_<CENTRO>` si está definida, o una URL de búsqueda con la dirección mostrada.
- **Resultado**: el main spec describe el comportamiento enviado. El delta original se conserva en la carpeta archivada como auditoría.

#### Advertencias del merge

1. **Idioma mixto.** El main spec estaba en inglés (REQ-2..REQ-17). Los requisitos añadidos o modificados por la delta están en español, tal como se escribieron. No se tradujeron para no alterar el sentido normativo. Recomendado: traducir en un cambio de mantenimiento.
2. **REQ-1: escenario conservado.** La delta reemplaza REQ-1 completo y no incluía "Placeholder localisation". Se conservó porque el placeholder sigue vivo con el flag desactivado.
3. **REQ-16: documentación de `.env.example` pendiente.** El requisito exige documentar las variables en `.env.example`, pero la tarea 7.1 está bloqueada. El requisito queda sin cumplir.
4. **REQ-23 describe una verificación no superada.** El requisito sigue vigente: `bookingPublic` debe permanecer en `false` hasta que haya una cita real con POST 201 registrada.
5. **Posible contradicción no resuelta (REQ-8 y REQ-10 frente a REQ-14).** REQ-8 exige pulsar "Continue" tras elegir profesional, y REQ-14 exige avance automático. No está en la delta y no se tocó. Conviene resolverlo en `nubimed-api-booking`.

### `web-whatsapp-floating-cta` (nuevo)

**Archivo creado**: `openspec/specs/web-whatsapp-floating-cta/spec.md`

- Dominio nuevo: no existía main spec. Se copió la delta como spec completo.
- Solo se cambió el formato: se eliminaron los encabezados vacíos `## MODIFIED Requirements` y `## REMOVED Requirements` y el wrapper `## ADDED Requirements`. Los REQ-1..REQ-6 se mantienen literales.

## Movimiento a archivo

- **Origen**: `openspec/changes/reenable-nubimed-booking/`
- **Destino**: `openspec/changes/archive/2026-11-24-reenable-nubimed-booking/`
- **Contenido del destino**:
  - `proposal.md`
  - `exploration.md`
  - `design.md`
  - `apply-progress.md`
  - `tasks.md`
  - `verify-report.md`
  - `specs/web-booking-nubimed-client/spec.md` (delta, auditoría)
  - `specs/web-whatsapp-floating-cta/spec.md` (delta, auditoría)
  - `archive-report.md` (este documento)
- **Método**: el agente no dispone de comando de mover ni de borrar. Los archivos se **copiaron** leyéndolos y escribiéndolos en el destino. El archive-report se escribió directamente en el destino, sin dejar copia en el origen.
- **Originales**: **no se han borrado**. Ver acciones manuales.

## Acciones manuales pendientes

1. **Verificar y borrar el origen.** Comparar cada archivo copiado con su original (por ejemplo, `fc /b` en Windows) y, si coincide, eliminar `openspec/changes/reenable-nubimed-booking/` completa. La copia se hizo leyendo y reescribiendo; no se comprobó byte a byte.
2. **Cerrar 7.1** (`.env.example`) con las variables de sede, Maps y la Function.
3. **Confirmar PR #15** (`bookingPublic = false`) en `main`.
4. **Abrir en `nubimed-api-booking`** las observaciones 2 y 4 de `verify-report.md`, las tareas 8.1, 8.4, 8.6 y 8.10 y el riesgo de REQ-8/REQ-14.

## Notas para futuros archives del mismo capability

- `web-booking-nubimed-client` ya no es un spec en inglés puro. Antes de editar REQ-1..REQ-23, decidir el idioma.
- El proxy (REQ-21) depende del wrapper Cloudflare Pages Function de este cambio. Si `nubimed-api-booking` lo sustituye, debe emitir su propio delta sobre REQ-11 y REQ-21.
- Cualquier cambio sobre `openspec/specs/web-booking-nubimed-client/spec.md` debe validar encoding (`npm run lint:encoding`).

## SDD Cycle Complete (con problemas conocidos)

El cambio fue planeado, diseñado, especificado e implementado. La verificación de envío real (REQ-23) **falló** y el cierre se hace por necesidad: `nubimed-api-booking` toma el relevo. Los specs principales reflejan el comportamiento enviado, no el objetivo de go-live.
