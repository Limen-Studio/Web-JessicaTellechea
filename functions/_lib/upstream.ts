import { availabilityWindow, groupByMadridDay, parseAgendaHours } from '../../src/features/booking-nubimed/agenda-hours.ts';
import { detectBookingStatus } from '../../src/features/booking-nubimed/api-contract.ts';
import type {
	AvailabilityResponse,
	BookingStatus,
	ValidatedBookingRequest,
} from '../../src/features/booking-nubimed/api-contract.ts';
import { MODALITY } from '../../src/features/booking-nubimed/catalog.ts';
import type { BookingTarget } from '../../src/features/booking-nubimed/catalog.ts';
import type { BookingConfig } from './env.ts';
import { mapUpstreamError } from './upstream-errors.ts';
import type { MappedError, UpstreamEndpoint, UpstreamOutcome } from './upstream-errors.ts';

/** Minimal Cache API surface (satisfied by the DOM `Cache`); lets tests inject a fake. */
export interface CacheLike {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

export interface UpstreamDeps {
	fetch: typeof fetch;
	sleep: (ms: number) => Promise<void>;
	/** `null` when no Cache API is available (degrade silently). */
	getCache: () => Promise<CacheLike | null>;
	waitUntil: (promise: Promise<unknown>) => void;
	now: () => Date;
}

export type UpstreamResult = { ok: true; body: unknown } | { ok: false; error: MappedError };

const GET_TIMEOUT_MS = 8000;
const POST_TIMEOUT_MS = 10000;
const GET_RETRY_DELAY_MS = 300;
const CACHE_NAME = 'booking-availability';
const CACHE_TTL_SECONDS = 60;

export function defaultDeps(waitUntil: (promise: Promise<unknown>) => void): UpstreamDeps {
	return {
		fetch: (input, init) => fetch(input, init),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		getCache: async () => (typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME)),
		waitUntil,
		now: () => new Date(),
	};
}

interface FetchOptions {
	query?: Record<string, string>;
	body?: unknown;
}

async function readJson(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return null;
	}
}

/**
 * One Nubimed call. GET: a single retry (~300 ms) on 5xx/network/timeout. POST: never retried;
 * `sent` is false only if it failed before the request left (URL/headers/body construction).
 * Logs only endpoint + status, and only for config/upstream outcomes. Never bodies, query or PII.
 */
export async function nubimedFetch(
	config: BookingConfig,
	endpoint: UpstreamEndpoint,
	method: 'GET' | 'POST',
	path: string,
	deps: UpstreamDeps,
	opts: FetchOptions = {},
): Promise<UpstreamResult> {
	let url: string;
	let headers: Headers;
	let body: string | undefined;
	try {
		const u = new URL(`${config.apiBase}${path}`);
		for (const [k, v] of Object.entries(opts.query ?? {})) u.searchParams.set(k, v);
		url = u.toString();
		headers = new Headers({
			'X-User-Email': config.email,
			'X-User-Token': config.token,
			'User-Agent': 'JT',
			Accept: 'application/json',
		});
		if (method === 'POST') {
			headers.set('Content-Type', 'application/json');
			body = JSON.stringify(opts.body ?? {});
		}
	} catch {
		return fail(endpoint, { kind: 'network', sent: false });
	}

	const attempts = method === 'GET' ? 2 : 1;
	let outcome: UpstreamOutcome = { kind: 'network', sent: true };
	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (attempt > 1) await deps.sleep(GET_RETRY_DELAY_MS);
		let res: Response;
		try {
			res = await deps.fetch(url, {
				method,
				headers,
				body,
				signal: AbortSignal.timeout(method === 'GET' ? GET_TIMEOUT_MS : POST_TIMEOUT_MS),
			});
		} catch {
			outcome = { kind: 'network', sent: true };
			continue;
		}

		if (res.ok) {
			const parsed = await readJson(res);
			if (parsed === null && method === 'GET') {
				outcome = { kind: 'network', sent: true };
				continue;
			}
			return { ok: true, body: parsed };
		}

		outcome = {
			kind: 'http',
			status: res.status,
			retryAfter: res.headers.get('Retry-After'),
			body: res.status === 422 ? await readJson(res) : undefined,
		};
		if (res.status < 500) break;
	}
	return fail(endpoint, outcome);
}

function fail(endpoint: UpstreamEndpoint, outcome: UpstreamOutcome): UpstreamResult {
	const error = mapUpstreamError(endpoint, outcome);
	if (error.code === 'config' || error.code === 'upstream') {
		console.warn('booking', endpoint, outcome.kind === 'http' ? outcome.status : 'network');
	}
	return { ok: false, error };
}

export type AvailabilityResult = { ok: true; value: AvailabilityResponse } | { ok: false; error: MappedError };

const toUpstreamDate = (ymd: string) => ymd.replaceAll('-', '');

async function readCache(cache: CacheLike | null, key: Request): Promise<AvailabilityResponse | null> {
	if (!cache) return null;
	try {
		const hit = await cache.match(key);
		if (!hit) return null;
		const v = (await hit.json()) as AvailabilityResponse;
		return v && v.ok === true && typeof v.days === 'object' ? v : null;
	} catch {
		return null;
	}
}

/**
 * Availability for one agenda/service over the server-fixed window, via Cache API (60 s,
 * key without PII). Any cache failure is ignored. Never calls the agenda listing endpoint.
 */
export async function getAvailability(
	target: BookingTarget,
	config: BookingConfig,
	deps: UpstreamDeps,
	origin: string,
): Promise<AvailabilityResult> {
	const { from, to } = availabilityWindow(deps.now());
	const key = new Request(`${origin}/__cache/booking/availability/v1/${target.agendaId}/${target.serviceId}/${from}`);

	let cache: CacheLike | null = null;
	try {
		cache = await deps.getCache();
	} catch {
		cache = null;
	}

	const cached = await readCache(cache, key);
	if (cached) return { ok: true, value: cached };

	const res = await nubimedFetch(config, 'availability', 'GET', `/agendas/${target.agendaId}`, deps, {
		query: {
			start_date: toUpstreamDate(from),
			end_date: toUpstreamDate(to),
			service_id: String(target.serviceId),
			modality: MODALITY,
		},
	});
	if (!res.ok) return res;

	const value: AvailabilityResponse = { ok: true, from, to, days: groupByMadridDay(parseAgendaHours(res.body)) };
	if (cache) {
		const c = cache;
		deps.waitUntil(
			(async () => {
				try {
					await c.put(
						key,
						new Response(JSON.stringify(value), {
							headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
						}),
					);
				} catch {
					/* cache is best effort */
				}
			})(),
		);
	}
	return { ok: true, value };
}

export type PeticionResult = { ok: true; status: BookingStatus } | { ok: false; error: MappedError };

/** Creates the booking request. Returns only the detected status: never the upstream id, PII or body. */
export async function createPeticion(
	req: ValidatedBookingRequest,
	config: BookingConfig,
	deps: UpstreamDeps,
): Promise<PeticionResult> {
	const payload: Record<string, unknown> = {
		clinica_id: config.clinicId,
		speciality_id: req.target.specialtyId,
		schedule_id: req.target.agendaId,
		service_id: req.target.serviceId,
		requested_time: req.requestedTime,
		patient_name: req.patient.name,
		patient_surname: req.patient.surname,
		patient_phone: req.patient.phone.replace(/\D/g, ''),
		patient_country_calling_code: req.patient.phonePrefix,
		patient_email: req.patient.email,
		modality: MODALITY,
	};
	if (req.comments) payload.comments = req.comments;

	const res = await nubimedFetch(config, 'request', 'POST', '/cita_peticiones', deps, { body: payload });
	if (!res.ok) return res;
	return { ok: true, status: detectBookingStatus(res.body) };
}
