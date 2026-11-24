import type { BookingErrorCode } from '../../src/features/booking-nubimed/api-contract.ts';

export type UpstreamEndpoint = 'availability' | 'request';

export type UpstreamOutcome =
	| { kind: 'http'; status: number; retryAfter?: string | number | null; body?: unknown }
	/** Network error or timeout. `sent` = the request may have reached Nubimed (POST only matters). */
	| { kind: 'network'; sent: boolean };

export interface MappedError {
	status: number;
	code: BookingErrorCode;
	fields?: string[];
	retryAfter?: number;
}

const DEFAULT_RETRY_AFTER = 60;

/** Upstream 422 field keys => our own field names. Anything else is dropped. */
const FIELD_MAP: Record<string, string> = {
	patient_name: 'name',
	patient_surname: 'surname',
	patient_phone: 'phone',
	patient_country_calling_code: 'phonePrefix',
	patient_email: 'email',
	comments: 'comments',
	requested_time: 'requestedTime',
};

function parseRetryAfter(v: string | number | null | undefined): number {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
	return Number.isInteger(n) && n > 0 ? n : DEFAULT_RETRY_AFTER;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mapFields(body: unknown): string[] {
	if (!isRecord(body)) return [];
	const keys = new Set(Object.keys(body));
	if (isRecord(body.errors)) for (const k of Object.keys(body.errors)) keys.add(k);
	const out = new Set<string>();
	for (const k of keys) {
		if (Object.hasOwn(FIELD_MAP, k)) out.add(FIELD_MAP[k]);
	}
	return [...out];
}

/** Pure mapping upstream outcome => BFF response (AD-6). Never copies upstream text. */
export function mapUpstreamError(endpoint: UpstreamEndpoint, outcome: UpstreamOutcome): MappedError {
	if (outcome.kind === 'network') {
		if (endpoint === 'request' && outcome.sent) return { status: 502, code: 'unknown' };
		return { status: 502, code: 'upstream' };
	}

	const { status } = outcome;
	if (status === 429) return { status: 503, code: 'busy', retryAfter: parseRetryAfter(outcome.retryAfter) };
	if (status >= 500) {
		return endpoint === 'request' ? { status: 502, code: 'unknown' } : { status: 502, code: 'upstream' };
	}
	if (endpoint === 'request') {
		if (status === 422) {
			const fields = mapFields(outcome.body);
			return fields.length > 0 ? { status: 422, code: 'invalid', fields } : { status: 422, code: 'invalid' };
		}
		if (status === 400) return { status: 400, code: 'invalid' };
		if (status === 404) return { status: 409, code: 'slot_unavailable' };
	}
	return { status: 502, code: 'config' };
}
