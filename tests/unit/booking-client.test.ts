import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	BookingApiError,
	availabilityUrl,
	fetchAvailability,
	submitBookingRequest,
} from '../../src/features/booking-nubimed/client.ts';
import type { BookingRequestBody } from '../../src/features/booking-nubimed/api-contract.ts';

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: () => Response | Promise<Response>) {
	const calls: Call[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return respond();
	}) as typeof fetch;
	return { fn, calls };
}

const jsonRes = (body: unknown, status = 200, headers?: Record<string, string>) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const target = { specialty: 3, centro: 'barcelona', kind: 'firstVisit' } as const;
const signal = new AbortController().signal;

const body: BookingRequestBody = {
	specialty: 3,
	centro: 'barcelona',
	kind: 'firstVisit',
	requestedTime: '2026-12-01T09:30:00+01:00',
	patient: { name: 'Ana', surname: 'Lopez', phonePrefix: '34', phone: '600111222', email: 'a@b.co' },
	consent: true,
	turnstileToken: 'tok',
};

async function rejection<T>(p: Promise<T>): Promise<BookingApiError> {
	try {
		await p;
	} catch (e) {
		assert.ok(e instanceof BookingApiError, 'expected BookingApiError');
		return e;
	}
	assert.fail('expected rejection');
}

test('availabilityUrl: same-origin, only specialty/centro/kind, no dates or vendor ids', () => {
	const u = availabilityUrl(target);
	assert.equal(u, '/api/booking/availability?specialty=3&centro=barcelona&kind=firstVisit');
	assert.ok(!/from|to=|service_id|schedule|agenda|nubimed/i.test(u));
});

test('fetchAvailability: GET same-origin, returns parsed payload', async () => {
	const payload = { ok: true, from: '2026-11-24', to: '2027-02-22', days: { '2026-12-01': ['2026-12-01T09:30:00+01:00'] } };
	const f = fakeFetch(() => jsonRes(payload));
	const res = await fetchAvailability(signal, target, f.fn);
	assert.deepEqual(res, payload);
	assert.equal(f.calls.length, 1);
	assert.equal(f.calls[0].url, availabilityUrl(target));
	assert.equal(f.calls[0].init?.method ?? 'GET', 'GET');
	assert.equal(f.calls[0].init?.signal, signal);
});

test('fetchAvailability: error body maps by code (all known codes)', async () => {
	for (const code of ['invalid', 'forbidden', 'busy', 'config', 'upstream', 'slot_unavailable'] as const) {
		const f = fakeFetch(() => jsonRes({ ok: false, code }, 502));
		const e = await rejection(fetchAvailability(signal, target, f.fn));
		assert.equal(e.code, code);
	}
});

test('fetchAvailability: busy carries Retry-After seconds', async () => {
	const f = fakeFetch(() => jsonRes({ ok: false, code: 'busy' }, 503, { 'Retry-After': '42' }));
	const e = await rejection(fetchAvailability(signal, target, f.fn));
	assert.equal(e.code, 'busy');
	assert.equal(e.retryAfter, 42);
});

test('fetchAvailability: network error, broken JSON, wrong shape, unknown code => upstream', async () => {
	const boom = (async () => {
		throw new TypeError('network');
	}) as typeof fetch;
	assert.equal((await rejection(fetchAvailability(signal, target, boom))).code, 'upstream');
	const html = fakeFetch(() => new Response('<html>', { status: 200 }));
	assert.equal((await rejection(fetchAvailability(signal, target, html.fn))).code, 'upstream');
	const shape = fakeFetch(() => jsonRes({ ok: true, days: [] }));
	assert.equal((await rejection(fetchAvailability(signal, target, shape.fn))).code, 'upstream');
	const alien = fakeFetch(() => jsonRes({ ok: false, code: 'teapot' }, 418));
	assert.equal((await rejection(fetchAvailability(signal, target, alien.fn))).code, 'upstream');
});

test('fetchAvailability: aborted request rethrows AbortError (not mapped)', async () => {
	const ac = new AbortController();
	ac.abort();
	const aborting = (async () => {
		throw new DOMException('aborted', 'AbortError');
	}) as typeof fetch;
	await assert.rejects(fetchAvailability(ac.signal, target, aborting), (e: unknown) => {
		return !(e instanceof BookingApiError) && (e as Error).name === 'AbortError';
	});
});

test('submitBookingRequest: POST JSON same-origin with exact body, returns status', async () => {
	const f = fakeFetch(() => jsonRes({ ok: true, status: 'confirmed' }));
	const res = await submitBookingRequest(signal, body, f.fn);
	assert.deepEqual(res, { ok: true, status: 'confirmed' });
	assert.equal(f.calls[0].url, '/api/booking/request');
	assert.equal(f.calls[0].init?.method, 'POST');
	assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), body);
	const headers = new Headers(f.calls[0].init?.headers);
	assert.equal(headers.get('Content-Type'), 'application/json');
	assert.equal(f.calls[0].init?.signal, signal);
});

test('submitBookingRequest: received status', async () => {
	const f = fakeFetch(() => jsonRes({ ok: true, status: 'received' }));
	assert.equal((await submitBookingRequest(signal, body, f.fn)).status, 'received');
});

test('submitBookingRequest: invalid carries fields; other codes map by code', async () => {
	const inv = fakeFetch(() => jsonRes({ ok: false, code: 'invalid', fields: ['email', 'phone'] }, 400));
	const e = await rejection(submitBookingRequest(signal, body, inv.fn));
	assert.equal(e.code, 'invalid');
	assert.deepEqual(e.fields, ['email', 'phone']);
	for (const code of ['forbidden', 'turnstile_failed', 'slot_unavailable', 'busy', 'config', 'upstream', 'unknown'] as const) {
		const f = fakeFetch(() => jsonRes({ ok: false, code }, 500));
		assert.equal((await rejection(submitBookingRequest(signal, body, f.fn))).code, code);
	}
});

test('submitBookingRequest: network error, broken JSON, success with bad shape => unknown (never auto-resend)', async () => {
	const boom = (async () => {
		throw new TypeError('network');
	}) as typeof fetch;
	assert.equal((await rejection(submitBookingRequest(signal, body, boom))).code, 'unknown');
	const html = fakeFetch(() => new Response('<html>', { status: 502 }));
	assert.equal((await rejection(submitBookingRequest(signal, body, html.fn))).code, 'unknown');
	const shape = fakeFetch(() => jsonRes({ ok: true, status: 'weird' }));
	assert.equal((await rejection(submitBookingRequest(signal, body, shape.fn))).code, 'unknown');
	const alien = fakeFetch(() => jsonRes({ ok: false, code: 'teapot' }, 418));
	assert.equal((await rejection(submitBookingRequest(signal, body, alien.fn))).code, 'unknown');
});

test('submitBookingRequest: fields are filtered to strings', async () => {
	const f = fakeFetch(() => jsonRes({ ok: false, code: 'invalid', fields: ['email', 5, null] }, 400));
	const e = await rejection(submitBookingRequest(signal, body, f.fn));
	assert.deepEqual(e.fields, ['email']);
});

test('client never references the vendor or the old proxy', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../../src/features/booking-nubimed/client.ts', import.meta.url), 'utf8');
	assert.ok(!/__nubimed-proxy|clinicaenlanube|nubimed\.com/i.test(src));
});
