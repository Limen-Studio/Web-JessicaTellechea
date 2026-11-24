import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as catalog from '../../src/features/booking-nubimed/catalog.ts';

const { resolveBookingTarget } = catalog;

const CASES: Array<[3 | 386, 'barcelona' | 'el-vendrell', 'firstVisit' | 'treatments', number, number]> = [
	[3, 'barcelona', 'firstVisit', 29537, 389741],
	[3, 'barcelona', 'treatments', 29537, 389745],
	[3, 'el-vendrell', 'firstVisit', 26912, 389742],
	[3, 'el-vendrell', 'treatments', 26912, 389746],
	[386, 'barcelona', 'firstVisit', 29537, 389743],
	[386, 'barcelona', 'treatments', 29537, 389747],
	[386, 'el-vendrell', 'firstVisit', 26912, 389744],
	[386, 'el-vendrell', 'treatments', 26912, 389748],
];

for (const [s, c, k, agendaId, serviceId] of CASES) {
	test(`resolves ${s}/${c}/${k}`, () => {
		assert.deepEqual(resolveBookingTarget(s, c, k), {
			specialtyId: s,
			centro: c,
			kind: k,
			agendaId,
			serviceId,
		});
	});
}

test('specialty must be the numeric id (strings are the query parser job)', () => {
	assert.equal(resolveBookingTarget('3', 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget('386', 'el-vendrell', 'treatments'), null);
});

test('rejects unknown centro, specialty and kind', () => {
	assert.equal(resolveBookingTarget(3, 'madrid', 'firstVisit'), null);
	assert.equal(resolveBookingTarget(4, 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget(5, 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget(3, 'barcelona', 'other'), null);
});

test('rejects non-canonical specialty strings and bad types', () => {
	assert.equal(resolveBookingTarget('03', 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget('3.0', 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget(' 3', 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget('', 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget(undefined, undefined, undefined), null);
	assert.equal(resolveBookingTarget(null, 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget({}, 'barcelona', 'firstVisit'), null);
	assert.equal(resolveBookingTarget(3, 123, 'firstVisit'), null);
	assert.equal(resolveBookingTarget(3, 'barcelona', 5), null);
	assert.equal(resolveBookingTarget(3, '__proto__', 'firstVisit'), null);
	assert.equal(resolveBookingTarget(3, 'barcelona', 'constructor'), null);
});

test('catalog does not expose area ids or non-bookable specialty ids', () => {
	const dump = JSON.stringify({
		AGENDA_BY_CENTRO: catalog.AGENDA_BY_CENTRO,
		SERVICE_IDS: catalog.SERVICE_IDS,
	});
	assert.ok(!/area/i.test(dump));
	assert.ok(!dump.includes('244529'));
	assert.deepEqual(Object.keys(catalog.SERVICE_IDS).sort(), ['3', '386']);
	assert.equal(catalog.MODALITY, 'presencial');
	assert.ok(!('areaId' in (resolveBookingTarget(3, 'barcelona', 'firstVisit') ?? {})));
});
