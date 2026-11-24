import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	validateBookingRequest,
	parseAvailabilityQuery,
} from '../../src/features/booking-nubimed/api-contract.ts';

function validBody(): Record<string, unknown> {
	return {
		specialty: 3,
		centro: 'barcelona',
		kind: 'firstVisit',
		requestedTime: '2026-12-01T09:30:00+01:00',
		patient: { name: 'Ana', surname: 'Pérez', phonePrefix: '34', phone: '600 123-456', email: 'ana@example.com' },
		consent: true,
		turnstileToken: 'tok',
	};
}

function withPatient(patch: Record<string, unknown>): Record<string, unknown> {
	const b = validBody();
	b.patient = { ...(b.patient as Record<string, unknown>), ...patch };
	return b;
}

function fieldsOf(body: unknown): string[] {
	const r = validateBookingRequest(body);
	assert.equal(r.ok, false);
	return r.ok ? [] : r.fields;
}

test('valid body is accepted and normalized', () => {
	const r = validateBookingRequest({ ...validBody(), comments: '  hola  ' });
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.equal(r.value.target.serviceId, 389741);
	assert.equal(r.value.target.agendaId, 29537);
	assert.equal(r.value.requestedTime, '2026-12-01T09:30:00+01:00');
	assert.equal(r.value.patient.phone, '600123456');
	assert.equal(r.value.patient.phonePrefix, '34');
	assert.equal(r.value.comments, 'hola');
	assert.equal(r.value.turnstileToken, 'tok');
});

test('comments optional; honeypot website passes through', () => {
	const r = validateBookingRequest({ ...validBody(), website: 'spam' });
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal(r.value.comments, undefined);
		assert.equal(r.value.website, 'spam');
	}
});

test('non-object bodies are invalid', () => {
	for (const b of [null, undefined, 'x', 3, [], true]) {
		assert.equal(validateBookingRequest(b).ok, false);
	}
});

test('name and surname: empty or > 80 after trim', () => {
	assert.ok(fieldsOf(withPatient({ name: '   ' })).includes('name'));
	assert.ok(fieldsOf(withPatient({ name: 'a'.repeat(81) })).includes('name'));
	assert.ok(fieldsOf(withPatient({ surname: '' })).includes('surname'));
	assert.ok(fieldsOf(withPatient({ surname: 'b'.repeat(81) })).includes('surname'));
	assert.equal(validateBookingRequest(withPatient({ name: ` ${'a'.repeat(80)} ` })).ok, true);
});

test('phonePrefix pattern', () => {
	assert.equal(validateBookingRequest(withPatient({ phonePrefix: '34' })).ok, true);
	assert.equal(validateBookingRequest(withPatient({ phonePrefix: '1' })).ok, true);
	assert.ok(fieldsOf(withPatient({ phonePrefix: '+34' })).includes('phonePrefix'));
	assert.ok(fieldsOf(withPatient({ phonePrefix: '0' })).includes('phonePrefix'));
	assert.ok(fieldsOf(withPatient({ phonePrefix: '12345' })).includes('phonePrefix'));
	assert.ok(fieldsOf(withPatient({ phonePrefix: 34 })).includes('phonePrefix'));
});

test('phone: 6-15 digits after stripping spaces and hyphens', () => {
	assert.ok(fieldsOf(withPatient({ phone: '1234' })).includes('phone'));
	assert.ok(fieldsOf(withPatient({ phone: '1'.repeat(16) })).includes('phone'));
	assert.ok(fieldsOf(withPatient({ phone: '600abc456' })).includes('phone'));
	assert.equal(validateBookingRequest(withPatient({ phone: '123456' })).ok, true);
	assert.equal(validateBookingRequest(withPatient({ phone: '1'.repeat(15) })).ok, true);
});

test('email: required, <= 254, reasonable format', () => {
	assert.ok(fieldsOf(withPatient({ email: '' })).includes('email'));
	assert.ok(fieldsOf(withPatient({ email: undefined })).includes('email'));
	assert.ok(fieldsOf(withPatient({ email: 'nope' })).includes('email'));
	assert.ok(fieldsOf(withPatient({ email: 'a b@c.com' })).includes('email'));
	assert.ok(fieldsOf(withPatient({ email: `${'a'.repeat(250)}@x.com` })).includes('email'));
});

test('comments: 500 ok, 501 invalid', () => {
	assert.equal(validateBookingRequest({ ...validBody(), comments: 'c'.repeat(500) }).ok, true);
	assert.ok(fieldsOf({ ...validBody(), comments: 'c'.repeat(501) }).includes('comments'));
	assert.ok(fieldsOf({ ...validBody(), comments: 5 }).includes('comments'));
});

test('consent must be exactly true', () => {
	for (const c of [false, 'true', 1, undefined]) {
		assert.ok(fieldsOf({ ...validBody(), consent: c }).includes('consent'));
	}
});

test('requestedTime absent or malformed', () => {
	for (const t of [undefined, '', 'tomorrow', '2026-12-01', '2026-13-45T09:30:00+01:00', 12345, '2026-12-01T09:30:00']) {
		assert.ok(fieldsOf({ ...validBody(), requestedTime: t }).includes('requestedTime'), String(t));
	}
	assert.equal(validateBookingRequest({ ...validBody(), requestedTime: '2026-12-01T08:30:00Z' }).ok, true);
});

test('catalog keys are validated per field', () => {
	assert.ok(fieldsOf({ ...validBody(), specialty: 4 }).includes('specialty'));
	assert.ok(fieldsOf({ ...validBody(), centro: 'madrid' }).includes('centro'));
	assert.ok(fieldsOf({ ...validBody(), kind: 'x' }).includes('kind'));
});

test('unknown keys and raw vendor ids are rejected without echoing names', () => {
	for (const k of ['schedule_id', 'service_id', 'speciality_id', 'clinica_id', 'area_id', 'foo']) {
		const r = validateBookingRequest({ ...validBody(), [k]: 1 });
		assert.equal(r.ok, false, k);
		if (!r.ok) assert.ok(!r.fields.includes(k), k);
	}
	const r = validateBookingRequest(withPatient({ schedule_id: 1 }));
	assert.equal(r.ok, false);
});

test('fields only contain own field names', () => {
	const allowed = new Set([
		'specialty', 'centro', 'kind', 'requestedTime', 'name', 'surname', 'phonePrefix',
		'phone', 'email', 'comments', 'consent', 'turnstileToken', 'website', 'patient',
	]);
	const fields = fieldsOf({ patient: 'x', foo: 1 });
	for (const f of fields) assert.ok(allowed.has(f), f);
});

test('parseAvailabilityQuery accepts exactly specialty, centro, kind', () => {
	const r = parseAvailabilityQuery(new URLSearchParams('specialty=386&centro=el-vendrell&kind=treatments'));
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal(r.target.serviceId, 389748);
		assert.equal(r.target.agendaId, 26912);
	}
});

test('parseAvailabilityQuery rejects extra, missing, duplicated and unknown values', () => {
	const bad = [
		'specialty=3&centro=barcelona&kind=firstVisit&from=2020-01-01',
		'specialty=3&centro=barcelona&kind=firstVisit&to=2030-01-01',
		'specialty=3&centro=barcelona&kind=firstVisit&schedule_id=1',
		'specialty=3&centro=madrid&kind=firstVisit',
		'specialty=4&centro=barcelona&kind=firstVisit',
		'specialty=3&centro=barcelona',
		'',
		'specialty=3&specialty=386&centro=barcelona&kind=firstVisit',
	];
	for (const q of bad) assert.equal(parseAvailabilityQuery(new URLSearchParams(q)).ok, false, q);
});
