import type { BookingErrorCode } from '../../src/features/booking-nubimed/api-contract.ts';
import type { MappedError } from './upstream-errors.ts';

/** Mandatory on every BFF response; cannot be overridden by `extra`. */
const BASE_HEADERS = {
	'Content-Type': 'application/json',
	'Cache-Control': 'no-store',
	'X-Robots-Tag': 'noindex, nofollow',
};

export function json(status: number, body: unknown, extra?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), { status, headers: { ...extra, ...BASE_HEADERS } });
}

export function errorResponse(
	code: BookingErrorCode,
	status: number,
	fields?: string[],
	extra?: Record<string, string>,
): Response {
	const body: { ok: false; code: BookingErrorCode; fields?: string[] } = { ok: false, code };
	if (fields && fields.length > 0) body.fields = fields;
	return json(status, body, extra);
}

/** Fallback for methods a route does not handle (`onRequest` catch-all; method-specific handlers win). */
export function methodNotAllowed(allow: string): Response {
	return errorResponse('invalid', 405, undefined, { Allow: allow });
}

export function mappedErrorResponse(m: MappedError): Response {
	const extra = m.retryAfter !== undefined ? { 'Retry-After': String(m.retryAfter) } : undefined;
	return errorResponse(m.code, m.status, m.fields, extra);
}

/** `Origin` must equal the request origin; without `Origin`, `Sec-Fetch-Site` must be `same-origin`. */
export function isSameOrigin(request: Request): boolean {
	const origin = request.headers.get('Origin');
	if (origin !== null) return origin === new URL(request.url).origin;
	return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}
