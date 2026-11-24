import { MAX_BODY_BYTES, parseAvailabilityQuery, validateBookingRequest } from '../../src/features/booking-nubimed/api-contract.ts';
import { containsSlot } from '../../src/features/booking-nubimed/agenda-hours.ts';
import { readConfig } from './env.ts';
import type { BookingEnv } from './env.ts';
import { errorResponse, isSameOrigin, json, mappedErrorResponse } from './http.ts';
import { verifyTurnstile } from './turnstile.ts';
import { createPeticion, getAvailability } from './upstream.ts';
import type { UpstreamDeps } from './upstream.ts';

/**
 * Handler logic as pure functions (Request + env + injected deps) so tests need no network or
 * Cloudflare runtime. This file exports NO `onRequest*`, so Pages generates no route for it.
 * Never log bodies, query, headers, PII or tokens here.
 */

export function handleHealth(env: BookingEnv): Response {
	return readConfig(env) ? json(200, { ok: true }) : errorResponse('config', 503);
}

export async function handleAvailability(request: Request, env: BookingEnv, deps: UpstreamDeps): Promise<Response> {
	const config = readConfig(env);
	if (!config) return errorResponse('config', 503);

	const query = parseAvailabilityQuery(new URL(request.url).searchParams);
	if (!query.ok) return errorResponse('invalid', 400);

	const result = await getAvailability(query.target, config, deps, new URL(request.url).origin);
	return result.ok ? json(200, result.value) : mappedErrorResponse(result.error);
}

type BodyRead = { ok: true; text: string } | { ok: false; tooLarge: boolean };

/** Reads the body as text with a hard byte cap (works without Content-Length). */
async function readLimitedText(request: Request, maxBytes: number): Promise<BodyRead> {
	const declared = Number(request.headers.get('Content-Length'));
	if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, tooLarge: true };
	if (!request.body) return { ok: false, tooLarge: false };

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			return { ok: false, tooLarge: true };
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		merged.set(c, offset);
		offset += c.byteLength;
	}
	return { ok: true, text: new TextDecoder().decode(merged) };
}

function isJsonContentType(request: Request): boolean {
	const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
	return type === 'application/json';
}

function isHoneypotHit(raw: unknown): boolean {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
	const website = (raw as Record<string, unknown>).website;
	return typeof website === 'string' && website.trim().length > 0;
}

/** Check order is REQ-BFF-8; nothing reaches Nubimed before the last step. */
export async function handleRequest(request: Request, env: BookingEnv, deps: UpstreamDeps): Promise<Response> {
	// 1. Content-Type + size
	if (!isJsonContentType(request)) return errorResponse('invalid', 400);
	const read = await readLimitedText(request, MAX_BODY_BYTES);
	if (!read.ok) return errorResponse('invalid', read.tooLarge ? 413 : 400);

	// 2. Same origin
	if (!isSameOrigin(request)) return errorResponse('forbidden', 403);

	let raw: unknown;
	try {
		raw = JSON.parse(read.text);
	} catch {
		return errorResponse('invalid', 400);
	}

	// 3. Honeypot on the RAW body: simulated success, no side effects
	if (isHoneypotHit(raw)) return json(200, { ok: true, status: 'received' });

	// 4. Validation + catalog resolution
	const validated = validateBookingRequest(raw);
	if (!validated.ok) return errorResponse('invalid', 400, validated.fields);
	const req = validated.value;

	const config = readConfig(env);
	if (!config) return errorResponse('config', 503);

	// 5. Turnstile (fail closed; missing token is a Turnstile failure, not a validation error)
	const ip = request.headers.get('CF-Connecting-IP');
	const human = req.turnstileToken
		? await verifyTurnstile(config.turnstileSecret, req.turnstileToken, ip, deps.fetch)
		: false;
	if (!human) return errorResponse('turnstile_failed', 403);

	// 6. Re-check the slot against (cached or fresh) availability
	const availability = await getAvailability(req.target, config, deps, new URL(request.url).origin);
	if (!availability.ok) return mappedErrorResponse(availability.error);
	if (!containsSlot(availability.value.days, req.requestedTime)) return errorResponse('slot_unavailable', 409);

	// 7. Create the request upstream (never retried)
	const created = await createPeticion(req, config, deps);
	return created.ok ? json(200, { ok: true, status: created.status }) : mappedErrorResponse(created.error);
}
