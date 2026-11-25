import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNotifyConfig, scheduleBookingNotification, sendNotification } from '../../functions/_lib/notify.ts';
import type { NotifyConfig } from '../../functions/_lib/notify.ts';
import type { BookingEnv } from '../../functions/_lib/env.ts';
import { DEFAULT_PANEL_URL } from '../../functions/_lib/notification-content.ts';
import type { ValidatedBookingRequest } from '../../src/features/booking-nubimed/api-contract.ts';

const ACCOUNT = '0123456789abcdef0123456789abcdef';

const FULL: BookingEnv = {
	CF_ACCOUNT_ID: ACCOUNT,
	CF_EMAIL_API_TOKEN: 'CF-SECRET-TOKEN',
	BOOKING_NOTIFY_TO: 'doctora@example.test',
	BOOKING_NOTIFY_FROM: 'reservas@example.test',
};

// ===================== readNotifyConfig =====================

test('readNotifyConfig: complete env => config with defaults (all three triggers, default panel url)', () => {
	const c = readNotifyConfig(FULL);
	assert.ok(c);
	assert.equal(c.accountId, ACCOUNT);
	assert.equal(c.token, 'CF-SECRET-TOKEN');
	assert.equal(c.to, 'doctora@example.test');
	assert.equal(c.from, 'reservas@example.test');
	assert.equal(c.panelUrl, DEFAULT_PANEL_URL);
	assert.deepEqual([...c.notifyOn].sort(), ['confirmed', 'received', 'unknown']);
});

test('readNotifyConfig: null for each required var missing or blank', () => {
	for (const key of ['CF_ACCOUNT_ID', 'CF_EMAIL_API_TOKEN', 'BOOKING_NOTIFY_TO', 'BOOKING_NOTIFY_FROM'] as const) {
		assert.equal(readNotifyConfig({ ...FULL, [key]: undefined }), null, `${key} missing`);
		assert.equal(readNotifyConfig({ ...FULL, [key]: '   ' }), null, `${key} blank`);
	}
	assert.equal(readNotifyConfig({}), null);
});

test('readNotifyConfig: null for malformed account id and email-like values (incl. CR/LF)', () => {
	for (const bad of ['abc', ACCOUNT.slice(1), `${ACCOUNT}0`, 'g'.repeat(32)]) {
		assert.equal(readNotifyConfig({ ...FULL, CF_ACCOUNT_ID: bad }), null, bad);
	}
	assert.ok(readNotifyConfig({ ...FULL, CF_ACCOUNT_ID: ACCOUNT.toUpperCase() }));
	for (const key of ['BOOKING_NOTIFY_TO', 'BOOKING_NOTIFY_FROM'] as const) {
		for (const bad of ['not-an-email', 'a@b', 'a b@c.d', 'a@example.test\r\nBcc: x@y.z', 'a@example.test\nb@example.test']) {
			assert.equal(readNotifyConfig({ ...FULL, [key]: bad }), null, `${key}: ${JSON.stringify(bad)}`);
		}
	}
});

test('readNotifyConfig: BOOKING_NOTIFY_ON parsing (trim, case-insensitive, unknown ignored, empty/none => none)', () => {
	const on = (v: string) => [...(readNotifyConfig({ ...FULL, BOOKING_NOTIFY_ON: v })?.notifyOn ?? ['NULL'])].sort();
	assert.deepEqual(on('received, foo ,UNKNOWN'), ['received', 'unknown']);
	assert.deepEqual(on('confirmed'), ['confirmed']);
	assert.deepEqual(on(''), []);
	assert.deepEqual(on('none'), []);
	assert.deepEqual(on('foo,bar'), []);
});

test('readNotifyConfig: NUBIMED_PANEL_URL must be https, else default', () => {
	const url = (v: string | undefined) => readNotifyConfig({ ...FULL, NUBIMED_PANEL_URL: v })?.panelUrl;
	assert.equal(url(undefined), DEFAULT_PANEL_URL);
	assert.equal(url('   '), DEFAULT_PANEL_URL);
	assert.equal(url('http://panel.example/'), DEFAULT_PANEL_URL);
	assert.equal(url('javascript:alert(1)'), DEFAULT_PANEL_URL);
	assert.equal(url('not a url'), DEFAULT_PANEL_URL);
	assert.equal(url('https://panel.example/list'), 'https://panel.example/list');
	assert.equal(url('https://panel.example/p/{id}'), 'https://panel.example/p/{id}');
});

// ===================== sendNotification =====================

const CONTENT = { subject: 'Asunto S-1', text: 'Cuerpo texto Ana García', html: '<p>Cuerpo html Ana García</p>' };

function cfg(): NotifyConfig {
	const c = readNotifyConfig(FULL);
	assert.ok(c);
	return c;
}

type Call = { url: string; init: RequestInit };

function scripted(step: () => Response | Error) {
	const calls: Call[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		const r = step();
		if (r instanceof Error) throw r;
		return r;
	}) as typeof fetch;
	return { fn, calls };
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function spyConsole() {
	const captured: string[] = [];
	const names = ['log', 'info', 'warn', 'error', 'debug'] as const;
	const originals = names.map((n) => console[n]);
	for (const n of names) console[n] = (...a: unknown[]) => void captured.push(a.map(String).join(' '));
	return {
		captured,
		restore() {
			names.forEach((n, i) => {
				console[n] = originals[i];
			});
		},
	};
}

test('sendNotification: exact provider request (url, headers, body, signal) and success => true', async () => {
	const f = scripted(() => jsonRes({ success: true, result: {} }));
	const ok = await sendNotification(CONTENT, cfg(), f.fn);
	assert.equal(ok, true);
	assert.equal(f.calls.length, 1);
	assert.equal(f.calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`);
	assert.equal(f.calls[0].init.method, 'POST');
	const h = new Headers(f.calls[0].init.headers);
	assert.equal(h.get('Authorization'), 'Bearer CF-SECRET-TOKEN');
	assert.equal(h.get('Content-Type'), 'application/json');
	assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), {
		from: 'reservas@example.test',
		to: ['doctora@example.test'],
		subject: 'Asunto S-1',
		text: 'Cuerpo texto Ana García',
		html: '<p>Cuerpo html Ana García</p>',
	});
	assert.ok(f.calls[0].init.signal instanceof AbortSignal);
});

test('sendNotification: failures never throw, never retry, and log exactly one generic line', async () => {
	const rows: { name: string; step: () => Response | Error; logged: string }[] = [
		{ name: '401', step: () => jsonRes({ success: false, errors: [{ message: 'SECRET-PROVIDER-TEXT' }] }, 401), logged: '401' },
		{ name: '429', step: () => jsonRes({}, 429), logged: '429' },
		{ name: '500', step: () => jsonRes({}, 500), logged: '500' },
		{ name: 'success:false on 200', step: () => jsonRes({ success: false }), logged: '200' },
		{ name: 'invalid json on 200', step: () => new Response('<html>', { status: 200 }), logged: '200' },
		{ name: 'network', step: () => new TypeError('fetch failed doctora@example.test'), logged: 'network' },
		{ name: 'timeout', step: () => new DOMException('timeout', 'TimeoutError'), logged: 'network' },
	];
	for (const row of rows) {
		const spy = spyConsole();
		let ok: boolean;
		const f = scripted(row.step);
		try {
			ok = await sendNotification(CONTENT, cfg(), f.fn);
		} finally {
			spy.restore();
		}
		assert.equal(ok, false, row.name);
		assert.equal(f.calls.length, 1, `${row.name}: no retry`);
		assert.equal(spy.captured.length, 1, `${row.name}: one log line`);
		assert.equal(spy.captured[0], `booking-notify ${row.logged}`, row.name);
		const all = spy.captured.join(' | ');
		for (const secret of ['CF-SECRET-TOKEN', 'doctora@example.test', 'reservas@example.test', 'Asunto S-1', 'Ana', 'SECRET-PROVIDER-TEXT', ACCOUNT]) {
			assert.equal(all.includes(secret), false, `${row.name}: ${secret}`);
		}
	}
});

test('sendNotification: success logs nothing', async () => {
	const spy = spyConsole();
	try {
		assert.equal(await sendNotification(CONTENT, cfg(), scripted(() => jsonRes({ success: true })).fn), true);
	} finally {
		spy.restore();
	}
	assert.deepEqual(spy.captured, []);
});

test('sendNotification: honours the timeout via AbortSignal (real abort => false, no throw)', async () => {
	const fn = ((_: RequestInfo | URL, init?: RequestInit) =>
		new Promise((_, reject) => {
			init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
		})) as typeof fetch;
	const spy = spyConsole();
	const keepAlive = setTimeout(() => {}, 1000); // AbortSignal.timeout timers are unref'd
	let ok: boolean;
	try {
		ok = await sendNotification(CONTENT, cfg(), fn, 20);
	} finally {
		clearTimeout(keepAlive);
		spy.restore();
	}
	assert.equal(ok, false);
	assert.deepEqual(spy.captured, ['booking-notify network']);
});

// ===================== scheduleBookingNotification =====================

const REQ: ValidatedBookingRequest = {
	target: { specialtyId: 386, centro: 'el-vendrell', kind: 'firstVisit', agendaId: 26912, serviceId: 389744 },
	requestedTime: '2026-12-02T09:30:00+01:00',
	patient: { name: 'Ana', surname: 'García', phonePrefix: '34', phone: '600123123', email: 'ana@example.test' },
	comments: 'Tengo diabetes',
};

function world(step: () => Response | Error = () => jsonRes({ success: true })) {
	const f = scripted(step);
	const pending: Promise<unknown>[] = [];
	const deps = { fetch: f.fn, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
	return { f, pending, deps };
}

test('schedule: no config => no waitUntil and no fetch', () => {
	const w = world();
	scheduleBookingNotification({}, w.deps, { status: 'received', req: REQ });
	scheduleBookingNotification({ ...FULL, CF_EMAIL_API_TOKEN: undefined }, w.deps, { status: 'received', req: REQ });
	assert.equal(w.pending.length, 0);
	assert.equal(w.f.calls.length, 0);
});

test('schedule: status outside notifyOn => nothing; enabled status => exactly one waitUntil with the send', async () => {
	const env = { ...FULL, BOOKING_NOTIFY_ON: 'received' };
	const off = world();
	scheduleBookingNotification(env, off.deps, { status: 'confirmed', req: REQ });
	scheduleBookingNotification({ ...FULL, BOOKING_NOTIFY_ON: 'none' }, off.deps, { status: 'received', req: REQ });
	assert.equal(off.pending.length, 0);
	assert.equal(off.f.calls.length, 0);

	const on = world();
	scheduleBookingNotification(env, on.deps, { status: 'received', req: REQ });
	assert.equal(on.pending.length, 1);
	await Promise.all(on.pending);
	assert.equal(on.f.calls.length, 1);
	const body = JSON.parse(String(on.f.calls[0].init.body));
	assert.equal(body.subject, 'Nueva solicitud de cita (pendiente): Tricología · El Vendrell');
	assert.equal(body.text.includes('diabetes'), false);
	assert.equal(body.html.includes('diabetes'), false);
	assert.equal('reply_to' in body || 'cc' in body || 'bcc' in body, false);
});

test('schedule: each status uses its own subject; unknown has no id and falls back to the default link', async () => {
	const env = { ...FULL, NUBIMED_PANEL_URL: 'https://panel.example/p/{id}' };
	const subjects: string[] = [];
	for (const status of ['received', 'confirmed', 'unknown'] as const) {
		const w = world();
		scheduleBookingNotification(env, w.deps, { status, req: REQ, peticionId: status === 'unknown' ? undefined : 987 });
		await Promise.all(w.pending);
		const body = JSON.parse(String(w.f.calls[0].init.body));
		subjects.push(body.subject);
		if (status === 'unknown') {
			assert.ok(body.text.includes(DEFAULT_PANEL_URL));
			assert.equal(body.text.includes('{id}'), false);
		} else {
			assert.ok(body.text.includes('https://panel.example/p/987'));
		}
	}
	assert.equal(new Set(subjects).size, 3);
});

test('schedule: is synchronous (does not await the send) and swallows internal errors', () => {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const pending: Promise<unknown>[] = [];
	const fn = (async () => {
		await gate;
		return jsonRes({ success: true });
	}) as typeof fetch;
	const out = scheduleBookingNotification(FULL, { fetch: fn, waitUntil: (p) => void pending.push(p) }, { status: 'received', req: REQ });
	assert.equal(out, undefined);
	assert.equal(pending.length, 1);
	release();

	const throwing = { fetch: fn, waitUntil: () => { throw new Error('waitUntil exploded'); } };
	assert.doesNotThrow(() => scheduleBookingNotification(FULL, throwing, { status: 'received', req: REQ }));
	const badReq = { ...REQ, requestedTime: 'not-a-date' };
	assert.doesNotThrow(() => scheduleBookingNotification(FULL, { fetch: fn, waitUntil: () => {} }, { status: 'received', req: badReq }));
});
