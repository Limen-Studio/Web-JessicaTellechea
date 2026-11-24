import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBookingStatus, ACCEPTED_STATE } from '../../src/features/booking-nubimed/api-contract.ts';

test('confirmed when assigned_time is a non-empty string', () => {
	assert.equal(detectBookingStatus({ assigned_time: '2026-12-01T09:30:00+01:00', state: 'pendiente' }), 'confirmed');
	assert.equal(detectBookingStatus({ assigned_time: '2026-12-01T09:30:00+01:00' }), 'confirmed');
});

test('confirmed when state is the accepted state', () => {
	assert.equal(ACCEPTED_STATE, 'aceptada');
	assert.equal(detectBookingStatus({ state: 'aceptada' }), 'confirmed');
	assert.equal(detectBookingStatus({ state: ACCEPTED_STATE, assigned_time: null }), 'confirmed');
});

test('received for pending and rejection states without assigned_time', () => {
	assert.equal(detectBookingStatus({ state: 'pendiente' }), 'received');
	assert.equal(detectBookingStatus({ state: 'rechazada', assigned_time: '' }), 'received');
	assert.equal(detectBookingStatus({ state: 'anulada' }), 'received');
});

test('received when assigned_time is empty, null or not a string', () => {
	for (const t of ['', '   ', null, undefined, 0, 123, {}, []]) {
		assert.equal(detectBookingStatus({ state: 'pendiente', assigned_time: t }), 'received', String(t));
	}
});

test('received for non-object bodies', () => {
	for (const b of [null, undefined, 'aceptada', 42, [], true]) {
		assert.equal(detectBookingStatus(b), 'received', String(b));
	}
});

test('returns only the status literal, never id or PII', () => {
	const r = detectBookingStatus({ id: 99, patient_name: 'Ana', patient_email: 'a@b.co', state: 'aceptada' });
	assert.equal(typeof r, 'string');
	assert.ok(r === 'confirmed' || r === 'received');
	assert.ok(!JSON.stringify(r).includes('99'));
});
