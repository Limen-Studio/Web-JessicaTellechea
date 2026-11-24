/**
 * Launch gates — routes stay in the repo but remain hidden from nav / sitemap / index until enabled.
 * @see docs/site-architecture.md (utility / deferred routes)
 */
export const blogPublic = false;

/** @see docs/site-architecture.md — enable when corporal pillar launches. */
export const corporalPublic = false;

/**
 * Public Nubimed booking flow. `false` → booking CTAs go to WhatsApp and the booking route shows the placeholder.
 * 2026-11-24: re-enabled with the `nubimed-api-booking` change (Nubimed API via the `/api/booking/*` BFF).
 * Verified live by the user (decision: test in production). Rollback = set back to `false` and redeploy.
 */
export const bookingPublic = true;
