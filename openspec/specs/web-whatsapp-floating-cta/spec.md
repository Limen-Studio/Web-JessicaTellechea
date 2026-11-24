# Web WhatsApp floating CTA — Specification

**Capability:** `web-whatsapp-floating-cta`  
**Source of truth:** `openspec/specs/web-whatsapp-floating-cta/spec.md` (created from archived change `reenable-nubimed-booking`)

Palabras clave normativas (RFC 2119): **SHALL** / **SHALL NOT**, **SHOULD**, **MAY**.

## Requirements

### REQ-1 Floating WhatsApp button on home only

La home de cada locale (`es`, `en`, `ca`, `fr`) **SHALL** renderizar un botón flotante de WhatsApp. Ninguna otra página (incluidas reserva, pilares, contacto, legales y blog) **SHALL** renderizarlo. El botón **SHALL** ser un ancla estática sin hidratación de JavaScript.

#### Scenario: Home muestra el botón

- GIVEN `PUBLIC_WHATSAPP_E164` definida
- WHEN se carga la home en cualquier locale
- THEN el botón flotante **SHALL** estar presente

#### Scenario: Otras páginas no lo muestran

- GIVEN `PUBLIC_WHATSAPP_E164` definida
- WHEN se carga la página de reserva, un pilar o contacto
- THEN el botón flotante **SHALL NOT** estar presente

---

### REQ-2 Position and behavior

El botón **SHALL** estar fijo (sticky) en la esquina inferior derecha del viewport, respetando `env(safe-area-inset-*)`. Su `href` **SHALL** ser `https://wa.me/${PUBLIC_WHATSAPP_E164}`, con `target="_blank"` y `rel="noopener noreferrer"`. El botón **SHALL NOT** solaparse con el banner de consentimiento de cookies ni con el drawer de navegación móvil abierto (**SHALL** quedar por debajo de ambos en el eje z, o desplazarse, de modo que ninguna acción de esos elementos quede tapada).

#### Scenario: Enlace de WhatsApp

- GIVEN `PUBLIC_WHATSAPP_E164` definida
- WHEN se inspecciona el botón
- THEN `href` **SHALL** ser `https://wa.me/${PUBLIC_WHATSAPP_E164}`
- AND **SHALL** incluir `target="_blank"` y `rel="noopener noreferrer"`

#### Scenario: Banner de cookies visible

- GIVEN el banner de cookies visible en viewport móvil
- WHEN la home se muestra
- THEN el botón **SHALL NOT** ocultar ningún control del banner

#### Scenario: Drawer móvil abierto

- GIVEN el drawer de navegación móvil abierto
- WHEN se muestra la home
- THEN el botón **SHALL NOT** tapar ningún enlace ni CTA del drawer

---

### REQ-3 No render without env

Si `PUBLIC_WHATSAPP_E164` falta en build, el botón **SHALL NOT** renderizarse y **SHALL NOT** haber fallback a la página de contacto ni a otra URL.

#### Scenario: Env ausente

- GIVEN `PUBLIC_WHATSAPP_E164` no definida
- WHEN se construye y carga la home
- THEN no **SHALL** existir ningún elemento del botón flotante en el DOM

---

### REQ-4 Accessibility and i18n

El botón **SHALL** tener nombre accesible localizado en es, en, ca y fr (por ejemplo `aria-label`), y el glifo SVG decorativo **SHALL** ocultarse a tecnologías de apoyo. El botón **SHALL** ser operable por teclado con indicador de foco visible. El contraste del glifo frente al fondo y del indicador de foco **SHALL** cumplir WCAG 2.1 AA (3:1 para componentes gráficos).

#### Scenario: Nombre accesible por locale

- GIVEN la home en `fr`
- WHEN se inspecciona el nombre accesible del botón
- THEN **SHALL** estar en francés

#### Scenario: Foco por teclado

- GIVEN el foco llega al botón con Tab
- WHEN se muestra el estado de foco
- THEN **SHALL** haber un indicador visible con contraste AA

---

### REQ-5 Corporate tokens, not green

El botón **SHALL** usar únicamente tokens del tema corporativo (por ejemplo `--color-accent` con glifo `--color-on-accent`, o `--color-champagne`) y **SHALL NOT** usar el verde de marca de WhatsApp ni colores hexadecimales literales fuera de `theme.css`. Los estilos **SHALL** residir en `src/styles/components/`.

#### Scenario: Colores del tema

- GIVEN el CSS del botón
- WHEN se inspeccionan fondo, glifo y foco
- THEN todos **SHALL** referenciar tokens del tema
- AND **SHALL NOT** usar `#25D366` ni tonos de verde de WhatsApp

---

### REQ-6 Reduced motion

Cualquier animación de entrada o hover **SHALL** aplicarse solo bajo `prefers-reduced-motion: no-preference`; con `reduce` el botón **SHALL** mostrarse sin animación.

#### Scenario: Preferencia de movimiento reducido

- GIVEN `prefers-reduced-motion: reduce`
- WHEN carga la home
- THEN el botón **SHALL** aparecer sin animación de entrada
