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
	email?: () => Response | Error;
}

type Kind = 'turnstile' | 'agendas' | 'post' | 'email' | 'other';

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers });

function setup(world: World = {}, cache: CacheLike | null = null) {
	const calls: { kind: Kind; url: string; init?: RequestInit }[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const path = new URL(url).pathname;
		if (url.startsWith('https://challenges.cloudflare.com/')) {
			calls.push({ kind: 'turnstile', url, init });
			const r = world.turnstile ? world.turnstile() : jsonRes({ success: true, action: 'booking' });
			if (r instanceof Error) throw r;
			return r;
		}
		if (url.startsWith('https://api.cloudflare.com/')) {
			calls.push({ kind: 'email', url, init });
			const r = world.email ? world.email() : jsonRes({ success: true });
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
	const count = (k: Kind) => calls.filter((c) => c.kind === k).length;
	const flush = async () => {
		await Promise.all(pending);
	};
	return { deps, calls, count, total: () => calls.length, pending, flush };
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

// ===================== booking notification (REQ-NOTIFY-1/2/6/7) =====================

const NOTIFY_ENV: BookingEnv = {
	...ENV,
	CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
	CF_EMAIL_API_TOKEN: 'CF-SECRET-TOKEN',
	BOOKING_NOTIFY_TO: 'doctora@example.test',
	BOOKING_NOTIFY_FROM: 'reservas@example.test',
};

const emailBody = (w: ReturnType<typeof setup>) => {
	const call = w.calls.find((c) => c.kind === 'email');
	assert.ok(call, 'email call expected');
	return JSON.parse(String(call.init?.body)) as { subject: string; text: string; html: string };
};

test('notify: received => one email scheduled via waitUntil with the pending subject; response unchanged', async () => {
	const w = setup();
	const r = await handleRequest(postReq(goodBody()), NOTIFY_ENV, w.deps);
	assert.equal(r.status, 200);
	assert.deepEqual(await r.json(), { ok: true, status: 'received' });
	assert.equal(w.pending.length, 1);
	await w.flush();
	assert.equal(w.count('email'), 1);
	assert.equal(emailBody(w).subject, 'Nueva solicitud de cita (pendiente): Tricología · El Vendrell');
	assert.equal(emailBody(w).text.includes('secreto'), false, 'comments never in the email');
	assert.equal(w.calls.at(-1)?.kind, 'email', 'email goes after the upstream POST');
});

test('notify: confirmed => confirmed subject', async () => {
	const w = setup({ post: () => jsonRes({ id: 9911, state: 'aceptada', assigned_time: SLOT }) });
	const r = await handleRequest(postReq(goodBody()), NOTIFY_ENV, w.deps);
	assert.deepEqual(await r.json(), { ok: true, status: 'confirmed' });
	await w.flush();
	assert.equal(emailBody(w).subject, 'Cita confirmada automáticamente (sin acción): Tricología · El Vendrell');
});

test('notify: unknown (5xx and network after send) => email "posible solicitud"; client still gets 502 unknown', async () => {
	for (const post of [() => jsonRes({}, 500), () => new TypeError('fetch failed')]) {
		const w = setup({ post });
		const r = await handleRequest(postReq(goodBody()), NOTIFY_ENV, w.deps);
		assert.equal(r.status, 502);
		assert.deepEqual(await r.json(), { ok: false, code: 'unknown' });
		await w.flush();
		assert.equal(w.count('email'), 1);
		assert.equal(emailBody(w).subject, 'Posible solicitud de cita (verificar en Nubimed): Tricología · El Vendrell');
	}
});

test('notify: BOOKING_NOTIFY_ON filters statuses; none disables', async () => {
	const onlyReceived = { ...NOTIFY_ENV, BOOKING_NOTIFY_ON: 'received' };
	const a = setup({ post: () => jsonRes({ id: 1, assigned_time: SLOT }) });
	await handleRequest(postReq(goodBody()), onlyReceived, a.deps);
	await a.flush();
	assert.equal(a.count('email'), 0);
	const b = setup({ post: () => jsonRes({}, 500) });
	await handleRequest(postReq(goodBody()), onlyReceived, b.deps);
	await b.flush();
	assert.equal(b.count('email'), 0);
	const c = setup();
	await handleRequest(postReq(goodBody()), { ...NOTIFY_ENV, BOOKING_NOTIFY_ON: 'none' }, c.deps);
	await c.flush();
	assert.equal(c.count('email'), 0);
	const d = setup();
	await handleRequest(postReq(goodBody()), onlyReceived, d.deps);
	await d.flush();
	assert.equal(d.count('email'), 1);
});

test('notify: zero emails on every non-created outcome (honeypot, 400/413, 403, 409, 422, busy, config, upstream)', async () => {
	const cases: { name: string; req: () => Request; world?: World; env?: BookingEnv }[] = [
		{ name: 'honeypot', req: () => postReq({ ...goodBody(), website: 'spam' }) },
		{ name: 'invalid fields', req: () => postReq({ ...goodBody(), patient: { ...goodBody().patient, phone: '12' } }) },
		{ name: 'bad json', req: () => postReq(null, {}, '{nope') },
		{ name: 'oversize', req: () => postReq(null, {}, 'x'.repeat(9000)) },
		{ name: 'forbidden', req: () => postReq(goodBody(), { Origin: 'https://evil.test' }) },
		{ name: 'turnstile_failed', req: () => postReq(goodBody()), world: { turnstile: () => jsonRes({ success: false }) } },
		{ name: 'slot_unavailable (step 6)', req: () => postReq(goodBody()), world: { agendas: () => jsonRes([]) } },
		{ name: 'availability upstream', req: () => postReq(goodBody()), world: { agendas: () => jsonRes({}, 500) } },
		{ name: 'availability busy', req: () => postReq(goodBody()), world: { agendas: () => jsonRes({}, 429) } },
		{ name: 'post 429 busy', req: () => postReq(goodBody()), world: { post: () => jsonRes({}, 429) } },
		{ name: 'post 422 invalid', req: () => postReq(goodBody()), world: { post: () => jsonRes({ errors: { patient_email: ['x'] } }, 422) } },
		{ name: 'post 400 invalid', req: () => postReq(goodBody()), world: { post: () => jsonRes({}, 400) } },
		{ name: 'post 404 slot_unavailable', req: () => postReq(goodBody()), world: { post: () => jsonRes({}, 404) } },
		{ name: 'post 401 config', req: () => postReq(goodBody()), world: { post: () => jsonRes({}, 401) } },
		{ name: 'bff config missing', req: () => postReq(goodBody()), env: { ...NOTIFY_ENV, NUBIMED_API_TOKEN: undefined } },
	];
	for (const c of cases) {
		const w = setup(c.world);
		await handleRequest(c.req(), c.env ?? NOTIFY_ENV, w.deps);
		await w.flush();
		assert.equal(w.count('email'), 0, c.name);
	}
});

test('notify: patient response is byte-identical with email ok, failing, token-invalid, network, disabled or malformed config', async () => {
	const variants: { name: string; env: BookingEnv; world: World }[] = [
		{ name: 'ok', env: NOTIFY_ENV, world: {} },
		{ name: 'provider 500', env: NOTIFY_ENV, world: { email: () => jsonRes({ success: false }, 500) } },
		{ name: 'provider 401 (invalid token)', env: NOTIFY_ENV, world: { email: () => jsonRes({ success: false }, 401) } },
		{ name: 'network', env: NOTIFY_ENV, world: { email: () => new TypeError('boom') } },
		{ name: 'disabled (no config)', env: ENV, world: {} },
		{ name: 'disabled (none)', env: { ...NOTIFY_ENV, BOOKING_NOTIFY_ON: 'none' }, world: {} },
		{ name: 'malformed notify config', env: { ...NOTIFY_ENV, CF_ACCOUNT_ID: 'nope' }, world: {} },
	];
	const spy = { warn: console.warn };
	console.warn = () => {};
	try {
		for (const post of [undefined, () => jsonRes({ id: 9, assigned_time: SLOT }), () => jsonRes({}, 500)]) {
			const snapshots: string[] = [];
			for (const v of variants) {
				const w = setup({ ...v.world, post });
				const r = await handleRequest(postReq(goodBody()), v.env, w.deps);
				await w.flush();
				snapshots.push(`${r.status}|${[...r.headers.entries()].sort().join(',')}|${await r.text()}`);
			}
			assert.equal(new Set(snapshots).size, 1, snapshots.join(' || '));
			assert.equal(snapshots[0].includes('"code":"config"'), false);
		}
	} finally {
		console.warn = spy.warn;
	}
});

test('notify: handler survives a waitUntil that throws; response unchanged', async () => {
	const w = setup();
	const deps = {
		...w.deps,
		waitUntil: () => {
			throw new Error('waitUntil exploded');
		},
	};
	const r = await handleRequest(postReq(goodBody()), NOTIFY_ENV, deps);
	assert.equal(r.status, 200);
	assert.deepEqual(await r.json(), { ok: true, status: 'received' });
});

test('notify: peticionId never reaches the response; it reaches the email link only when the template has {id}', async () => {
	const w = setup({ post: () => jsonRes({ id: 987654, state: 'pendiente' }) });
	const r = await handleRequest(postReq(goodBody()), { ...NOTIFY_ENV, NUBIMED_PANEL_URL: 'https://panel.example/p/{id}' }, w.deps);
	const text = await r.text();
	assert.equal(text.includes('987654'), false);
	assert.equal(text.includes('"id"'), false);
	await w.flush();
	assert.ok(emailBody(w).text.includes('https://panel.example/p/987654'));
	const d = setup({ post: () => jsonRes({ id: 987654, state: 'pendiente' }) });
	await handleRequest(postReq(goodBody()), NOTIFY_ENV, d.deps);
	await d.flush();
	assert.equal(emailBody(d).text.includes('987654'), false);
});

test('REQ-NOTIFY-7: no console output contains PII, emails, request id or tokens, even when the provider fails', async () => {
	const captured: string[] = [];
	const names = ['log', 'info', 'warn', 'error', 'debug'] as const;
	const originals = names.map((n) => console[n]);
	for (const n of names) console[n] = (...a: unknown[]) => void captured.push(a.map(String).join(' '));
	try {
		const worlds: World[] = [
			{ post: () => jsonRes({ id: 987654, state: 'pendiente' }), email: () => jsonRes({ success: false, errors: ['doctora@example.test'] }, 401) },
			{ post: () => jsonRes({ id: 987654, assigned_time: SLOT }), email: () => new TypeError('fetch failed doctora@example.test') },
			{ post: () => jsonRes({}, 500), email: () => jsonRes({}, 429) },
		];
		for (const world of worlds) {
			const w = setup(world);
			await handleRequest(postReq(goodBody()), NOTIFY_ENV, w.deps);
			await w.flush();
			assert.equal(w.count('email'), 1);
		}
	} finally {
		names.forEach((n, i) => {
			console[n] = originals[i];
		});
	}
	assert.ok(captured.length >= 3, 'one generic warn line per failed send');
	const all = captured.join(' | ');
	for (const secret of [
		'Ana',
		'Pérez',
		'ana@example.test',
		'600111222',
		'secreto',
		'doctora@example.test',
		'reservas@example.test',
		'987654',
		'CF-SECRET-TOKEN',
		'SECRET-TOKEN',
		'0123456789abcdef0123456789abcdef',
		'TS-TOKEN',
		'TS-SECRET',
		'Tricología',
	]) {
		assert.equal(all.includes(secret), false, secret);
	}
});
