import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstile } from '../../functions/_lib/turnstile.ts';

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: () => Response | Promise<Response>) {
	const calls: Call[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return respond();
	}) as typeof fetch;
	return { fn, calls };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('success + action booking => true, posting secret/response/remoteip as a form', async () => {
	const f = fakeFetch(() => ok({ success: true, action: 'booking' }));
	assert.equal(await verifyTurnstile('SECRET', 'TOKEN', '203.0.113.9', f.fn), true);
	assert.equal(f.calls.length, 1);
	assert.equal(f.calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
	assert.equal(f.calls[0].init?.method, 'POST');
	const form = new URLSearchParams(String(f.calls[0].init?.body));
	assert.equal(form.get('secret'), 'SECRET');
	assert.equal(form.get('response'), 'TOKEN');
	assert.equal(form.get('remoteip'), '203.0.113.9');
});

test('remoteip omitted when the client IP is unknown', async () => {
	const f = fakeFetch(() => ok({ success: true, action: 'booking' }));
	assert.equal(await verifyTurnstile('S', 'T', null, f.fn), true);
	assert.equal(new URLSearchParams(String(f.calls[0].init?.body)).has('remoteip'), false);
});

test('success false, wrong or missing action => false', async () => {
	assert.equal(await verifyTurnstile('S', 'T', null, fakeFetch(() => ok({ success: false, action: 'booking' })).fn), false);
	assert.equal(await verifyTurnstile('S', 'T', null, fakeFetch(() => ok({ success: true, action: 'login' })).fn), false);
	assert.equal(await verifyTurnstile('S', 'T', null, fakeFetch(() => ok({ success: true })).fn), false);
	assert.equal(await verifyTurnstile('S', 'T', null, fakeFetch(() => ok({ success: 'true', action: 'booking' })).fn), false);
});

test('fail closed on network error, non-2xx and non-JSON', async () => {
	const boom = (async () => {
		throw new Error('network');
	}) as typeof fetch;
	assert.equal(await verifyTurnstile('S', 'T', null, boom), false);
	assert.equal(await verifyTurnstile('S', 'T', null, fakeFetch(() => ok({ success: true, action: 'booking' }, 500)).fn), false);
	assert.equal(await verifyTurnstile('S', 'T', null, fakeFetch(() => new Response('<html>', { status: 200 })).fn), false);
});

test('empty token => false without any network call', async () => {
	const f = fakeFetch(() => ok({ success: true, action: 'booking' }));
	assert.equal(await verifyTurnstile('S', '', null, f.fn), false);
	assert.equal(f.calls.length, 0);
});

test('passes a timeout signal to siteverify', async () => {
	const f = fakeFetch(() => ok({ success: true, action: 'booking' }));
	await verifyTurnstile('S', 'T', null, f.fn);
	assert.ok(f.calls[0].init?.signal instanceof AbortSignal);
});
