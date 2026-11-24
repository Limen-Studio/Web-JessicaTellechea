import type {
	AvailabilityResponse,
	BookingErrorCode,
	BookingRequestBody,
	BookingResponse,
} from './api-contract.ts';
import type { CentroKey, ServiceKind, SpecialtyId } from './catalog.ts';

/** Same-origin BFF endpoints (AD-1). The island never talks to the vendor. */
const AVAILABILITY_PATH = '/api/booking/availability';
const REQUEST_PATH = '/api/booking/request';

const ERROR_CODES: readonly BookingErrorCode[] = [
	'invalid',
	'forbidden',
	'turnstile_failed',
	'slot_unavailable',
	'busy',
	'config',
	'upstream',
	'unknown',
];

export interface AvailabilityTarget {
	readonly specialty: SpecialtyId;
	readonly centro: CentroKey;
	readonly kind: ServiceKind;
}

export class BookingApiError extends Error {
	readonly code: BookingErrorCode;
	readonly fields?: string[];
	readonly retryAfter?: number;
	constructor(code: BookingErrorCode, fields?: string[], retryAfter?: number) {
		super(code);
		this.name = 'BookingApiError';
		this.code = code;
		if (fields && fields.length > 0) this.fields = fields;
		if (retryAfter !== undefined) this.retryAfter = retryAfter;
	}
}

type FetchLike = typeof fetch;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAbort(e: unknown): boolean {
	return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

function knownCode(v: unknown): BookingErrorCode | null {
	return typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v) ? (v as BookingErrorCode) : null;
}

function parseRetryAfter(res: Response): number | undefined {
	const raw = res.headers.get('Retry-After');
	if (raw === null) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function readJson(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return undefined;
	}
}

/** Maps an error body to `BookingApiError`; any unrecognised shape falls back to `fallback`. */
function toApiError(res: Response, data: unknown, fallback: BookingErrorCode): BookingApiError {
	if (isRecord(data) && data.ok === false) {
		const code = knownCode(data.code);
		if (code) {
			const fields = Array.isArray(data.fields)
				? data.fields.filter((f): f is string => typeof f === 'string')
				: undefined;
			return new BookingApiError(code, fields, parseRetryAfter(res));
		}
	}
	return new BookingApiError(fallback);
}

export function availabilityUrl(target: AvailabilityTarget): string {
	const q = new URLSearchParams({
		specialty: String(target.specialty),
		centro: target.centro,
		kind: target.kind,
	});
	return `${AVAILABILITY_PATH}?${q.toString()}`;
}

function isAvailability(v: unknown): v is AvailabilityResponse {
	if (!isRecord(v) || v.ok !== true) return false;
	if (typeof v.from !== 'string' || typeof v.to !== 'string' || !isRecord(v.days)) return false;
	return Object.values(v.days).every((d) => Array.isArray(d) && d.every((s) => typeof s === 'string'));
}

/** One availability load per (specialty, centro, kind). Network/JSON failure => `upstream`. */
export async function fetchAvailability(
	signal: AbortSignal,
	target: AvailabilityTarget,
	fetchImpl: FetchLike = fetch,
): Promise<AvailabilityResponse> {
	let res: Response;
	try {
		res = await fetchImpl(availabilityUrl(target), { method: 'GET', signal, headers: { Accept: 'application/json' } });
	} catch (e) {
		if (isAbort(e)) throw e;
		throw new BookingApiError('upstream');
	}
	const data = await readJson(res);
	if (res.ok && isAvailability(data)) return data;
	throw toApiError(res, data, 'upstream');
}

/**
 * Single POST, never retried. Network failure or unreadable response => `unknown`:
 * the request may have reached the server, so the UI must not invite a resend.
 */
export async function submitBookingRequest(
	signal: AbortSignal,
	body: BookingRequestBody,
	fetchImpl: FetchLike = fetch,
): Promise<BookingResponse> {
	let res: Response;
	try {
		res = await fetchImpl(REQUEST_PATH, {
			method: 'POST',
			signal,
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(body),
		});
	} catch (e) {
		if (isAbort(e)) throw e;
		throw new BookingApiError('unknown');
	}
	const data = await readJson(res);
	if (res.ok && isRecord(data) && data.ok === true && (data.status === 'confirmed' || data.status === 'received')) {
		return { ok: true, status: data.status };
	}
	throw toApiError(res, data, 'unknown');
}
