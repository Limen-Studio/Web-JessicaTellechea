import { CLINIC_TIMEZONE, addDaysYmd, effectiveHorizonDays, todayYmdMadrid } from './horizon.ts';

const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function isSlotIso(v: unknown): v is string {
	return typeof v === 'string' && ISO_WITH_OFFSET_RE.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Extracts ISO strings from the upstream `[[iso8601, [user_ids], meta], ...]` shape.
 * `user_ids` and `meta` are discarded; malformed entries are ignored.
 */
export function parseAgendaHours(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const entry of raw) {
		if (Array.isArray(entry) && isSlotIso(entry[0])) out.push(entry[0]);
	}
	return out;
}

/** Group ISO slots by calendar day in Europe/Madrid; days and hours sorted, original ISO kept. */
export function groupByMadridDay(isos: readonly string[]): Record<string, string[]> {
	const unique = [...new Set(isos)].filter(isSlotIso);
	unique.sort((a, b) => Date.parse(a) - Date.parse(b));
	const days: Record<string, string[]> = {};
	for (const iso of unique) {
		const day = todayYmdMadrid(new Date(iso));
		(days[day] ??= []).push(iso);
	}
	return days;
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
	timeZone: CLINIC_TIMEZONE,
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

/** `HH:mm` (24h) wall time in Europe/Madrid, independent of the runtime timezone. */
export function formatSlotTime(iso: string): string {
	return TIME_FORMAT.format(new Date(iso));
}

/** Server-side availability range: today (Madrid) .. today + 90 days (91 days). */
export function availabilityWindow(now: Date = new Date()): { from: string; to: string } {
	const from = todayYmdMadrid(now);
	return { from, to: addDaysYmd(from, effectiveHorizonDays(91) - 1) };
}

/** True only if `requestedTime` is present, byte for byte, under its Madrid day. */
export function containsSlot(days: Readonly<Record<string, readonly string[]>>, requestedTime: string): boolean {
	if (!isSlotIso(requestedTime)) return false;
	const day = todayYmdMadrid(new Date(requestedTime));
	const slots = Object.hasOwn(days, day) ? days[day] : undefined;
	return slots !== undefined && slots.includes(requestedTime);
}
