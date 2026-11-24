/**
 * Launch gates — routes stay in the repo but remain hidden from nav / sitemap / index until enabled.
 * @see docs/site-architecture.md (utility / deferred routes)
 */
export const blogPublic = false;

/** @see docs/site-architecture.md — enable when corporal pillar launches. */
export const corporalPublic = false;

/**
 * Public Nubimed booking flow. `false` → booking CTAs go to WhatsApp and the booking route shows the placeholder.
 * Disabled 2026-11-24: the portal wrapper's submit fails ("Recaptcha Validation Error"; Nubimed won't authorize
 * our domain on its reCAPTCHA key). Re-enable when the `nubimed-api-booking` change (Nubimed API + BFF) ships.
 */
export const bookingPublic = false;
