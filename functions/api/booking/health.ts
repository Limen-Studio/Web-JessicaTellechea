import type { BookingContext } from '../../_lib/env.ts';
import { methodNotAllowed } from '../../_lib/http.ts';
import { handleHealth } from '../../_lib/handlers.ts';

/** GET /api/booking/health: config presence only; no upstream call, no values. */
export const onRequestGet = (ctx: BookingContext): Response => handleHealth(ctx.env);

/** Any other method: 405 (method-specific handlers above take precedence in Pages Functions). */
export const onRequest = (): Response => methodNotAllowed('GET');
