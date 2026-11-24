import type { BookingContext } from '../../_lib/env.ts';
import { methodNotAllowed } from '../../_lib/http.ts';
import { handleRequest } from '../../_lib/handlers.ts';
import { defaultDeps } from '../../_lib/upstream.ts';

/** POST /api/booking/request (REQ-BFF-6, REQ-BFF-8). Logic lives in `_lib/handlers.ts`. */
export const onRequestPost = (ctx: BookingContext): Promise<Response> =>
	handleRequest(ctx.request, ctx.env, defaultDeps((p) => ctx.waitUntil(p)));

/** Any other method: 405 (method-specific handlers above take precedence in Pages Functions). */
export const onRequest = (): Response => methodNotAllowed('POST');
