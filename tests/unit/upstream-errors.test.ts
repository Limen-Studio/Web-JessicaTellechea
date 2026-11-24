import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapUpstreamError } from '../../functions/_lib/upstream-errors.ts';

const http = (status: number, extra: Record<string, unknown> = {}) => ({ kind: 'http' as const, status, ...extra });

test('429 => 503 busy with upstream Retry-After or 60 (both endpoints)', () => {
	for (const ep of ['availability', 'request'] as const) {
		assert.deepEqual(mapUpstreamError(ep, http(429, { retryAfter: '120' })), { status: 503, code: 'busy', retryAfter: 120 });
		assert.deepEqual(mapUpstreamError(ep, http(429, { retryAfter: 30 })), { status: 503, code: 'busy', retryAfter: 30 });
		assert.deepEqual(mapUpstreamError(ep, http(429)), { status: 503, code: 'busy', retryAfter: 60 });
		assert.deepEqual(mapUpstreamError(ep, http(429, { retryAfter: 'soon' })), { status: 503, code: 'busy', retryAfter: 60 });
		assert.deepEqual(mapUpstreamError(ep, http(429, { retryAfter: '0' })), { status: 503, code: 'busy', retryAfter: 60 });
		assert.deepEqual(mapUpstreamError(ep, http(429, { retryAfter: null })), { status: 503, code: 'busy', retryAfter: 60 });
	}
});

test('availability: 422/400/404/401/403 => 502 config', () => {
	for (const s of [422, 400, 404, 401, 403]) {
		assert.deepEqual(mapUpstreamError('availability', http(s)), { status: 502, code: 'config' }, String(s));
	}
});

test('availability: 5xx / network / timeout => 502 upstream', () => {
	for (const s of [500, 502, 503, 504]) {
		assert.deepEqual(mapUpstreamError('availability', http(s)), { status: 502, code: 'upstream' }, String(s));
	}
	assert.deepEqual(mapUpstreamError('availability', { kind: 'network', sent: true }), { status: 502, code: 'upstream' });
	assert.deepEqual(mapUpstreamError('availability', { kind: 'network', sent: false }), { status: 502, code: 'upstream' });
});

test('request: 400 => 400 invalid; 404 => 409 slot_unavailable; 401/403 => 502 config', () => {
	assert.deepEqual(mapUpstreamError('request', http(400)), { status: 400, code: 'invalid' });
	assert.deepEqual(mapUpstreamError('request', http(404)), { status: 409, code: 'slot_unavailable' });
	assert.deepEqual(mapUpstreamError('request', http(401)), { status: 502, code: 'config' });
	assert.deepEqual(mapUpstreamError('request', http(403)), { status: 502, code: 'config' });
});

test('request: 5xx response, network or timeout after send => 502 unknown', () => {
	for (const s of [500, 502, 503, 504]) {
		assert.deepEqual(mapUpstreamError('request', http(s)), { status: 502, code: 'unknown' }, String(s));
	}
	assert.deepEqual(mapUpstreamError('request', { kind: 'network', sent: true }), { status: 502, code: 'unknown' });
});

test('request: failure before sending => 502 upstream', () => {
	assert.deepEqual(mapUpstreamError('request', { kind: 'network', sent: false }), { status: 502, code: 'upstream' });
});

test('request: 422 => 422 invalid with own field names only', () => {
	const body = {
		errors: {
			patient_name: ['no puede estar en blanco: Ana'],
			patient_surname: ['x'],
			patient_phone: ['x'],
			patient_country_calling_code: ['x'],
			patient_email: ['x'],
			comments: ['x'],
			requested_time: ['x'],
			secret_internal: ['x'],
			schedule_id: ['x'],
		},
	};
	const r = mapUpstreamError('request', http(422, { body }));
	assert.equal(r.status, 422);
	assert.equal(r.code, 'invalid');
	assert.deepEqual([...(r.fields ?? [])].sort(), ['comments', 'email', 'name', 'phone', 'phonePrefix', 'requestedTime', 'surname']);
});

test('request: 422 accepts flat bodies and unknown shapes without leaking text', () => {
	const flat = mapUpstreamError('request', http(422, { body: { patient_phone: ['Juan 600123456 inválido'] } }));
	assert.deepEqual(flat, { status: 422, code: 'invalid', fields: ['phone'] });

	for (const body of [undefined, null, 'texto con datos 600123456', 42, [], { error: 'Ana Pérez' }]) {
		const r = mapUpstreamError('request', http(422, { body }));
		assert.equal(r.status, 422);
		assert.equal(r.code, 'invalid');
		assert.ok(!r.fields || r.fields.length === 0);
		assert.ok(!JSON.stringify(r).includes('Ana'));
		assert.ok(!JSON.stringify(r).includes('600123456'));
	}
});

test('result never carries upstream text', () => {
	const r = mapUpstreamError('request', http(401, { body: { error: 'Invalid token abc123' } }));
	assert.deepEqual(r, { status: 502, code: 'config' });
	const s = mapUpstreamError('availability', http(500, { body: 'stack trace' }));
	assert.deepEqual(s, { status: 502, code: 'upstream' });
});

test('unexpected 4xx => 502 config', () => {
	assert.deepEqual(mapUpstreamError('availability', http(418)), { status: 502, code: 'config' });
	assert.deepEqual(mapUpstreamError('request', http(409)), { status: 502, code: 'config' });
});
