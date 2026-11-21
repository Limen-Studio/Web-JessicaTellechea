import type { Locale } from './config';
import { href } from './route-registry';
import { bookingPublic } from './site-features';

/**
 * Query `preset` value for Nubimed vendor specialty id 3 (Medicina estética).
 * @see SPECIALTY_CATALOG in `src/features/booking-nubimed/config.ts`
 */
export const BOOKING_PRESET_VENDOR_MEDICINA_ESTETICA = '3';

/**
 * Query `preset` value for Nubimed vendor specialty id 386 (Tricología / capilar).
 * @see SPECIALTY_CATALOG in `src/features/booking-nubimed/config.ts`
 */
export const BOOKING_PRESET_VENDOR_TRICOLOGIA = '386';

/** Booking URL with specialty preset query (e.g. capilar hub). */
export function bookingUrlWithPreset(lang: Locale, preset: string): string {
	const base = href(lang, 'booking');
	const join = base.includes('?') ? '&' : '?';
	return `${base}${join}preset=${encodeURIComponent(preset)}`;
}

/** Booking URL with specialty + treatment preselected. */
export function bookingUrlWithPresetAndTreatment(lang: Locale, preset: string, treatment: string): string {
	const withPreset = bookingUrlWithPreset(lang, preset);
	const join = withPreset.includes('?') ? '&' : '?';
	return `${withPreset}${join}treatment=${encodeURIComponent(treatment)}`;
}

/**
 * Site-wide booking CTA target. With `bookingPublic` it points to the internal
 * booking route (optionally with a specialty `preset`) and is never external.
 * Otherwise release 1: WhatsApp when `PUBLIC_WHATSAPP_E164` is set, localised
 * contact page otherwise. `external` is `true` only for the WhatsApp resolution.
 */
export function resolveBookingCta(lang: Locale, opts?: { preset?: string }): { href: string; external: boolean } {
	if (bookingPublic) {
		const preset = opts?.preset;
		return {
			href: preset ? bookingUrlWithPreset(lang, preset) : href(lang, 'booking'),
			external: false,
		};
	}
	const whatsapp = import.meta.env.PUBLIC_WHATSAPP_E164?.trim();
	return whatsapp
		? { href: `https://wa.me/${whatsapp}`, external: true }
		: { href: href(lang, 'contact'), external: false };
}
