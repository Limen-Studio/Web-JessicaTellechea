# Stack and Deployment Context - Dra. Jessica Tellechea Public Website

## Target Stack Summary

- **Framework:** [Astro](https://astro.build/) with **TypeScript**.
- **UI:** Astro components + **Tailwind CSS v4 (CSS-first)** (`@import "tailwindcss"`), design tokens in `@theme` under `src/styles/theme.css`, verified flows styled via layered partials under `src/styles/components/`; **optional islands** (Preact via `@astrojs/preact`, or React) for high-interaction sections (motion, carousels, booking) with hydration directives (`client:visible`, `client:load`, etc.).
- **Content:** Prefer **content in the repository** (Markdown/MDX or Astro content collections) so copy and structure stay reviewable in Git and friendly to AI-assisted authoring.
- **Hosting context:** **Cloudflare Pages** with **Pages Functions** (git deploy). **Build target:** static Astro output (`astro build` → `dist/`); no SSR and no Astro adapter. The only server code is the same-origin Nubimed proxy Function.

This document defines platform context for future specs. It is not a step-by-step deployment tutorial.

## Why This Direction

- **Reproducibility:** Build from Git; same pipeline locally and in CI; no dependency on clicking together the majority of pages in a hosted CMS.
- **Maintainability:** Layout, design tokens (`@theme` + legacy `:root` aliases), reusable primitives under `src/components/ui/`, and default copy live in code; changes are PR-reviewable.
- **“Wow” UX:** Astro stays lean by default; heavy client effects are scoped to explicit islands and optimized assets.

## Hosting Context (High-Level)

- **Current hosting:** **Cloudflare Pages**, deployed from Git. The public site is a **fully static** Astro build served from `dist/`.
- **Single server-side exception:** `functions/__nubimed-proxy/[[path]].ts`, a Pages Function that proxies the Nubimed booking flow same-origin (allowlisted routes and methods, `Set-Cookie` without `Domain`, `no-store`, **no logging of request/response bodies**). No other Function, SSR, or general backend; adding any requires a docs + product decision.
- Performance, caching, HTTPS, and backup/restore remain **validation items** against the Cloudflare dashboard.

## Content and Editorial Model

- **Primary:** Developers (and agents) edit MDX/Markdown and components in Git.
- **Non-developer editing (optional later):** If the business needs a visual CMS without abandoning Astro, evaluate a **headless CMS** or git-based CMS in a later spec—**not assumed** in the current baseline.

## Cross-Cutting Concerns (For Future Specs)

| Concern | Direction |
|--------|-----------|
| **SEO** | Per-route metadata, sitemap, hreflang aligned with `docs/seo-and-localization.md`. |
| **Multilingual** | URL strategy from SEO doc; implement with Astro i18n routing or equivalent. |
| **Forms / valuation** | No first-party server-side form handling; use a **third-party form backend** or external endpoint (e.g. `PUBLIC_FORM_POST_URL`). The Nubimed proxy Function is not a general form endpoint. |
| **Booking** | Utility route `/reservar-cita/`; `noindex`, out of sitemap and primary nav. Reactivated behind `bookingPublic` in `src/i18n/site-features.ts` (off = WhatsApp/contact CTAs). **First-party Nubimed flow** (clinic 1212; specialties 3 and 386; centros Barcelona / El Vendrell as geographic areas; IDs only in `src/features/booking-nubimed/config.ts`): Preact island calls the **same-origin proxy** `/__nubimed-proxy/` (Pages Function); optional `PUBLIC_NUBIMED_PROXY_URL` overrides the base (local dev), optional `PUBLIC_NUBIMED_PORTAL_NEW_URL` for degradation. Centro addresses: `PUBLIC_CLINIC_ADDRESS_BARCELONA`, `PUBLIC_CLINIC_ADDRESS_EL_VENDRELL` (build time). Function runtime env (Cloudflare dashboard): `PUBLIC_NUBIMED_CLINICA_ID` (required), `PUBLIC_NUBIMED_VENDOR_ORIGIN` (optional). Every `PUBLIC_*` used at build must also be set in the Cloudflare build env. |
| **Practice/contact data** | Public operational fields come from `.env`: `PUBLIC_CLINIC_ADDRESS`, `PUBLIC_CLINIC_PHONE`, `PUBLIC_CLINIC_EMAIL`, `PUBLIC_CLINIC_INSTAGRAM`, and `PUBLIC_GOOGLE_MAPS_URL` (env var names retained as technical identifiers). Use `PUBLIC_CLINIC_PHONE` for visible phone text; keep `PUBLIC_WHATSAPP_E164` for WhatsApp/`wa.me` links only. These values are public and baked into static HTML/JS at build time. |
| **Legal pages** | Static MDX per locale; legal review before launch. |
| **Images/media** | `public/` or remote CDN; lazy loading and format strategy in implementation spec. |

## Decided vs Undecided

### Decided

- Public site implementation stack: **Astro + TypeScript**.
- **Content-first-in-repo** bias for core pages and messaging structure.
- **Cloudflare Pages** (git deploy) as hosting; **static** Astro build (`dist/`), no SSR/adapter. The Nubimed proxy Function is the only server code.
- Booking route exists in IA but is **not** a primary nav item by default (`docs/site-architecture.md`).

### Undecided

- Form submission and notification vendor (email API, serverless, third-party form SaaS, etc.).
- CI/CD tool and preview environments.
- Optional headless CMS for non-technical editors.
- Analytics and observability tooling.

## Relationship to Source Dossier

The PDF dossier may describe a different historical execution path (e.g. visual page builders). **This repository’s implementation path is Astro from source**, per this document; dossier remains authoritative for **business intent and IA**, not for builder-specific steps.

## Despliegue en Cloudflare Pages (pipeline de referencia)

> **Hosting:** **Cloudflare Pages** con **Pages Functions**, despliegue por Git. El sitio sigue siendo **estatico** (`astro build` → `dist/`, sin adaptador ni SSR); la unica Function es el proxy same-origin de Nubimed en `functions/__nubimed-proxy/[[path]].ts`.

1. **Build:** Cloudflare ejecuta `npm ci` y `npm run build`; directorio de salida `dist/`. Las `PUBLIC_*` que se usan en build deben definirse tambien en el entorno de build de Cloudflare.
2. **Functions:** el directorio `functions/` en la raiz se despliega automaticamente junto a `dist/`. Variables de **runtime** de la Function (dashboard de Pages): `PUBLIC_NUBIMED_CLINICA_ID` (obligatoria; si falta o es invalida responde 503) y `PUBLIC_NUBIMED_VENDOR_ORIGIN` (opcional).
3. **Prueba local de la Function:** `npm run build` y luego `npx wrangler pages dev dist --binding PUBLIC_NUBIMED_CLINICA_ID=1212`.
4. **Raiz `/`:** el proyecto usa redireccion en `src/pages/index.astro` hacia el idioma por defecto (`/es/`); el build estatico emite un HTML con meta refresh. Si se necesita, se puede sustituir por una regla de redireccion de Cloudflare.
5. **Formularios:** sin handling server-side propio; el formulario de valoracion POSTea a destino externo configurado con `PUBLIC_FORM_POST_URL` (ver `.env.example`). La Function de Nubimed no es un endpoint de formularios general.
6. **Privacidad:** la Function no registra bodies de peticion ni respuesta (contienen datos de pacientes).

Actualizar `SITE_URL` en `.env` al dominio definitivo antes del go-live (canonical, sitemap y OG). El `robots.txt` se **genera en build** desde `src/pages/robots.txt.ts` (linea `Sitemap` y `Disallow` de reservas y de `/__nubimed-proxy/` alineados con `SITE_URL` y `src/i18n/route-registry.ts`).

Los datos visibles de la consulta se configuran con variables publicas en `.env`: `PUBLIC_CLINIC_ADDRESS`, `PUBLIC_CLINIC_PHONE`, `PUBLIC_CLINIC_EMAIL`, `PUBLIC_CLINIC_INSTAGRAM` y `PUBLIC_GOOGLE_MAPS_URL` (nombres de env preservados como identificadores tecnicos). `PUBLIC_CLINIC_PHONE` es el formato humano para UI/tel links; `PUBLIC_WHATSAPP_E164` se reserva para enlaces `wa.me` sin simbolos.

## Variables legales opcionales (`PUBLIC_LEGAL_*`)

Para sustituir los marcadores del responsable en privacidad, cookies y aviso legal sin tocar el codigo, puede definir en `.env` (ver `.env.example`): `PUBLIC_LEGAL_CONTROLLER_NAME`, `PUBLIC_LEGAL_CONTROLLER_NIF`, `PUBLIC_LEGAL_CONTROLLER_ADDRESS`, `PUBLIC_LEGAL_CONTROLLER_EMAIL` y opcionalmente `PUBLIC_LEGAL_DPO_EMAIL`. Son valores **publicos** embebidos en el HTML estatico en build; no almacenar secretos. Si faltan, el sitio muestra textos marcador `[...]` hasta que el negocio los rellene; la revision juridica sigue siendo responsabilidad del titular.
