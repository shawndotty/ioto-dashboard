import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { chartEmptyKey } = await load('../../src/dashboard/dataset/charts/chart-host.ts');

test('chart empty state distinguishes "no rows" from "rows without values"', () => {
	assert.equal(chartEmptyKey(false), 'DASHBOARD_NO_SNAPSHOT');
	assert.equal(chartEmptyKey(true), 'DASHBOARD_CHART_NO_VALUES');
});
