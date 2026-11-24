import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availabilityWindow, containsSlot, groupByMadridDay } from '../../src/features/booking-nubimed/agenda-hours.ts';

test('window starts today in Madrid and spans 91 days (to = from + 90)', () => {
	assert.deepEqual(availabilityWindow(new Date('2026-12-01T10:00:00Z')), {
		from: '2026-12-01',
		to: '2027-03-01',
	});
});

test('window: UTC evening that is already tomorrow in Madrid', () => {
	assert.deepEqual(availabilityWindow(new Date('2026-12-01T23:30:00Z')), {
		from: '2026-12-02',
		to: '2027-03-02',
	});
});

test('window: crossing DST end (last Sunday of October 2026)', () => {
	// 22:30Z on the 24th is 00:30 on the 25th in Madrid (CEST).
	assert.deepEqual(availabilityWindow(new Date('2026-10-24T22:30:00Z')), {
		from: '2026-10-25',
		to: '2027-01-23',
	});
});

test('window: crossing DST start (last Sunday of March 2026)', () => {
	// 23:30Z on the 28th is 00:30 on the 29th in Madrid (CET, before the 02:00 jump).
	assert.deepEqual(availabilityWindow(new Date('2026-03-28T23:30:00Z')), {
		from: '2026-03-29',
		to: '2026-06-27',
	});
});

test('window: year boundary', () => {
	assert.deepEqual(availabilityWindow(new Date('2026-12-31T12:00:00Z')), {
		from: '2026-12-31',
		to: '2027-03-31',
	});
});

const DAYS = groupByMadridDay(['2026-12-01T09:30:00+01:00', '2026-12-01T23:30:00+01:00', '2026-12-02T10:00:00+01:00']);

test('containsSlot: exact ISO present in its Madrid day', () => {
	assert.equal(containsSlot(DAYS, '2026-12-01T09:30:00+01:00'), true);
	assert.equal(containsSlot(DAYS, '2026-12-01T23:30:00+01:00'), true);
	assert.equal(containsSlot(DAYS, '2026-12-02T10:00:00+01:00'), true);
});

test('containsSlot: absent slot is false', () => {
	assert.equal(containsSlot(DAYS, '2026-12-01T10:30:00+01:00'), false);
	assert.equal(containsSlot(DAYS, '2026-12-05T09:30:00+01:00'), false);
	assert.equal(containsSlot({}, '2026-12-01T09:30:00+01:00'), false);
});

test('containsSlot: same instant in another zone or reformatted is false', () => {
	assert.equal(containsSlot(DAYS, '2026-12-01T08:30:00Z'), false);
	assert.equal(containsSlot(DAYS, '2026-12-01T08:30:00+00:00'), false);
	assert.equal(containsSlot(DAYS, '2026-12-01T09:30+01:00'), false);
	assert.equal(containsSlot(DAYS, '2026-12-01T09:30:00.000+01:00'), false);
});

test('containsSlot: garbage input is false', () => {
	assert.equal(containsSlot(DAYS, ''), false);
	assert.equal(containsSlot(DAYS, 'nope'), false);
	assert.equal(containsSlot(DAYS, '__proto__'), false);
});
