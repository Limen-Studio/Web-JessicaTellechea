export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'booking';
const TURNSTILE_TIMEOUT_MS = 5000;

/**
 * Server-side Turnstile check. Fail closed: any error, timeout, bad status or
 * unexpected payload => `false`. Never logs the token or the secret.
 */
export async function verifyTurnstile(
	secret: string,
	token: string,
	ip: string | null,
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	if (!token) return false;
	try {
		const form = new URLSearchParams({ secret, response: token });
		if (ip) form.set('remoteip', ip);
		const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
			method: 'POST',
			body: form,
			signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
		});
		if (!res.ok) return false;
		const data: unknown = await res.json();
		if (typeof data !== 'object' || data === null) return false;
		const r = data as { success?: unknown; action?: unknown };
		return r.success === true && r.action === TURNSTILE_ACTION;
	} catch {
		return false;
	}
}
