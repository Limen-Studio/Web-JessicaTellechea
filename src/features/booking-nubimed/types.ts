import type { Locale } from '../../i18n/config';
import type { CentroKey, ServiceKind } from './catalog';
import type { ClinicLocation } from '../../i18n/clinic-locations';

/** Site locale (same as routing); vendor `locale` maps 1:1 per design. */
export type SiteLocale = Locale;

export interface BookingFlowProps {
	lang: SiteLocale;
	/** Query `preset`: slug or numeric vendor id string. */
	presetSpecialtySlug?: string | null;
	/** Optional query preset for future treatment preload (id or key). */
	presetTreatmentId?: string | null;
	/** Direcciones por centro (build-time; se pasan desde Astro para la isla). */
	centroLocations?: Partial<Record<CentroKey, ClinicLocation>>;
	/** Cloudflare Turnstile site key (public, build-time `PUBLIC_TURNSTILE_SITE_KEY`). */
	turnstileSiteKey?: string;
	/** `https://wa.me/...` fallback when Turnstile or the submission cannot complete. */
	whatsappHref?: string;
}

/** Tarjeta de servicio: `id` es el `serviceId` del catalogo (acepta `?treatment=`). */
export interface TreatmentOption {
	readonly id: string;
	readonly kind: ServiceKind;
	readonly label: string;
	/** Sublinea dorada de la tarjeta (duracion/precio o siglas de tratamientos). */
	readonly detail: string;
}

/** Legacy: Solo para los modulos de scraping pendientes de borrar (Phase 9, tarea 9.5). */
export interface BootstrapSession {
	csrfToken: string;
	clinicaId: number;
	maxDias: number;
	/** Path starting with `/` for `/new` handoff (relative to vendor origin). */
	newEntryPath: string;
}

/** Legacy: Solo para `normalize-huecos.ts` (Phase 9, tarea 9.5). */
export interface Slot {
	/** ISO 8601 when parseable; otherwise vendor time string for display only. */
	iso: string;
	professionalIds: number[];
	/** Human label when `iso` is not a full instant. */
	displayLabel?: string;
}

export type BookingFlowErrorKind =
	| 'network'
	| 'parse'
	| 'invalid_response'
	| 'invalid_preset'
	/** Legacy: Phase 9 (9.5). */
	| 'gate_blocked';

export class BookingFlowError extends Error {
	readonly kind: BookingFlowErrorKind;
	constructor(kind: BookingFlowErrorKind, message: string) {
		super(message);
		this.name = 'BookingFlowError';
		this.kind = kind;
	}
}
