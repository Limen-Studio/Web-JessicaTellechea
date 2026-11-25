import type { ValidatedBookingRequest } from '../../src/features/booking-nubimed/api-contract.ts';
import { DEFAULT_PANEL_URL, buildNotification } from './notification-content.ts';
import type { NotifyStatus } from './notification-content.ts';
import type { BookingEnv } from './env.ts';
import type { UpstreamDeps } from './upstream.ts';

/**
 * Optional booking notification (Cloudflare Email Sending). Independent of `readConfig`: missing or
 * malformed notify config disables the notification silently and NEVER causes a 503 `config`.
 * NEVER log tokens, addresses, subjects, bodies, patient data or the upstream request id.
 */

export type { NotifyStatus };

export interface NotifyConfig {
	accountId: string;
	token: string;
	to: string;
	from: string;
	/** https URL template (may contain `{id}`); the default when unset or invalid. */
	panelUrl: string;
	notifyOn: ReadonlySet<NotifyStatus>;
}

const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALL_STATUSES: readonly NotifyStatus[] = ['received', 'confirmed', 'unknown'];

function parseNotifyOn(raw: string | undefined): ReadonlySet<NotifyStatus> {
	if (raw === undefined) return new Set(ALL_STATUSES);
	const tokens = raw.split(',').map((t) => t.trim().toLowerCase());
	return new Set(ALL_STATUSES.filter((s) => tokens.includes(s)));
}

function resolvePanelUrl(raw: string | undefined): string {
	const value = raw?.trim();
	if (!value) return DEFAULT_PANEL_URL;
	try {
		return new URL(value.replaceAll('{id}', '0')).protocol === 'https:' ? value : DEFAULT_PANEL_URL;
	} catch {
		return DEFAULT_PANEL_URL;
	}
}

/** Returns the config, or `null` (notification disabled) if anything required is missing/malformed. */
export function readNotifyConfig(env: BookingEnv): NotifyConfig | null {
	const accountId = env.CF_ACCOUNT_ID?.trim();
	const token = env.CF_EMAIL_API_TOKEN?.trim();
	const to = env.BOOKING_NOTIFY_TO?.trim();
	const from = env.BOOKING_NOTIFY_FROM?.trim();
	if (!accountId || !token || !to || !from) return null;
	if (!ACCOUNT_ID_RE.test(accountId) || !EMAIL_RE.test(to) || !EMAIL_RE.test(from)) return null;
	return {
		accountId,
		token,
		to,
		from,
		panelUrl: resolvePanelUrl(env.NUBIMED_PANEL_URL),
		notifyOn: parseNotifyOn(env.BOOKING_NOTIFY_ON),
	};
}

const SEND_TIMEOUT_MS = 5000;

/**
 * One provider call, never retried, never throws. Success = HTTP 2xx AND `success === true`.
 * Any failure logs a single generic line (status or `network`): no token, addresses, subject,
 * body, provider response text or ids. The `from` string schema may need adjusting after the
 * first real send (design AD-5).
 */
export async function sendNotification(
	content: { subject: string; text: string; html: string },
	cfg: NotifyConfig,
	fetchFn: typeof fetch,
	timeoutMs = SEND_TIMEOUT_MS,
): Promise<boolean> {
	let status: number | 'network' = 'network';
	try {
		const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/email/sending/send`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject: content.subject, text: content.text, html: content.html }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		status = res.status;
		if (res.ok) {
			const parsed: unknown = await res.json();
			if (typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>).success === true) return true;
		}
	} catch {
		// fall through to the generic log line (status stays whatever was known)
	}
	console.warn('booking-notify', status);
	return false;
}

export interface BookingNotifyEvent {
	status: NotifyStatus;
	/** Validated request (already past honeypot/validation/Turnstile/availability). */
	req: ValidatedBookingRequest;
	/** Internal upstream id; only used to build the panel link. */
	peticionId?: number;
}

/**
 * Fire-and-forget: synchronous, returns nothing, never throws. Reads the notify config, filters by
 * `notifyOn`, builds the content and hands the send to `waitUntil`. The caller never awaits it, so
 * the patient response is identical whether the email is sent, fails or is disabled.
 */
export function scheduleBookingNotification(
	env: BookingEnv,
	deps: Pick<UpstreamDeps, 'fetch' | 'waitUntil'>,
	event: BookingNotifyEvent,
): void {
	try {
		const cfg = readNotifyConfig(env);
		if (!cfg || !cfg.notifyOn.has(event.status)) return;
		const content = buildNotification({ status: event.status, req: event.req, panelUrl: cfg.panelUrl, peticionId: event.peticionId });
		deps.waitUntil(sendNotification(content, cfg, deps.fetch));
	} catch {
		// the notification is best effort and must never affect the booking
	}
}
