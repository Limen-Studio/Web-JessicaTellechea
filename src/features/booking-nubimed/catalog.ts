import type { ClinicLocationKey } from '../../i18n/clinic-locations.ts';

/**
 * Server-resolvable booking catalog (ids only, no labels, no runtime imports).
 * The client sends catalog keys; the BFF resolves vendor ids from here.
 */
export type SpecialtyId = 3 | 386;
export type CentroKey = ClinicLocationKey;
export type ServiceKind = 'firstVisit' | 'treatments';

export const MODALITY = 'presencial';

export const AGENDA_BY_CENTRO: Record<CentroKey, number> = {
	barcelona: 29537,
	'el-vendrell': 26912,
};

export const SERVICE_IDS: Record<SpecialtyId, Record<CentroKey, Record<ServiceKind, number>>> = {
	3: {
		barcelona: { firstVisit: 389741, treatments: 389745 },
		'el-vendrell': { firstVisit: 389742, treatments: 389746 },
	},
	386: {
		barcelona: { firstVisit: 389743, treatments: 389747 },
		'el-vendrell': { firstVisit: 389744, treatments: 389748 },
	},
};

export interface BookingTarget {
	specialtyId: SpecialtyId;
	centro: CentroKey;
	kind: ServiceKind;
	agendaId: number;
	serviceId: number;
}

function toSpecialtyId(v: unknown): SpecialtyId | null {
	return v === 3 || v === 386 ? v : null;
}

function toCentro(v: unknown): CentroKey | null {
	return v === 'barcelona' || v === 'el-vendrell' ? v : null;
}

function toKind(v: unknown): ServiceKind | null {
	return v === 'firstVisit' || v === 'treatments' ? v : null;
}

export function resolveBookingTarget(specialty: unknown, centro: unknown, kind: unknown): BookingTarget | null {
	const specialtyId = toSpecialtyId(specialty);
	const c = toCentro(centro);
	const k = toKind(kind);
	if (specialtyId === null || c === null || k === null) return null;
	return {
		specialtyId,
		centro: c,
		kind: k,
		agendaId: AGENDA_BY_CENTRO[c],
		serviceId: SERVICE_IDS[specialtyId][c][k],
	};
}
