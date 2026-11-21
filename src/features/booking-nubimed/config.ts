import type { SiteLocale } from './types';

export type CentroKey = 'barcelona' | 'el-vendrell';

/** Centros (areas Nubimed) de la clinica 1212; etiquetas compartidas entre especialidades. */
export const CENTROS: Record<CentroKey, { readonly labels: Record<SiteLocale, string> }> = {
	barcelona: {
		labels: { es: 'Barcelona', en: 'Barcelona', ca: 'Barcelona', fr: 'Barcelone' },
	},
	'el-vendrell': {
		labels: { es: 'El Vendrell', en: 'El Vendrell', ca: 'El Vendrell', fr: 'El Vendrell' },
	},
};

export interface SpecialtyCentro {
	readonly centro: CentroKey;
	/** `area_id` en huecos_agenda y `area` en `/new`. */
	readonly areaId: number;
	readonly firstVisitTreatmentId: number;
	readonly treatmentsTreatmentId: number;
	/** Sublinea de la tarjeta "Tratamientos" (siglas del panel Nubimed; iguales en los 4 locales). */
	readonly treatmentsDetail: string;
}

/** Sublinea de la tarjeta "Primera visita" (duracion y precio del panel Nubimed: 45 min, 100 €). */
export const FIRST_VISIT_DETAIL = '45 min. - 100€';

export interface SpecialtyCatalogEntry {
	readonly vendorId: 3 | 386;
	readonly slug: string;
	/** Lowercase tokens for preset matching (slug, aliases, string id). */
	readonly matchKeys: readonly string[];
	readonly tipoHorario: 'presencial';
	readonly labels: Record<SiteLocale, string>;
	readonly centros: readonly SpecialtyCentro[];
}

export const TREATMENT_KIND_LABELS: Record<'firstVisit' | 'treatments', Record<SiteLocale, string>> = {
	firstVisit: {
		es: 'Primera visita',
		en: 'First visit',
		ca: 'Primera visita',
		fr: 'Première visite',
	},
	treatments: {
		es: 'Tratamientos',
		en: 'Treatments',
		ca: 'Tractaments',
		fr: 'Traitements',
	},
};

/**
 * Single source of truth for vendor specialty / area / treatment ids (REQ-3).
 * Do not duplicate these ids elsewhere as authority.
 */
export const SPECIALTY_CATALOG: readonly SpecialtyCatalogEntry[] = [
	{
		vendorId: 3,
		slug: 'medicina-estetica',
		matchKeys: ['medicina-estetica', 'estetica', '3'],
		tipoHorario: 'presencial',
		labels: {
			es: 'Medicina estética',
			en: 'Aesthetic medicine',
			ca: 'Medicina estètica',
			fr: 'Médecine esthétique',
		},
		centros: [
			{
				centro: 'barcelona',
				areaId: 15070,
				firstVisitTreatmentId: 389741,
				treatmentsTreatmentId: 389745,
				treatmentsDetail: 'BTX · FILLERS · BIOESTIMUL · IPL · PRP',
			},
			{
				centro: 'el-vendrell',
				areaId: 15072,
				firstVisitTreatmentId: 389742,
				treatmentsTreatmentId: 389746,
				treatmentsDetail: 'BTX · FILLERS · BIOESTIMUL · PRP',
			},
		],
	},
	{
		vendorId: 386,
		slug: 'tricologia',
		matchKeys: ['tricologia', 'capilar', 'hair', 'medicina-capilar', '386'],
		tipoHorario: 'presencial',
		labels: {
			es: 'Tricología',
			en: 'Trichology',
			ca: 'Tricologia',
			fr: 'Trichologie',
		},
		centros: [
			{
				centro: 'barcelona',
				areaId: 15071,
				firstVisitTreatmentId: 389743,
				treatmentsTreatmentId: 389747,
				treatmentsDetail: 'MESO · PRP',
			},
			{
				centro: 'el-vendrell',
				areaId: 15073,
				firstVisitTreatmentId: 389744,
				treatmentsTreatmentId: 389748,
				treatmentsDetail: 'MESO · PRP',
			},
		],
	},
] as const;

export function catalogEntryBySlugOrId(preset: string): SpecialtyCatalogEntry | undefined {
	const key = preset.trim().toLowerCase();
	if (!key) return undefined;
	const n = Number(key);
	for (const e of SPECIALTY_CATALOG) {
		if (!Number.isNaN(n) && e.vendorId === n) return e;
		if (e.slug === key) return e;
		if (e.matchKeys.includes(key)) return e;
	}
	return undefined;
}

export function labelFor(entry: SpecialtyCatalogEntry, lang: SiteLocale): string {
	return entry.labels[lang];
}

/** Centro de la especialidad por clave (`?sede=`); `undefined` si no existe. */
export function centroFor(entry: SpecialtyCatalogEntry, key: string): SpecialtyCentro | undefined {
	const k = key.trim().toLowerCase();
	if (!k) return undefined;
	return entry.centros.find((c) => c.centro === k);
}

/** Direcciones por centro desde env (accesos literales para que Vite los reemplace). */
export function centroAddressesFromEnv(): Partial<Record<CentroKey, string>> {
	const out: Partial<Record<CentroKey, string>> = {};
	const barcelona = import.meta.env.PUBLIC_CLINIC_ADDRESS_BARCELONA?.trim();
	const elVendrell = import.meta.env.PUBLIC_CLINIC_ADDRESS_EL_VENDRELL?.trim();
	if (barcelona) out.barcelona = barcelona;
	if (elVendrell) out['el-vendrell'] = elVendrell;
	return out;
}

/** Numeric dial codes without +; ISO region for Intl.DisplayNames. */
const PHONE_PREFIX_REGIONS: ReadonlyArray<{ readonly code: string; readonly region: string }> = [
	{ code: '34', region: 'ES' },
	{ code: '33', region: 'FR' },
	{ code: '351', region: 'PT' },
	{ code: '39', region: 'IT' },
	{ code: '44', region: 'GB' },
	{ code: '49', region: 'DE' },
	{ code: '31', region: 'NL' },
	{ code: '32', region: 'BE' },
	{ code: '41', region: 'CH' },
	{ code: '43', region: 'AT' },
	{ code: '30', region: 'GR' },
	{ code: '353', region: 'IE' },
	{ code: '376', region: 'AD' },
	{ code: '212', region: 'MA' },
	{ code: '1', region: 'US' },
	{ code: '52', region: 'MX' },
	{ code: '54', region: 'AR' },
	{ code: '56', region: 'CL' },
	{ code: '57', region: 'CO' },
	{ code: '51', region: 'PE' },
];

function phonePrefixIntlLocale(lang: SiteLocale): string {
	return lang === 'en' ? 'en-GB' : lang;
}

export function phonePrefixSelectOptions(lang: SiteLocale): ReadonlyArray<{ value: string; label: string }> {
	const dn = new Intl.DisplayNames([phonePrefixIntlLocale(lang)], { type: 'region' });
	const mapped = PHONE_PREFIX_REGIONS.map(({ code, region }) => ({
		value: code,
		label: `+${code} \u2014 ${dn.of(region) ?? region}`,
	}));
	return [...mapped].sort((a, b) => {
		if (a.value === '34') return -1;
		if (b.value === '34') return 1;
		return parseInt(a.value, 10) - parseInt(b.value, 10);
	});
}
