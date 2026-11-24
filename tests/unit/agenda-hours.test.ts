import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseAgendaHours,
	groupByMadridDay,
	formatSlotTime,
} from '../../src/features/booking-nubimed/agenda-hours.ts';

test('parseAgendaHours extracts ISO strings from tuples and drops user_ids/meta', () => {
	const raw = [
		['2026-12-01T09:30:00+01:00', [11, 12], { day_of_week: 2, day_of_week_iso8601: 'x' }],
		['2026-12-01T10:00:00+01:00', [11], {}],
	];
	assert.deepEqual(parseAgendaHours(raw), ['2026-12-01T09:30:00+01:00', '2026-12-01T10:00:00+01:00']);
});

test('parseAgendaHours ignores malformed entries without throwing', () => {
	const raw = [
		null,
		undefined,
		42,
		'2026-12-01T09:30:00+01:00',
		[],
		[123],
		['not-a-date', [1], {}],
		['2026-12-01', [1], {}],
		['2026-12-01T09:30:00', [1], {}],
		['2026-12-01T11:00:00+01:00', [1], {}],
	];
	assert.deepEqual(parseAgendaHours(raw), ['2026-12-01T11:00:00+01:00']);
});

test('parseAgendaHours returns [] for non-array input', () => {
	for (const v of [null, undefined, {}, 'x', 5]) assert.deepEqual(parseAgendaHours(v), []);
});

test('groupByMadridDay groups by Madrid day keeping the original ISO', () => {
	const days = groupByMadridDay([
		'2026-12-01T23:30:00+01:00',
		'2026-12-01T09:30:00+01:00',
		'2026-12-02T10:00:00+01:00',
	]);
	assert.deepEqual(days, {
		'2026-12-01': ['2026-12-01T09:30:00+01:00', '2026-12-01T23:30:00+01:00'],
		'2026-12-02': ['2026-12-02T10:00:00+01:00'],
	});
});

test('groupByMadridDay sorts days and hours regardless of input order', () => {
	const days = groupByMadridDay([
		'2026-12-03T09:00:00+01:00',
		'2026-12-01T12:00:00+01:00',
		'2026-12-01T08:00:00+01:00',
	]);
	assert.deepEqual(Object.keys(days), ['2026-12-01', '2026-12-03']);
	assert.deepEqual(days['2026-12-01'], ['2026-12-01T08:00:00+01:00', '2026-12-01T12:00:00+01:00']);
});

test('groupByMadridDay: empty list gives {}', () => {
	assert.deepEqual(groupByMadridDay([]), {});
});

test('groupByMadridDay: midnight boundary puts 23:59 and 00:00 on different days', () => {
	const days = groupByMadridDay(['2026-12-02T00:00:00+01:00', '2026-12-01T23:59:00+01:00']);
	assert.deepEqual(days, {
		'2026-12-01': ['2026-12-01T23:59:00+01:00'],
		'2026-12-02': ['2026-12-02T00:00:00+01:00'],
	});
});

test('groupByMadridDay: a UTC ISO whose Madrid date differs lands on the Madrid day', () => {
	const days = groupByMadridDay(['2026-12-01T23:30:00Z', '2026-12-01T23:30:00+00:00']);
	assert.deepEqual(days, { '2026-12-02': ['2026-12-01T23:30:00Z', '2026-12-01T23:30:00+00:00'] });
});

test('groupByMadridDay: DST end (2026-10-25) keeps both 02:30 occurrences in order', () => {
	const days = groupByMadridDay([
		'2026-10-25T02:30:00+01:00',
		'2026-10-25T02:30:00+02:00',
		'2026-10-25T03:00:00+01:00',
	]);
	assert.deepEqual(days, {
		'2026-10-25': ['2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00', '2026-10-25T03:00:00+01:00'],
	});
});

test('groupByMadridDay: DST start (2026-03-29) groups correctly', () => {
	const days = groupByMadridDay([
		'2026-03-29T03:00:00+02:00',
		'2026-03-29T01:59:00+01:00',
		'2026-03-28T23:30:00+01:00',
		'2026-03-28T23:30:00Z',
	]);
	assert.deepEqual(days, {
		'2026-03-28': ['2026-03-28T23:30:00+01:00'],
		'2026-03-29': ['2026-03-28T23:30:00Z', '2026-03-29T01:59:00+01:00', '2026-03-29T03:00:00+02:00'],
	});
});

test('groupByMadridDay: duplicates are collapsed', () => {
	const days = groupByMadridDay(['2026-12-01T09:30:00+01:00', '2026-12-01T09:30:00+01:00']);
	assert.deepEqual(days, { '2026-12-01': ['2026-12-01T09:30:00+01:00'] });
});

test('formatSlotTime renders Madrid wall time regardless of process TZ', () => {
	const prev = process.env.TZ;
	try {
		for (const tz of ['America/New_York', 'Asia/Tokyo', 'UTC']) {
			process.env.TZ = tz;
			assert.equal(formatSlotTime('2026-12-01T09:30:00+01:00'), '09:30', tz);
			assert.equal(formatSlotTime('2026-12-01T08:30:00Z'), '09:30', tz);
			assert.equal(formatSlotTime('2026-07-01T07:30:00Z'), '09:30', tz);
			assert.equal(formatSlotTime('2026-12-01T23:30:00Z'), '00:30', tz);
		}
	} finally {
		if (prev === undefined) delete process.env.TZ;
		else process.env.TZ = prev;
	}
});

test('formatSlotTime: midnight is 00:00 (24h clock)', () => {
	assert.equal(formatSlotTime('2026-12-02T00:00:00+01:00'), '00:00');
});
