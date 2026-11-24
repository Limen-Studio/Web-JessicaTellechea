import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../../functions/_lib/env.ts';
import { errorResponse, isSameOrigin, json, mappedErrorResponse, methodNotAllowed } from '../../functions/_lib/http.ts';

const FULL = {
	NUBIMED_API_EMAIL: 'api@example.test',
	NUBIMED_API_TOKEN: 'tok',
	NUBIMED_CLINIC_ID: '1212',
	TURNSTILE_SECRET_KEY: 'sec',
};

test('readConfig: full env => config with default https base', () => {
	assert.deepEqual(readConfig(FULL), {
		email: 'api@example.test',
		token: 'tok',
		clinicId: 1212,
		turnstileSecret: 'sec',
		apiBase: 'https://api.clinicaenlanube.com/api/v1',
	});
});

test('readConfig: each required value missing or blank => null (fail closed)', () => {
	for (const key of Object.keys(FULL)) {
		assert.equal(readConfig({ ...FULL, [key]: undefined }), null, `${key} undefined`);
		assert.equal(readConfig({ ...FULL, [key]: '  ' }), null, `${key} blank`);
	}
});

test('readConfig: clinic id must be a positive integer', () => {
	for (const bad of ['0', '-3', 'abc', '12.5', '1e3']) {
		assert.equal(readConfig({ ...FULL, NUBIMED_CLINIC_ID: bad }), null, bad);
	}
	assert.equal(readConfig({ ...FULL, NUBIMED_CLINIC_ID: ' 77 ' })?.clinicId, 77);
});

test('readConfig: NUBIMED_API_BASE override must be https; trailing slashes stripped', () => {
	assert.equal(readConfig({ ...FULL, NUBIMED_API_BASE: 'https://staging.example.test/api/v1/' })?.apiBase, 'https://staging.example.test/api/v1');
	assert.equal(readConfig({ ...FULL, NUBIMED_API_BASE: 'http://insecure.example.test' }), null);
	assert.equal(readConfig({ ...FULL, NUBIMED_API_BASE: 'not a url' }), null);
	assert.equal(readConfig({ ...FULL, NUBIMED_API_BASE: '   ' })?.apiBase, 'https://api.clinicaenlanube.com/api/v1');
});

test('json: sets content-type, no-store and noindex on every response', async () => {
	const r = json(201, { ok: true });
	assert.equal(r.status, 201);
	assert.equal(r.headers.get('content-type'), 'application/json');
	assert.equal(r.headers.get('cache-control'), 'no-store');
	assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
	assert.deepEqual(await r.json(), { ok: true });
});

test('json: extra headers are added but cannot weaken the mandatory ones', () => {
	const r = json(200, {}, { 'Retry-After': '5', 'Cache-Control': 'public' });
	assert.equal(r.headers.get('retry-after'), '5');
	assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('errorResponse: { ok:false, code } with optional fields', async () => {
	const a = errorResponse('invalid', 400, ['phone']);
	assert.equal(a.status, 400);
	assert.deepEqual(await a.json(), { ok: false, code: 'invalid', fields: ['phone'] });
	const b = errorResponse('config', 503);
	assert.deepEqual(await b.json(), { ok: false, code: 'config' });
});

test('mappedErrorResponse: busy carries Retry-After; others do not', async () => {
	const busy = mappedErrorResponse({ status: 503, code: 'busy', retryAfter: 90 });
	assert.equal(busy.status, 503);
	assert.equal(busy.headers.get('retry-after'), '90');
	assert.deepEqual(await busy.json(), { ok: false, code: 'busy' });
	const inv = mappedErrorResponse({ status: 422, code: 'invalid', fields: ['email'] });
	assert.equal(inv.headers.get('retry-after'), null);
	assert.deepEqual(await inv.json(), { ok: false, code: 'invalid', fields: ['email'] });
});

test('isSameOrigin: Origin must equal request origin', () => {
	const mk = (h: Record<string, string>) => new Request('https://site.test/api/booking/request', { method: 'POST', headers: h });
	assert.equal(isSameOrigin(mk({ Origin: 'https://site.test' })), true);
	assert.equal(isSameOrigin(mk({ Origin: 'https://evil.test' })), false);
	assert.equal(isSameOrigin(mk({ Origin: 'null' })), false);
});

test('isSameOrigin: without Origin falls back to Sec-Fetch-Site same-origin only', () => {
	const mk = (h: Record<string, string>) => new Request('https://site.test/x', { method: 'POST', headers: h });
	assert.equal(isSameOrigin(mk({ 'Sec-Fetch-Site': 'same-origin' })), true);
	assert.equal(isSameOrigin(mk({ 'Sec-Fetch-Site': 'cross-site' })), false);
	assert.equal(isSameOrigin(mk({ 'Sec-Fetch-Site': 'same-site' })), false);
	assert.equal(isSameOrigin(mk({})), false);
});

test('methodNotAllowed: 405 with Allow header, invalid code and mandatory headers', async () => {
	const r = methodNotAllowed('POST');
	assert.equal(r.status, 405);
	assert.equal(r.headers.get('Allow'), 'POST');
	assert.equal(r.headers.get('Cache-Control'), 'no-store');
	assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow');
	assert.deepEqual(await r.json(), { ok: false, code: 'invalid' });
});
