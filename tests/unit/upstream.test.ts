import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeticion, getAvailability, nubimedFetch } from '../../functions/_lib/upstream.ts';
import type { CacheLike, UpstreamDeps } from '../../functions/_lib/upstream.ts';
import type { BookingConfig } from '../../functions/_lib/env.ts';
import { resolveBookingTarget } from '../../src/features/booking-nubimed/catalog.ts';
import type { ValidatedBookingRequest } from '../../src/features/booking-nubimed/api-contract.ts';

const CONFIG: BookingConfig = {
	email: 'api@example.test',
	token: 'SECRET-TOKEN',
	clinicId: 1212,
	turnstileSecret: 'ts',
	apiBase: 'https://api.example.test/api/v1',
};

type Call = { url: string; init: RequestInit };
type Step = Response | Error;

function script(steps: Step[]) {
	const calls: Call[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		const step = steps[Math.min(calls.length - 1, steps.length - 1)];
		if (step instanceof Error) throw step;
		return step.clone();
	}) as typeof fetch;
	return { fn, calls };
}

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers });

function fakeCache(opts: { throwOn?: 'match' | 'put' | 'both' } = {}) {
	const store = new Map<string, Response>();
	const cache: CacheLike = {
		async match(req) {
			if (opts.throwOn === 'match' || opts.throwOn === 'both') throw new Error('cache down');
			return store.get(req.url)?.clone();
		},
		async put(req, res) {
			if (opts.throwOn === 'put' || opts.throwOn === 'both') throw new Error('cache down');
			store.set(req.url, res);
		},
	};
	return { cache, store };
}

function makeDeps(fetchFn: typeof fetch, cache: CacheLike | null = null) {
	const pending: Promise<unknown>[] = [];
	const sleeps: number[] = [];
	const deps: UpstreamDeps = {
		fetch: fetchFn,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		getCache: async () => cache,
		waitUntil: (p) => {
			pending.push(p);
		},
		now: () => new Date('2026-12-01T10:00:00+01:00'),
	};
	return { deps, pending, sleeps, flush: () => Promise.all(pending) };
}

const target = resolveBookingTarget(386, 'el-vendrell', 'firstVisit')!;

// ---------- nubimedFetch ----------

test('nubimedFetch sends auth headers, User-Agent JT and Accept json', async () => {
	const f = script([jsonRes([])]);
	const { deps } = makeDeps(f.fn);
	await nubimedFetch(CONFIG, 'availability', 'GET', '/agendas/1', deps);
	const h = new Headers(f.calls[0].init.headers);
	assert.equal(h.get('X-User-Email'), 'api@example.test');
	assert.equal(h.get('X-User-Token'), 'SECRET-TOKEN');
	assert.equal(h.get('User-Agent'), 'JT');
	assert.equal(h.get('Accept'), 'application/json');
	assert.equal(f.calls[0].url, 'https://api.example.test/api/v1/agendas/1');
	assert.ok(f.calls[0].init.signal instanceof AbortSignal);
});

test('nubimedFetch GET: 5xx then 200 => one retry after ~300 ms, returns the 200', async () => {
	const f = script([jsonRes({}, 503), jsonRes([['x']])]);
	const { deps, sleeps } = makeDeps(f.fn);
	const r = await nubimedFetch(CONFIG, 'availability', 'GET', '/agendas/1', deps);
	assert.equal(f.calls.length, 2);
	assert.deepEqual(sleeps, [300]);
	assert.deepEqual(r, { ok: true, body: [['x']] });
});

test('nubimedFetch GET: 5xx twice => exactly 2 calls then 502 upstream', async () => {
	const f = script([jsonRes({}, 500), jsonRes({}, 502)]);
	const { deps } = makeDeps(f.fn);
	const r = await nubimedFetch(CONFIG, 'availability', 'GET', '/agendas/1', deps);
	assert.equal(f.calls.length, 2);
	assert.deepEqual(r, { ok: false, error: { status: 502, code: 'upstream' } });
});

test('nubimedFetch GET: network error is retried once; then upstream', async () => {
	const f = script([new TypeError('fetch failed'), new TypeError('fetch failed')]);
	const { deps } = makeDeps(f.fn);
	const r = await nubimedFetch(CONFIG, 'availability', 'GET', '/agendas/1', deps);
	assert.equal(f.calls.length, 2);
	assert.deepEqual(r, { ok: false, error: { status: 502, code: 'upstream' } });
});

test('nubimedFetch GET: 4xx is NOT retried (429 => busy with Retry-After, 401 => config)', async () => {
	const f429 = script([jsonRes({ error: 'Rate limit exceeded' }, 429, { 'Retry-After': '45' })]);
	const r429 = await nubimedFetch(CONFIG, 'availability', 'GET', '/agendas/1', makeDeps(f429.fn).deps);
	assert.equal(f429.calls.length, 1);
	assert.deepEqual(r429, { ok: false, error: { status: 503, code: 'busy', retryAfter: 45 } });

	const f401 = script([jsonRes({ error: 'secret text' }, 401)]);
	const r401 = await nubimedFetch(CONFIG, 'availability', 'GET', '/agendas/1', makeDeps(f401.fn).deps);
	assert.equal(f401.calls.length, 1);
	assert.deepEqual(r401, { ok: false, error: { status: 502, code: 'config' } });
});

test('nubimedFetch POST: 5xx after send => unknown, NEVER retried', async () => {
	const f = script([jsonRes({}, 500), jsonRes({ id: 1 })]);
	const { deps, sleeps } = makeDeps(f.fn);
	const r = await nubimedFetch(CONFIG, 'request', 'POST', '/cita_peticiones', deps, { body: { a: 1 } });
	assert.equal(f.calls.length, 1);
	assert.deepEqual(sleeps, []);
	assert.deepEqual(r, { ok: false, error: { status: 502, code: 'unknown' } });
});

test('nubimedFetch POST: timeout/network error after send => unknown, one call', async () => {
	const f = script([new DOMException('timeout', 'TimeoutError')]);
	const r = await nubimedFetch(CONFIG, 'request', 'POST', '/cita_peticiones', makeDeps(f.fn).deps, { body: {} });
	assert.equal(f.calls.length, 1);
	assert.deepEqual(r, { ok: false, error: { status: 502, code: 'unknown' } });
});

test('nubimedFetch POST: failure BEFORE the request leaves (bad base URL) => upstream, no fetch', async () => {
	const f = script([jsonRes({})]);
	const r = await nubimedFetch({ ...CONFIG, apiBase: 'not a url' }, 'request', 'POST', '/cita_peticiones', makeDeps(f.fn).deps, {
		body: {},
	});
	assert.equal(f.calls.length, 0);
	assert.deepEqual(r, { ok: false, error: { status: 502, code: 'upstream' } });
});

test('nubimedFetch POST: sends JSON body with content-type', async () => {
	const f = script([jsonRes({ id: 9 })]);
	await nubimedFetch(CONFIG, 'request', 'POST', '/cita_peticiones', makeDeps(f.fn).deps, { body: { hello: 'x' } });
	assert.equal(f.calls[0].init.method, 'POST');
	assert.equal(new Headers(f.calls[0].init.headers).get('Content-Type'), 'application/json');
	assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), { hello: 'x' });
});

test('nubimedFetch POST: 422 maps known patient_* keys to our field names only', async () => {
	const f = script([jsonRes({ errors: { patient_phone: ['bad 600111222'], secret: ['x'] } }, 422)]);
	const r = await nubimedFetch(CONFIG, 'request', 'POST', '/cita_peticiones', makeDeps(f.fn).deps, { body: {} });
	assert.deepEqual(r, { ok: false, error: { status: 422, code: 'invalid', fields: ['phone'] } });
});

test('nubimedFetch POST: 200 with unparsable body still counts as sent+ok (body null)', async () => {
	const f = script([new Response('<html>', { status: 200 })]);
	const r = await nubimedFetch(CONFIG, 'request', 'POST', '/cita_peticiones', makeDeps(f.fn).deps, { body: {} });
	assert.deepEqual(r, { ok: true, body: null });
});

// ---------- getAvailability ----------

const UPSTREAM_HOURS = [
	['2026-12-02T09:30:00+01:00', [1], { day_of_week: 3 }],
	['2026-12-01T23:30:00+01:00', [1], {}],
	['2026-12-01T09:00:00+01:00', [2], {}],
];

test('getAvailability: queries the single-agenda endpoint with YYYYMMDD range, service and modality', async () => {
	const f = script([jsonRes(UPSTREAM_HOURS)]);
	const { deps } = makeDeps(f.fn);
	const r = await getAvailability(target, CONFIG, deps, 'https://site.test');
	assert.equal(f.calls.length, 1);
	const u = new URL(f.calls[0].url);
	assert.equal(u.pathname, '/api/v1/agendas/26912');
	assert.equal(u.searchParams.get('start_date'), '20261201');
	assert.equal(u.searchParams.get('end_date'), '20270301');
	assert.equal(u.searchParams.get('service_id'), '389744');
	assert.equal(u.searchParams.get('modality'), 'presencial');
	assert.deepEqual(r, {
		ok: true,
		value: {
			ok: true,
			from: '2026-12-01',
			to: '2027-03-01',
			days: {
				'2026-12-01': ['2026-12-01T09:00:00+01:00', '2026-12-01T23:30:00+01:00'],
				'2026-12-02': ['2026-12-02T09:30:00+01:00'],
			},
		},
	});
});

test('getAvailability: response never exposes user_ids, meta or agenda ids', async () => {
	const f = script([jsonRes(UPSTREAM_HOURS)]);
	const r = await getAvailability(target, CONFIG, makeDeps(f.fn).deps, 'https://site.test');
	const s = JSON.stringify(r);
	assert.equal(s.includes('day_of_week'), false);
	assert.equal(s.includes('26912'), false);
	assert.equal(s.includes('389744'), false);
});

test('getAvailability: empty upstream list => ok with empty days (real code ran)', async () => {
	const f = script([jsonRes([])]);
	const r = await getAvailability(target, CONFIG, makeDeps(f.fn).deps, 'https://site.test');
	assert.equal(f.calls.length, 1);
	assert.deepEqual(r, { ok: true, value: { ok: true, from: '2026-12-01', to: '2027-03-01', days: {} } });
});

test('getAvailability: second identical call is served from cache (one upstream call)', async () => {
	const f = script([jsonRes(UPSTREAM_HOURS)]);
	const { cache, store } = fakeCache();
	const m = makeDeps(f.fn, cache);
	const first = await getAvailability(target, CONFIG, m.deps, 'https://site.test');
	await m.flush();
	const second = await getAvailability(target, CONFIG, m.deps, 'https://site.test');
	assert.equal(f.calls.length, 1);
	assert.deepEqual(second, first);
	const key = [...store.keys()][0];
	assert.equal(key, 'https://site.test/__cache/booking/availability/v1/26912/389744/2026-12-01');
	assert.equal(store.get(key)?.headers.get('Cache-Control'), 'public, max-age=60');
});

test('getAvailability: different service => different cache key => separate upstream calls', async () => {
	const f = script([jsonRes(UPSTREAM_HOURS)]);
	const { cache, store } = fakeCache();
	const m = makeDeps(f.fn, cache);
	await getAvailability(target, CONFIG, m.deps, 'https://site.test');
	await m.flush();
	const other = resolveBookingTarget(386, 'el-vendrell', 'treatments')!;
	await getAvailability(other, CONFIG, m.deps, 'https://site.test');
	await m.flush();
	assert.equal(f.calls.length, 2);
	assert.equal(store.size, 2);
});

test('getAvailability: cache that throws on match/put degrades silently to upstream', async () => {
	for (const throwOn of ['match', 'put', 'both'] as const) {
		const f = script([jsonRes(UPSTREAM_HOURS)]);
		const m = makeDeps(f.fn, fakeCache({ throwOn }).cache);
		const r = await getAvailability(target, CONFIG, m.deps, 'https://site.test');
		await m.flush();
		assert.equal(r.ok, true, throwOn);
		assert.equal(f.calls.length, 1, throwOn);
	}
});

test('getAvailability: missing cache (null) and throwing getCache both work', async () => {
	const f = script([jsonRes(UPSTREAM_HOURS)]);
	const m = makeDeps(f.fn, null);
	m.deps.getCache = async () => {
		throw new Error('no caches');
	};
	const r = await getAvailability(target, CONFIG, m.deps, 'https://site.test');
	assert.equal(r.ok, true);
});

test('getAvailability: upstream errors are mapped and NOT cached', async () => {
	const f = script([jsonRes({}, 429, { 'Retry-After': '10' })]);
	const { cache, store } = fakeCache();
	const m = makeDeps(f.fn, cache);
	const r = await getAvailability(target, CONFIG, m.deps, 'https://site.test');
	await m.flush();
	assert.deepEqual(r, { ok: false, error: { status: 503, code: 'busy', retryAfter: 10 } });
	assert.equal(store.size, 0);
});

test('getAvailability: never calls the agenda listing endpoint', async () => {
	const f = script([jsonRes([])]);
	await getAvailability(target, CONFIG, makeDeps(f.fn).deps, 'https://site.test');
	for (const c of f.calls) assert.notEqual(new URL(c.url).pathname, '/api/v1/agendas');
});

// ---------- createPeticion ----------

const VALID: ValidatedBookingRequest = {
	target,
	requestedTime: '2026-12-02T09:30:00+01:00',
	patient: { name: 'Ana', surname: 'Pérez', phonePrefix: '34', phone: '600111222', email: 'ana@example.test' },
	comments: 'Primera visita',
	turnstileToken: 'tok',
};

test('createPeticion: POSTs the exact AD-5 payload to /cita_peticiones', async () => {
	const f = script([jsonRes({ id: 77, state: 'pendiente' })]);
	const r = await createPeticion(VALID, CONFIG, makeDeps(f.fn).deps);
	assert.equal(f.calls.length, 1);
	assert.equal(f.calls[0].url, 'https://api.example.test/api/v1/cita_peticiones');
	assert.equal(f.calls[0].init.method, 'POST');
	assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), {
		clinica_id: 1212,
		speciality_id: 386,
		schedule_id: 26912,
		service_id: 389744,
		requested_time: '2026-12-02T09:30:00+01:00',
		patient_name: 'Ana',
		patient_surname: 'Pérez',
		patient_phone: '600111222',
		patient_country_calling_code: '34',
		patient_email: 'ana@example.test',
		comments: 'Primera visita',
		modality: 'presencial',
	});
	assert.deepEqual(r, { ok: true, status: 'received', peticionId: 77 });
});

test('createPeticion: omits comments when absent; returns only the detected status', async () => {
	const f = script([jsonRes({ id: 78, state: 'pendiente', assigned_time: '2026-12-02T09:30:00+01:00', patient_name: 'Ana' })]);
	const r = await createPeticion({ ...VALID, comments: undefined }, CONFIG, makeDeps(f.fn).deps);
	assert.equal('comments' in JSON.parse(String(f.calls[0].init.body)), false);
	assert.deepEqual(r, { ok: true, status: 'confirmed', peticionId: 78 });
});

test('createPeticion: upstream failure is mapped (timeout after send => unknown) with no retry', async () => {
	const f = script([new DOMException('timeout', 'TimeoutError')]);
	const r = await createPeticion(VALID, CONFIG, makeDeps(f.fn).deps);
	assert.equal(f.calls.length, 1);
	assert.deepEqual(r, { ok: false, error: { status: 502, code: 'unknown' } });
});

test('createPeticion: 404 => 409 slot_unavailable', async () => {
	const f = script([jsonRes({ error: 'not found' }, 404)]);
	const r = await createPeticion(VALID, CONFIG, makeDeps(f.fn).deps);
	assert.deepEqual(r, { ok: false, error: { status: 409, code: 'slot_unavailable' } });
});

// ---------- createPeticion: internal peticionId (REQ-NOTIFY-6) ----------

test('createPeticion: exposes internal peticionId from numeric id and numeric-string id, on received and confirmed', async () => {
	const f1 = script([jsonRes({ id: 987, state: 'pendiente' })]);
	assert.deepEqual(await createPeticion(VALID, CONFIG, makeDeps(f1.fn).deps), { ok: true, status: 'received', peticionId: 987 });
	const f2 = script([jsonRes({ id: '987', state: 'aceptada', assigned_time: '2026-12-02T09:30:00+01:00' })]);
	assert.deepEqual(await createPeticion(VALID, CONFIG, makeDeps(f2.fn).deps), { ok: true, status: 'confirmed', peticionId: 987 });
});

test('createPeticion: invalid or missing id => peticionId undefined', async () => {
	const bodies: unknown[] = [
		{ state: 'pendiente' },
		{ id: 0, state: 'pendiente' },
		{ id: -5, state: 'pendiente' },
		{ id: '12a', state: 'pendiente' },
		{ id: 1.5, state: 'pendiente' },
		{ id: 2 ** 60, state: 'pendiente' },
		{ id: '99999999999999999999', state: 'pendiente' },
		{ id: null, state: 'pendiente' },
		{ id: '', state: 'pendiente' },
	];
	for (const body of bodies) {
		const f = script([jsonRes(body)]);
		const r = await createPeticion(VALID, CONFIG, makeDeps(f.fn).deps);
		assert.equal(r.ok, true, JSON.stringify(body));
		assert.equal((r as { peticionId?: number }).peticionId, undefined, JSON.stringify(body));
	}
});
