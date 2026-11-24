import type { BookingContext } from '../../_lib/env.ts';
import { methodNotAllowed } from '../../_lib/http.ts';
import { handleAvailability } from '../../_lib/handlers.ts';
import { defaultDeps } from '../../_lib/upstream.ts';

/** GET /api/booking/availability?specialty&centro&kind (REQ-BFF-4). Logic lives in `_lib/handlers.ts`. */
export const onRequestGet = (ctx: BookingContext): Promise<Response> =>
	handleAvailability(ctx.request, ctx.env, defaultDeps((p) => ctx.waitUntil(p)));

/** Any other method: 405 (method-specific handlers above take precedence in Pages Functions). */
export const onRequest = (): Response => methodNotAllowed('GET');
