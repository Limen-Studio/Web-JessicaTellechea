import { resolveBookingTarget } from './catalog.ts';
import type { BookingTarget, CentroKey, ServiceKind, SpecialtyId } from './catalog.ts';

/** Error codes shared by the BFF and the island (AD-6). */
export type BookingErrorCode =
	| 'invalid'
	| 'forbidden'
	| 'turnstile_failed'
	| 'slot_unavailable'
	| 'busy'
	| 'config'
	| 'upstream'
	| 'unknown';

export type BookingStatus = 'confirmed' | 'received';

export interface BookingRequestBody {
	specialty: SpecialtyId;
	centro: CentroKey;
	kind: ServiceKind;
	/** Exact ISO string received from availability. */
	requestedTime: string;
	patient: { name: string; surname: string; phonePrefix: string; phone: string; email: string };
	comments?: string;
	consent: true;
	turnstileToken: string;
	/** Honeypot; must stay empty for humans. */
	website?: string;
}

export interface AvailabilityResponse {
	ok: true;
	from: string;
	to: string;
	days: Record<string, string[]>;
}

export interface BookingResponse {
	ok: true;
	status: BookingStatus;
}

export interface BookingErrorResponse {
	ok: false;
	code: BookingErrorCode;
	fields?: string[];
}

export const MAX_BODY_BYTES = 8 * 1024;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;
export const COMMENTS_MAX = 500;
export const PHONE_MIN_DIGITS = 6;
export const PHONE_MAX_DIGITS = 15;
export const TURNSTILE_TOKEN_MAX = 2048;

/**
 * Upstream `state` value that means "accepted". Single named constant: confirm
 * the real value in the live test (tasks 13.9) and change it here only.
 */
export const ACCEPTED_STATE = 'aceptada';

const PHONE_PREFIX_RE = /^[1-9]\d{0,3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const TOP_KEYS = new Set([
	'specialty',
	'centro',
	'kind',
	'requestedTime',
	'patient',
	'comments',
	'consent',
	'turnstileToken',
	'website',
]);
const PATIENT_KEYS = new Set(['name', 'surname', 'phonePrefix', 'phone', 'email']);

export interface ValidatedBookingRequest {
	target: BookingTarget;
	requestedTime: string;
	patient: { name: string; surname: string; phonePrefix: string; phone: string; email: string };
	comments?: string;
	turnstileToken?: string;
	website?: string;
}

export type ValidationResult =
	| { ok: true; value: ValidatedBookingRequest }
	| { ok: false; fields: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOnlyKeys(o: Record<string, unknown>, allowed: Set<string>): boolean {
	return Object.keys(o).every((k) => allowed.has(k));
}

function validIsoWithOffset(v: unknown): v is string {
	return (
		typeof v === 'string' &&
		v.length <= 40 &&
		ISO_WITH_OFFSET_RE.test(v) &&
		!Number.isNaN(Date.parse(v))
	);
}

export function validateBookingRequest(body: unknown): ValidationResult {
	if (!isRecord(body)) return { ok: false, fields: [] };

	const fields: string[] = [];
	// Unknown keys (incl. raw vendor ids) invalidate the request; names are never echoed.
	let unknownKeys = !hasOnlyKeys(body, TOP_KEYS);

	const { specialty, centro, kind } = body;
	if (resolveBookingTarget(specialty, 'barcelona', 'firstVisit') === null) fields.push('specialty');
	if (resolveBookingTarget(3, centro, 'firstVisit') === null) fields.push('centro');
	if (resolveBookingTarget(3, 'barcelona', kind) === null) fields.push('kind');

	if (!validIsoWithOffset(body.requestedTime)) fields.push('requestedTime');

	let name = '';
	let surname = '';
	let phonePrefix = '';
	let phone = '';
	let email = '';
	const p = body.patient;
	if (!isRecord(p)) {
		fields.push('patient');
	} else {
		if (!hasOnlyKeys(p, PATIENT_KEYS)) unknownKeys = true;

		name = typeof p.name === 'string' ? p.name.trim() : '';
		if (name.length < 1 || name.length > NAME_MAX) fields.push('name');

		surname = typeof p.surname === 'string' ? p.surname.trim() : '';
		if (surname.length < 1 || surname.length > NAME_MAX) fields.push('surname');

		phonePrefix = typeof p.phonePrefix === 'string' ? p.phonePrefix : '';
		if (!PHONE_PREFIX_RE.test(phonePrefix)) fields.push('phonePrefix');

		phone = typeof p.phone === 'string' ? p.phone.replace(/[\s-]/g, '') : '';
		if (!/^\d+$/.test(phone) || phone.length < PHONE_MIN_DIGITS || phone.length > PHONE_MAX_DIGITS) {
			fields.push('phone');
		}

		email = typeof p.email === 'string' ? p.email.trim() : '';
		if (email.length === 0 || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) fields.push('email');
	}

	let comments: string | undefined;
	if (body.comments !== undefined) {
		if (typeof body.comments !== 'string') {
			fields.push('comments');
		} else {
			const c = body.comments.trim();
			if (c.length > COMMENTS_MAX) fields.push('comments');
			else if (c.length > 0) comments = c;
		}
	}

	if (body.consent !== true) fields.push('consent');

	let turnstileToken: string | undefined;
	if (body.turnstileToken !== undefined) {
		if (typeof body.turnstileToken !== 'string' || body.turnstileToken.length > TURNSTILE_TOKEN_MAX) {
			fields.push('turnstileToken');
		} else {
			turnstileToken = body.turnstileToken;
		}
	}

	let website: string | undefined;
	if (body.website !== undefined) {
		if (typeof body.website !== 'string') fields.push('website');
		else website = body.website;
	}

	const target = resolveBookingTarget(specialty, centro, kind);
	if (fields.length > 0 || unknownKeys || target === null) return { ok: false, fields };

	return {
		ok: true,
		value: {
			target,
			requestedTime: body.requestedTime as string,
			patient: { name, surname, phonePrefix, phone, email },
			comments,
			turnstileToken,
			website,
		},
	};
}

export type AvailabilityQueryResult = { ok: true; target: BookingTarget } | { ok: false };

const QUERY_KEYS = ['specialty', 'centro', 'kind'];

/** Accepts exactly `specialty`, `centro`, `kind` (each once); anything else is invalid. */
export function parseAvailabilityQuery(params: URLSearchParams): AvailabilityQueryResult {
	const seen = new Set<string>();
	for (const key of params.keys()) {
		if (!QUERY_KEYS.includes(key) || seen.has(key)) return { ok: false };
		seen.add(key);
	}
	if (seen.size !== QUERY_KEYS.length) return { ok: false };

	const s = params.get('specialty');
	const specialty = s === '3' ? 3 : s === '386' ? 386 : null;
	const target = resolveBookingTarget(specialty, params.get('centro'), params.get('kind'));
	return target ? { ok: true, target } : { ok: false };
}

/**
 * `confirmed` only with a non-empty `assigned_time` or the accepted state; anything else is
 * `received`. Never returns the upstream id, PII or body.
 */
export function detectBookingStatus(upstreamBody: unknown): BookingStatus {
	if (!isRecord(upstreamBody)) return 'received';
	const t = upstreamBody.assigned_time;
	if (typeof t === 'string' && t.trim().length > 0) return 'confirmed';
	return upstreamBody.state === ACCEPTED_STATE ? 'confirmed' : 'received';
}
