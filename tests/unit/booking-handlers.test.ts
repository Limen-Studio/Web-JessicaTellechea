import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAvailability, handleHealth, handleRequest } from '../../functions/_lib/handlers.ts';
import type { BookingEnv } from '../../functions/_lib/env.ts';
import type { CacheLike, UpstreamDeps } from '../../functions/_lib/upstream.ts';

const ENV: BookingEnv = {
	NUBIMED_API_EMAIL: 'api@example.test',
	NUBIMED_API_TOKEN: 'SECRET-TOKEN',
	NUBIMED_CLINIC_ID: '1212',
	TURNSTILE_SECRET_KEY: 'TS-SECRET',
};

const SLOT = '2026-12-02T09:30:00+01:00';
const HOURS = [
	[SLOT, [4242], { day_of_week: 3 }],
	['2026-12-02T10:00:00+01:00', [4242], {}],
];

interface World {
	agendas?: () => Response;
	post?: () => Response | Error;
	turnstile?: () => Response | Error;
}

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers });

function setup(world: World = {}, cache: CacheLike | null = null) {
	const calls: { kind: 'turnstile' | 'agendas' | 'post' | 'other'; url: string; init?: RequestInit }[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const path = new URL(url).pathname;
		if (url.startsWith('https://challenges.cloudflare.com/')) {
			calls.push({ kind: 'turnstile', url, init });
			const r = world.turnstile ? world.turnstile() : jsonRes({ success: true, action: 'booking' });
			if (r instanceof Error) throw r;
			return r;
		}
		if (path.endsWith('/cita_peticiones')) {
			calls.push({ kind: 'post', url, init });
			const r = world.post ? world.post() : jsonRes({ id: 5, state: 'pendiente' });
			if (r instanceof Error) throw r;
			return r;
		}
		if (path.includes('/agendas/')) {
			calls.push({ kind: 'agendas', url, init });
			return world.agendas ? world.agendas() : jsonRes(HOURS);
		}
		calls.push({ kind: 'other', url, init });
		return jsonRes({}, 404);
	}) as typeof fetch;
	const pending: Promise<unknown>[] = [];
	const deps: UpstreamDeps = {
		fetch: fn,
		sleep: async () => {},
		getCache: async () => cache,
		waitUntil: (p) => {
			pending.push(p);
		},
		now: () => new Date('2026-12-01T10:00:00+01:00'),
	};
	const count = (k: 'turnstile' | 'agendas' | 'post' | 'other') => calls.filter((c) => c.kind === k).length;
	return { deps, calls, count, total: () => calls.length };
}

const ORIGIN = 'https://site.test';

function availReq(qs: string, method = 'GET') {
	return new Request(`${ORIGIN}/api/booking/availability?${qs}`, { method });
}

const GOOD_QS = 'specialty=386&centro=el-vendrell&kind=firstVisit';

const goodBody = () => ({
	specialty: 386,
	centro: 'el-vendrell',
	kind: 'firstVisit',
	requestedTime: SLOT,
	patient: { name: 'Ana', surname: 'Pérez', phonePrefix: '34', phone: '600111222', email: 'ana@example.test' },
	comments: 'Dolor de cabeza secreto',
	consent: true,
	turnstileToken: 'TS-TOKEN',
});

function postReq(body: unknown, headers: Record<string, string> = {}, raw?: string) {
	return new Request(`${ORIGIN}/api/booking/request`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7', ...headers },
		body: raw ?? JSON.stringify(body),
	});
}

function assertBaseHeaders(r: Response) {
	assert.equal(r.headers.get('content-type'), 'application/json');
	assert.equal(r.headers.get('cache-control'), 'no-store');
	assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
}

// ===================== availability =====================

test('availability 200: grouped days, no ids/professionals, auth headers sent upstream only', async () => {
	const w = setup();
	const r = await handleAvailability(availReq(GOOD_QS), ENV, w.deps);
	assert.equal(r.status, 200);
	assertBaseHeaders(r);
	const text = await r.text();
	assert.deepEqual(JSON.parse(text), {
		ok: true,
		from: '2026-12-01',
		to: '2027-03-01',
		days: { '2026-12-02': [SLOT, '2026-12-02T10:00:00+01:00'] },
	});
	for (const leak of ['4242', '26912', '389744', 'SECRET-TOKEN', 'api@example.test', 'day_of_week']) {
		assert.equal(text.includes(leak), false, leak);
	}
	assert.equal(w.total(), 1);
	const h = new Headers(w.calls[0].init?.headers);
	assert.equal(h.get('X-User-Token'), 'SECRET-TOKEN');
	assert.equal(h.get('X-User-Email'), 'api@example.test');
	assert.equal(h.get('User-Agent'), 'JT');
});

test('availability: missing config => 503 config and zero upstream calls', async () => {
	const w = setup();
	const r = await handleAvailability(availReq(GOOD_QS), { ...ENV, NUBIMED_API_TOKEN: undefined }, w.deps);
	assert.equal(r.status, 503);
	assertBaseHeaders(r);
	assert.deepEqual(await r.json(), { ok: false, code: 'config' });
	assert.equal(w.total(), 0);
});

test('availability: unknown centro, client from/to, missing or extra params => 400 invalid, no upstream', async () => {
	for (const qs of [
		'specialty=386&centro=madrid&kind=firstVisit',
		`${GOOD_QS}&from=2020-01-01`,
		`${GOOD_QS}&to=2030-01-01`,
		'specialty=386&centro=el-vendrell',
		'specialty=4&centro=el-vendrell&kind=firstVisit',
		`${GOOD_QS}&schedule_id=1`,
	]) {
		const w = setup();
		const r = await handleAvailability(availReq(qs), ENV, w.deps);
		assert.equal(r.status, 400, qs);
		assertBaseHeaders(r);
		assert.deepEqual(await r.json(), { ok: false, code: 'invalid' }, qs);
		assert.equal(w.total(), 0, qs);
	}
});

test('availability: upstream 429 => 503 busy with Retry-After; body has no upstream text', async () => {
	const w = setup({ agendas: () => jsonRes({ error: 'Rate limit exceeded for secret@x.test' }, 429, { 'Retry-After': '33' }) });
	const r = await handleAvailability(availReq(GOOD_QS), ENV, w.deps);
	assert.equal(r.status, 503);
	assert.equal(r.headers.get('retry-after'), '33');
	assert.equal(JSON.stringify(await r.json()).includes('secret@x.test'), false);
});

test('availability: upstream 401 => 502 config; 500 twice => 502 upstream (one retry)', async () => {
	const w1 = setup({ agendas: () => jsonRes({ error: 'bad token' }, 401) });
	const r1 = await handleAvailability(availReq(GOOD_QS), ENV, w1.deps);
	assert.equal(r1.status, 502);
	assert.deepEqual(await r1.json(), { ok: false, code: 'config' });

	const w2 = setup({ agendas: () => jsonRes({}, 500) });
	const r2 = await handleAvailability(availReq(GOOD_QS), ENV, w2.deps);
	assert.equal(r2.status, 502);
	assert.deepEqual(await r2.json(), { ok: false, code: 'upstream' });
	assert.equal(w2.count('agendas'), 2);
});

test('availability: empty upstream list => 200 with empty days', async () => {
	const w = setup({ agendas: () => jsonRes([]) });
	const r = await handleAvailability(availReq(GOOD_QS), ENV, w.deps);
	assert.equal(r.status, 200);
	assert.deepEqual((await r.json()).days, {});
});

// ===================== health =====================

test('health: 200 when config present, 503 config otherwise, never calls upstream or leaks values', async () => {
	const ok = handleHealth(ENV);
	assert.equal(ok.status, 200);
	assertBaseHeaders(ok);
	const okText = await ok.text();
	assert.deepEqual(JSON.parse(okText), { ok: true });
	for (const v of Object.values(ENV)) assert.equal(okText.includes(String(v)), false);

	const bad = handleHealth({ ...ENV, TURNSTILE_SECRET_KEY: undefined });
	assert.equal(bad.status, 503);
	assertBaseHeaders(bad);
	assert.deepEqual(await bad.json(), { ok: false, code: 'config' });
});

// ===================== request =====================

test('request happy path: pending upstream => received; each upstream step exactly once, in order', async () => {
	const w = setup();
	const r = await handleRequest(postReq(goodBody()), ENV, w.deps);
	assert.equal(r.status, 200);
	assertBaseHeaders(r);
	assert.deepEqual(await r.json(), { ok: true, status: 'received' });
	assert.deepEqual(
		w.calls.map((c) => c.kind),
		['turnstile', 'agendas', 'post'],
	);
	const form = new URLSearchParams(String(w.calls[0].init?.body));
	assert.equal(form.get('secret'), 'TS-SECRET');
	assert.equal(form.get('response'), 'TS-TOKEN');
	assert.equal(form.get('remoteip'), '203.0.113.7');
	const payload = JSON.parse(String(w.calls[2].init?.body));
	assert.equal(payload.requested_time, SLOT);
	assert.equal(payload.schedule_id, 26912);
	assert.equal(payload.service_id, 389744);
	assert.equal(payload.speciality_id, 386);
	assert.equal(payload.clinica_id, 1212);
	assert.equal(payload.modality, 'presencial');
	assert.equal(payload.patient_country_calling_code, '34');
});

test('request: assigned_time upstream => confirmed; response has no id/PII/body', async () => {
	const w = setup({ post: () => jsonRes({ id: 9911, state: 'aceptada', assigned_time: SLOT, patient_name: 'Ana' }) });
	const r = await handleRequest(postReq(goodBody()), ENV, w.deps);
	const text = await r.text();
	assert.deepEqual(JSON.parse(text), { ok: true, status: 'confirmed' });
	for (const leak of ['9911', 'Ana', 'ana@example.test', '600111222', 'secreto']) assert.equal(text.includes(leak), false, leak);
});

test('request step 1: non-JSON content-type => 400 invalid, nothing called', async () => {
	const w = setup();
	const r = await handleRequest(postReq(goodBody(), { 'Content-Type': 'text/plain' }), ENV, w.deps);
	assert.equal(r.status, 400);
	assert.deepEqual(await r.json(), { ok: false, code: 'invalid' });
	assert.equal(w.total(), 0);
});

test('request step 1: application/json with charset is accepted', async () => {
	const w = setup();
	const r = await handleRequest(postReq(goodBody(), { 'Content-Type': 'application/json; charset=utf-8' }), ENV, w.deps);
	assert.equal(r.status, 200);
});

test('request step 1: body over 8 KB => 413 invalid, nothing called (with and without Content-Length)', async () => {
	const big = JSON.stringify({ ...goodBody(), comments: 'x'.repeat(9000) });
	const w = setup();
	const r1 = await handleRequest(postReq(null, {}, big), ENV, w.deps);
	assert.equal(r1.status, 413);
	assert.deepEqual(await r1.json(), { ok: false, code: 'invalid' });
	const r2 = await handleRequest(postReq(null, { 'Content-Length': String(big.length) }, big), ENV, w.deps);
	assert.equal(r2.status, 413);
	assert.equal(w.total(), 0);
});

test('request step 1 precedes origin check: oversize from a foreign origin is still 413', async () => {
	const w = setup();
	const r = await handleRequest(postReq(null, { Origin: 'https://evil.test' }, 'x'.repeat(9000)), ENV, w.deps);
	assert.equal(r.status, 413);
});

test('request step 2: foreign Origin => 403 forbidden without turnstile or upstream (even with honeypot)', async () => {
	const w = setup();
	const r = await handleRequest(postReq(goodBody(), { Origin: 'https://evil.test' }), ENV, w.deps);
	assert.equal(r.status, 403);
	assert.deepEqual(await r.json(), { ok: false, code: 'forbidden' });
	const r2 = await handleRequest(postReq({ ...goodBody(), website: 'spam' }, { Origin: 'https://evil.test' }), ENV, w.deps);
	assert.equal(r2.status, 403);
	assert.equal(w.total(), 0);
});

test('request step 2: no Origin => requires Sec-Fetch-Site same-origin', async () => {
	const mk = (sfs?: string) => {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (sfs) headers['Sec-Fetch-Site'] = sfs;
		return new Request(`${ORIGIN}/api/booking/request`, { method: 'POST', headers, body: JSON.stringify(goodBody()) });
	};
	const w1 = setup();
	assert.equal((await handleRequest(mk('same-origin'), ENV, w1.deps)).status, 200);
	const w2 = setup();
	assert.equal((await handleRequest(mk('cross-site'), ENV, w2.deps)).status, 403);
	assert.equal((await handleRequest(mk(), ENV, w2.deps)).status, 403);
	assert.equal(w2.total(), 0);
});

test('request: invalid JSON => 400 invalid', async () => {
	const w = setup();
	const r = await handleRequest(postReq(null, {}, '{not json'), ENV, w.deps);
	assert.equal(r.status, 400);
	assert.deepEqual(await r.json(), { ok: false, code: 'invalid' });
	assert.equal(w.total(), 0);
});

test('request step 3: honeypot => simulated 200 received on the RAW body, no turnstile, no upstream, even with garbage fields', async () => {
	const w = setup();
	const r = await handleRequest(postReq({ website: 'http://spam.test', patient: 42 }), ENV, w.deps);
	assert.equal(r.status, 200);
	assertBaseHeaders(r);
	assert.deepEqual(await r.json(), { ok: true, status: 'received' });
	assert.equal(w.total(), 0);
	// also works without server config (no effects at all)
	const r2 = await handleRequest(postReq({ ...goodBody(), website: 'x' }), {}, w.deps);
	assert.deepEqual(await r2.json(), { ok: true, status: 'received' });
	assert.equal(w.total(), 0);
});

test('request step 3: empty or whitespace honeypot is not a honeypot hit', async () => {
	const w = setup();
	const r = await handleRequest(postReq({ ...goodBody(), website: '' }), ENV, w.deps);
	assert.equal(r.status, 200);
	assert.equal(w.count('post'), 1);
});

test('request step 4: invalid fields => 400 invalid with own field names, before turnstile', async () => {
	const w = setup();
	const body = goodBody();
	body.patient.phone = '1234';
	body.comments = 'x'.repeat(501);
	const r = await handleRequest(postReq(body), ENV, w.deps);
	assert.equal(r.status, 400);
	const j = await r.json();
	assert.equal(j.code, 'invalid');
	assert.deepEqual([...j.fields].sort(), ['comments', 'phone']);
	assert.equal(w.total(), 0);
});

test('request step 4: raw vendor ids => 400 invalid, never used', async () => {
	for (const extra of [{ schedule_id: 1 }, { service_id: 2 }, { speciality_id: 3 }, { clinica_id: 4 }, { area_id: 5 }]) {
		const w = setup();
		const r = await handleRequest(postReq({ ...goodBody(), ...extra }), ENV, w.deps);
		assert.equal(r.status, 400, JSON.stringify(extra));
		assert.equal(w.total(), 0);
	}
});

test('request: missing config => 503 config, no turnstile and no upstream', async () => {
	const w = setup();
	const r = await handleRequest(postReq(goodBody()), { ...ENV, NUBIMED_API_TOKEN: undefined }, w.deps);
	assert.equal(r.status, 503);
	assert.deepEqual(await r.json(), { ok: false, code: 'config' });
	assert.equal(w.total(), 0);
});

test('request step 5: missing token => 403 turnstile_failed (not invalid), no siteverify, no upstream', async () => {
	const w = setup();
	const body: Record<string, unknown> = goodBody();
	delete body.turnstileToken;
	const r = await handleRequest(postReq(body), ENV, w.deps);
	assert.equal(r.status, 403);
	assert.deepEqual(await r.json(), { ok: false, code: 'turnstile_failed' });
	assert.equal(w.total(), 0);
});

test('request step 5: siteverify failure / wrong action / network error => 403 turnstile_failed, nubimed untouched', async () => {
	const cases: World['turnstile'][] = [
		() => jsonRes({ success: false }),
		() => jsonRes({ success: true, action: 'other' }),
		() => new Error('timeout'),
		() => jsonRes({}, 500),
	];
	for (const turnstile of cases) {
		const w = setup({ turnstile });
		const r = await handleRequest(postReq(goodBody()), ENV, w.deps);
		assert.equal(r.status, 403);
		assert.deepEqual(await r.json(), { ok: false, code: 'turnstile_failed' });
		assert.equal(w.count('turnstile'), 1);
		assert.equal(w.count('agendas'), 0);
		assert.equal(w.count('post'), 0);
	}
});

test('request step 6: slot absent from availability => 409 slot_unavailable, POST never made', async () => {
	const w = setup({ agendas: () => jsonRes([['2026-12-03T09:30:00+01:00', [1], {}]]) });
	const r = await handleRequest(postReq(goodBody()), ENV, w.deps);
	assert.equal(r.status, 409);
	assert.deepEqual(await r.json(), { ok: false, code: 'slot_unavailable' });
	assert.equal(w.count('post'), 0);
});

test('request step 6: reformatted ISO (other zone) is not accepted as the same slot', async () => {
	const w = setup();
	const r = await handleRequest(postReq({ ...goodBody(), requestedTime: '2026-12-02T08:30:00Z' }), ENV, w.deps);
	assert.equal(r.status, 409);
	assert.equal(w.count('post'), 0);
});

test('request step 6: availability upstream failure is mapped (busy keeps Retry-After), no POST', async () => {
	const w = setup({ agendas: () => jsonRes({}, 429, { 'Retry-After': '12' }) });
	const r = await handleRequest(postReq(goodBody()), ENV, w.deps);
	assert.equal(r.status, 503);
	assert.equal(r.headers.get('retry-after'), '12');
	assert.equal(w.count('post'), 0);
});

test('request step 6 uses cached availability (no second agendas call)', async () => {
	const store = new Map<string, Response>();
	const cache: CacheLike = {
		async match(req) {
			return store.get(req.url)?.clone();
		},
		async put(req, res) {
			store.set(req.url, res);
		},
	};
	const w = setup({}, cache);
	await handleAvailability(availReq(GOOD_QS), ENV, w.deps);
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
	const r = await handleRequest(postReq(goodBody()), ENV, w.deps);
	assert.equal(r.status, 200);
	assert.equal(w.count('agendas'), 1);
});

test('request step 7: upstream error mapping table (never forwards upstream text)', async () => {
	const SECRET_TEXT = 'LEAK-ana@example.test-600111222';
	const rows: { name: string; post: () => Response | Error; status: number; code: string; fields?: string[]; retry?: string }[] = [
		{ name: '429', post: () => jsonRes({ error: SECRET_TEXT }, 429, { 'Retry-After': '20' }), status: 503, code: 'busy', retry: '20' },
		{ name: '422', post: () => jsonRes({ errors: { patient_email: [SECRET_TEXT], other: [SECRET_TEXT] } }, 422), status: 422, code: 'invalid', fields: ['email'] },
		{ name: '400', post: () => jsonRes({ error: SECRET_TEXT }, 400), status: 400, code: 'invalid' },
		{ name: '404', post: () => jsonRes({ error: SECRET_TEXT }, 404), status: 409, code: 'slot_unavailable' },
		{ name: '401', post: () => jsonRes({ error: SECRET_TEXT }, 401), status: 502, code: 'config' },
		{ name: '403', post: () => jsonRes({ error: SECRET_TEXT }, 403), status: 502, code: 'config' },
		{ name: '500', post: () => jsonRes({ error: SECRET_TEXT }, 500), status: 502, code: 'unknown' },
		{ name: 'network', post: () => new TypeError('fetch failed'), status: 502, code: 'unknown' },
	];
	for (const row of rows) {
		const w = setup({ post: row.post });
		const r = await handleRequest(postReq(goodBody()), ENV, w.deps);
		assert.equal(r.status, row.status, row.name);
		assertBaseHeaders(r);
		assert.equal(r.headers.get('retry-after'), row.retry ?? null, row.name);
		const text = await r.text();
		assert.equal(text.includes('LEAK'), false, row.name);
		const j = JSON.parse(text);
		assert.equal(j.code, row.code, row.name);
		assert.deepEqual(j.fields, row.fields, row.name);
		assert.equal(w.count('post'), 1, `${row.name}: POST must never be retried`);
	}
});

test('REQ-BFF-11: no console output ever contains PII, token or comments (success and error paths)', async () => {
	const captured: string[] = [];
	const names = ['log', 'info', 'warn', 'error', 'debug'] as const;
	const originals = names.map((n) => console[n]);
	for (const n of names) console[n] = (...a: unknown[]) => void captured.push(a.map(String).join(' '));
	try {
		const worlds: World[] = [{}, { post: () => jsonRes({ error: 'x' }, 500) }, { post: () => jsonRes({}, 401) }, { agendas: () => jsonRes({}, 500) }];
		for (const world of worlds) {
			await handleRequest(postReq(goodBody()), ENV, setup(world).deps);
		}
		await handleAvailability(availReq(GOOD_QS), ENV, setup({ agendas: () => jsonRes({}, 500) }).deps);
	} finally {
		names.forEach((n, i) => {
			console[n] = originals[i];
		});
	}
	assert.ok(captured.length > 0, 'warn lines for config/upstream failures are expected');
	const all = captured.join('\n');
	for (const pii of ['Ana', 'Pérez', 'ana@example.test', '600111222', 'secreto', 'TS-TOKEN', 'SECRET-TOKEN', 'TS-SECRET', 'api@example.test']) {
		assert.equal(all.includes(pii), false, pii);
	}
});
