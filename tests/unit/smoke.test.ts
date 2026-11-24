import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDaysYmd, effectiveHorizonDays } from '../../src/features/booking-nubimed/horizon.ts';

test('runner starts and imports a pure module with .ts extension', () => {
	assert.equal(addDaysYmd('2026-12-01', 90), '2027-03-01');
	assert.equal(effectiveHorizonDays(91), 91);
});
