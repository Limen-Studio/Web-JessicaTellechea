/**
 * Local minimal Cloudflare Pages types (no `@cloudflare/workers-types`) and fail-closed config.
 * NEVER log values read from `env`.
 */

export interface BookingEnv {
	NUBIMED_API_EMAIL?: string;
	NUBIMED_API_TOKEN?: string;
	NUBIMED_CLINIC_ID?: string;
	NUBIMED_API_BASE?: string;
	TURNSTILE_SECRET_KEY?: string;
	/** Optional booking notification (never part of `readConfig`; absence never causes 503). */
	CF_ACCOUNT_ID?: string;
	CF_EMAIL_API_TOKEN?: string;
	BOOKING_NOTIFY_TO?: string;
	BOOKING_NOTIFY_FROM?: string;
	NUBIMED_PANEL_URL?: string;
	BOOKING_NOTIFY_ON?: string;
}

export interface BookingContext {
	request: Request;
	env: BookingEnv;
	waitUntil(promise: Promise<unknown>): void;
}

export interface BookingConfig {
	email: string;
	token: string;
	clinicId: number;
	turnstileSecret: string;
	apiBase: string;
}

export const DEFAULT_API_BASE = 'https://api.clinicaenlanube.com/api/v1';

function resolveApiBase(raw: string | undefined): string | null {
	const value = raw?.trim();
	if (!value) return DEFAULT_API_BASE;
	try {
		const u = new URL(value);
		return u.protocol === 'https:' ? value.replace(/\/+$/, '') : null;
	} catch {
		return null;
	}
}

/** Returns the config, or `null` if anything required is missing/invalid (fail closed). */
export function readConfig(env: BookingEnv): BookingConfig | null {
	const email = env.NUBIMED_API_EMAIL?.trim();
	const token = env.NUBIMED_API_TOKEN?.trim();
	const turnstileSecret = env.TURNSTILE_SECRET_KEY?.trim();
	const clinic = env.NUBIMED_CLINIC_ID?.trim();
	if (!email || !token || !turnstileSecret || !clinic || !/^\d+$/.test(clinic)) return null;
	const clinicId = Number(clinic);
	if (!Number.isSafeInteger(clinicId) || clinicId <= 0) return null;
	const apiBase = resolveApiBase(env.NUBIMED_API_BASE);
	if (apiBase === null) return null;
	return { email, token, clinicId, turnstileSecret, apiBase };
}
