/**
 * Launch gates — routes stay in the repo but remain hidden from nav / sitemap / index until enabled.
 * @see docs/site-architecture.md (utility / deferred routes)
 */
export const blogPublic = false;

/** @see docs/site-architecture.md — enable when corporal pillar launches. */
export const corporalPublic = false;

/** Public Nubimed booking flow. Keep `false` until Phase 8 verification passes (rollback = set back to false). */
export const bookingPublic = true;
