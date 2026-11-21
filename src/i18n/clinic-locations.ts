import type { Locale } from './config';

/** Centros físicos de la clínica (coinciden con las áreas Nubimed de la reserva). */
export type ClinicLocationKey = 'barcelona' | 'el-vendrell';

export const CLINIC_LOCATION_KEYS: readonly ClinicLocationKey[] = ['barcelona', 'el-vendrell'];

export const CLINIC_LOCATION_LABELS: Record<ClinicLocationKey, Record<Locale, string>> = {
	barcelona: { es: 'Barcelona', en: 'Barcelona', ca: 'Barcelona', fr: 'Barcelone' },
	'el-vendrell': { es: 'El Vendrell', en: 'El Vendrell', ca: 'El Vendrell', fr: 'El Vendrell' },
};

/** Fallback de dirección (mismo texto que el portal Nubimed) si falta la env del centro. */
const ADDRESS_FALLBACK: Record<ClinicLocationKey, string> = {
	barcelona: 'C. Calvet 16, Barcelona',
	'el-vendrell': 'C. de Mar 41, El Vendrell',
};

export interface ClinicLocation {
	/** Dirección visible; admite saltos de línea (`\n`). */
	readonly address: string;
	/** URL de Google Maps: env del centro o búsqueda por dirección. */
	readonly mapsHref: string;
}

function mapsSearchHref(address: string): string {
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.replace(/\n/g, ', '))}`;
}

/**
 * Dirección y enlace de Maps por centro, leídos en build (accesos literales a
 * `import.meta.env` para que Vite los reemplace). Usar en el frontmatter de Astro.
 */
export function clinicLocationsFromEnv(): Record<ClinicLocationKey, ClinicLocation> {
	const env = {
		barcelona: {
			address: import.meta.env.PUBLIC_CLINIC_ADDRESS_BARCELONA?.trim(),
			maps: import.meta.env.PUBLIC_GOOGLE_MAPS_URL_BARCELONA?.trim(),
		},
		'el-vendrell': {
			address: import.meta.env.PUBLIC_CLINIC_ADDRESS_EL_VENDRELL?.trim(),
			maps: import.meta.env.PUBLIC_GOOGLE_MAPS_URL_EL_VENDRELL?.trim(),
		},
	};
	const out = {} as Record<ClinicLocationKey, ClinicLocation>;
	for (const key of CLINIC_LOCATION_KEYS) {
		const address = env[key].address || ADDRESS_FALLBACK[key];
		out[key] = { address, mapsHref: env[key].maps || mapsSearchHref(address) };
	}
	return out;
}
