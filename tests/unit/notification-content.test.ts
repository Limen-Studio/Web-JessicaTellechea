import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PANEL_URL, buildNotification, escapeHtml, resolvePanelLink } from '../../functions/_lib/notification-content.ts';
import type { NotificationInput } from '../../functions/_lib/notification-content.ts';

const WINTER = '2026-12-02T09:30:00+01:00';
const SUMMER = '2026-07-15T09:30:00+02:00';

const input = (over: Partial<NotificationInput> = {}): NotificationInput => ({
	status: 'received',
	req: {
		target: { specialtyId: 386, centro: 'el-vendrell', kind: 'firstVisit', agendaId: 26912, serviceId: 389744 },
		requestedTime: WINTER,
		patient: { name: 'Ana', surname: 'García', phonePrefix: '34', phone: '600123123', email: 'ana@example.test' },
	},
	panelUrl: DEFAULT_PANEL_URL,
	...over,
});

// ---- subjects ----

test('subjects: exact spec strings per status', () => {
	assert.equal(buildNotification(input({ status: 'received' })).subject, 'Nueva solicitud de cita (pendiente): Tricología · El Vendrell');
	assert.equal(
		buildNotification(input({ status: 'confirmed' })).subject,
		'Cita confirmada automáticamente (sin acción): Tricología · El Vendrell',
	);
	assert.equal(
		buildNotification(input({ status: 'unknown' })).subject,
		'Posible solicitud de cita (verificar en Nubimed): Tricología · El Vendrell',
	);
});

test('subjects: other specialty/centro labels; distinct per status; no PII; no control chars', () => {
	const req = input().req;
	const other = { ...req, target: { ...req.target, specialtyId: 3 as const, centro: 'barcelona' as const } };
	assert.equal(
		buildNotification(input({ req: other })).subject,
		'Nueva solicitud de cita (pendiente): Medicina estética · Barcelona',
	);
	const subjects = (['received', 'confirmed', 'unknown'] as const).map((status) => buildNotification(input({ status })).subject);
	assert.equal(new Set(subjects).size, 3);
	for (const s of subjects) {
		for (const pii of ['Ana', 'García', '600123123', 'ana@example.test']) assert.equal(s.includes(pii), false, pii);
		assert.equal(/[\u0000-\u001f\u007f]/.test(s), false);
	}
});

// ---- body ----

test('body: complete data in text and html (winter, +01:00)', () => {
	const n = buildNotification(input());
	for (const part of [
		'Ana García',
		'+34 600123123',
		'ana@example.test',
		'Tricología',
		'El Vendrell',
		'Primera visita',
		'miércoles 2/12/2026, 09:30 (hora de Madrid)',
		DEFAULT_PANEL_URL,
	]) {
		assert.ok(n.text.includes(part), `text: ${part}`);
		assert.ok(n.html.includes(part), `html: ${part}`);
	}
});

test('body: Madrid wall time in summer (+02:00, DST) and for UTC input', () => {
	assert.ok(buildNotification(input({ req: { ...input().req, requestedTime: SUMMER } })).text.includes('miércoles 15/7/2026, 09:30 (hora de Madrid)'));
	assert.ok(buildNotification(input({ req: { ...input().req, requestedTime: '2026-07-15T07:30:00Z' } })).text.includes('15/7/2026, 09:30 (hora de Madrid)'));
	assert.ok(buildNotification(input({ req: { ...input().req, requestedTime: '2026-12-02T08:30:00Z' } })).text.includes('2/12/2026, 09:30 (hora de Madrid)'));
});

test('body: treatments kind label and status/action line per status', () => {
	const req = { ...input().req, target: { ...input().req.target, kind: 'treatments' as const } };
	assert.ok(buildNotification(input({ req })).text.includes('Tratamientos'));
	const lines = (['received', 'confirmed', 'unknown'] as const).map((status) => buildNotification(input({ status })).text);
	assert.ok(lines[0].includes('Gestiona la petición en el panel de Nubimed'));
	assert.ok(lines[1].includes('No requiere acción'));
	assert.ok(lines[2].includes('Verifica en Nubimed'));
	assert.equal(new Set(lines).size, 3);
});

test('comments: never in subject/text/html; indicator only when present', () => {
	const withComments = buildNotification(input({ req: { ...input().req, comments: 'Tengo diabetes' } }));
	for (const part of [withComments.subject, withComments.text, withComments.html]) assert.equal(part.includes('diabetes'), false);
	assert.ok(withComments.text.includes('El paciente dejó comentarios (ver en Nubimed)'));
	assert.ok(withComments.html.includes('El paciente dejó comentarios (ver en Nubimed)'));
	const without = buildNotification(input());
	assert.equal(without.text.includes('comentarios'), false);
	assert.equal(without.html.includes('comentarios'), false);
});

test('html: escapes user data and href; no script, images or tracking', () => {
	const evil = { name: '<script>alert(1)</script>', surname: `O'"&Brien`, phonePrefix: '34', phone: '600123123', email: 'a"b@example.test' };
	const n = buildNotification(input({ req: { ...input().req, patient: evil }, panelUrl: 'https://panel.example/p?a=1&b="2"' }));
	assert.equal(n.html.includes('<script>'), false);
	assert.ok(n.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
	assert.ok(n.html.includes('O&#39;&quot;&amp;Brien'));
	assert.ok(n.html.includes('a&quot;b@example.test'));
	assert.ok(n.html.includes('href="https://panel.example/p?a=1&amp;b=&quot;2&quot;"'));
	assert.equal(/<img|<script|<iframe/i.test(n.html), false);
	assert.ok(n.text.includes('<script>alert(1)</script>'), 'text is not HTML-escaped');
});

test('escapeHtml: & < > " \'', () => {
	assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
	assert.equal(escapeHtml('plain'), 'plain');
});

test('link in body: id substituted when template has {id}, default otherwise', () => {
	const n = buildNotification(input({ panelUrl: 'https://panel.example/p/{id}', peticionId: 12345 }));
	assert.ok(n.text.includes('https://panel.example/p/12345'));
	const u = buildNotification(input({ status: 'unknown', panelUrl: 'https://panel.example/p/{id}' }));
	assert.ok(u.text.includes(DEFAULT_PANEL_URL));
	assert.equal(u.text.includes('{id}'), false);
});

// ---- resolvePanelLink ----

test('resolvePanelLink: default, substitution, invalid id, no placeholder', () => {
	assert.equal(DEFAULT_PANEL_URL, 'https://app.clinicaenlanube.com/agenda/cita_peticiones');
	assert.equal(resolvePanelLink(DEFAULT_PANEL_URL), DEFAULT_PANEL_URL);
	assert.equal(resolvePanelLink('https://panel.example/p/{id}', 12345), 'https://panel.example/p/12345');
	assert.equal(resolvePanelLink('https://panel.example/p/{id}'), DEFAULT_PANEL_URL);
	assert.equal(resolvePanelLink('https://panel.example/p/{id}', '12a/../' as unknown as number), DEFAULT_PANEL_URL);
	assert.equal(resolvePanelLink('https://panel.example/p/{id}', -5), DEFAULT_PANEL_URL);
	assert.equal(resolvePanelLink('https://panel.example/list', 12345), 'https://panel.example/list');
});
