import { formatSlotTime } from '../../src/features/booking-nubimed/agenda-hours.ts';
import type { BookingStatus, ValidatedBookingRequest } from '../../src/features/booking-nubimed/api-contract.ts';
import { CLINIC_TIMEZONE, todayYmdMadrid, ymdToDdMmYyyy } from '../../src/features/booking-nubimed/horizon.ts';

/**
 * Pure email content for the booking notification (no I/O, no env). Labels live here on purpose:
 * `config.ts`/`clinic-locations.ts` pull client-only imports that Functions and `node --test` cannot load.
 * NEVER include patient comments; never put patient data in the subject.
 */

export const DEFAULT_PANEL_URL = 'https://app.clinicaenlanube.com/agenda/cita_peticiones';

export type NotifyStatus = BookingStatus | 'unknown';

export interface NotificationInput {
	status: NotifyStatus;
	req: ValidatedBookingRequest;
	/** Panel link template (already validated https; may contain `{id}`). */
	panelUrl: string;
	/** Internal upstream id; only ever used to build the panel link. */
	peticionId?: number;
}

export interface NotificationContent {
	subject: string;
	text: string;
	html: string;
}

const SPECIALTY_LABEL: Record<number, string> = { 3: 'Medicina estética', 386: 'Tricología' };
const CENTRO_LABEL: Record<string, string> = { barcelona: 'Barcelona', 'el-vendrell': 'El Vendrell' };
const KIND_LABEL: Record<string, string> = { firstVisit: 'Primera visita', treatments: 'Tratamientos' };

// DRAFT copy — pending user review (subjects, status labels, action lines and body wording).
const SUBJECT_PREFIX: Record<NotifyStatus, string> = {
	received: 'Nueva solicitud de cita (pendiente)',
	confirmed: 'Cita confirmada automáticamente (sin acción)',
	unknown: 'Posible solicitud de cita (verificar en Nubimed)',
};
const STATUS_LABEL: Record<NotifyStatus, string> = {
	received: 'Pendiente de gestionar',
	confirmed: 'Confirmada automáticamente',
	unknown: 'Resultado desconocido',
};
const ACTION_LINE: Record<NotifyStatus, string> = {
	received: 'Gestiona la petición en el panel de Nubimed.',
	confirmed: 'No requiere acción: la cita ya está confirmada.',
	unknown:
		'Verifica en Nubimed si la petición se creó (o si está duplicada): la conexión falló tras enviarla.',
};
const COMMENTS_NOTE = 'El paciente dejó comentarios (ver en Nubimed)';
const PANEL_LINK_LABEL = 'Gestionar en el panel de Nubimed';

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: CLINIC_TIMEZONE });

export function escapeHtml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** `{id}` is replaced only by a digits-only id; otherwise the default link (never a literal `{id}`). */
export function resolvePanelLink(template: string, peticionId?: number): string {
	if (!template.includes('{id}')) return template;
	const id = peticionId === undefined ? '' : String(peticionId);
	return /^\d+$/.test(id) ? template.replaceAll('{id}', id) : DEFAULT_PANEL_URL;
}

function formatWhen(iso: string): string {
	const date = new Date(iso);
	const weekday = WEEKDAY_FORMAT.format(date);
	return `${weekday} ${ymdToDdMmYyyy(todayYmdMadrid(date))}, ${formatSlotTime(iso)} (hora de Madrid)`;
}

export function buildNotification(input: NotificationInput): NotificationContent {
	const { status, req } = input;
	const specialty = SPECIALTY_LABEL[req.target.specialtyId] ?? 'Especialidad';
	const centro = CENTRO_LABEL[req.target.centro] ?? 'Centro';
	const kind = KIND_LABEL[req.target.kind] ?? 'Servicio';
	const link = resolvePanelLink(input.panelUrl, input.peticionId);

	const rows: [string, string][] = [
		['Paciente', `${req.patient.name} ${req.patient.surname}`],
		['Teléfono', `+${req.patient.phonePrefix} ${req.patient.phone}`],
		['Email', req.patient.email],
		['Especialidad', specialty],
		['Centro', centro],
		['Servicio', kind],
		['Fecha y hora', formatWhen(req.requestedTime)],
		['Estado', STATUS_LABEL[status]],
	];
	const hasComments = Boolean(req.comments);

	const text = [
		ACTION_LINE[status],
		'',
		...rows.map(([k, v]) => `${k}: ${v}`),
		...(hasComments ? ['', COMMENTS_NOTE] : []),
		'',
		`${PANEL_LINK_LABEL}: ${link}`,
	].join('\n');

	const html = [
		'<div>',
		`<p><strong>${escapeHtml(ACTION_LINE[status])}</strong></p>`,
		'<table>',
		...rows.map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`),
		'</table>',
		...(hasComments ? [`<p>${escapeHtml(COMMENTS_NOTE)}</p>`] : []),
		`<p><a href="${escapeHtml(link)}">${escapeHtml(PANEL_LINK_LABEL)}</a></p>`,
		'</div>',
	].join('\n');

	return { subject: `${SUBJECT_PREFIX[status]}: ${specialty} · ${centro}`, text, html };
}
