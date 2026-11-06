import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './helpers.mjs';

const { createDefaultFilterState, savedQueryToFilterState } = await load(
	'../../src/data/saved-query-adapter.ts',
);

test('defaults match the FilterState contract', () => {
	assert.deepEqual(createDefaultFilterState(), {
		name: '',
		project: '',
		subject: '',
		dateType: 'created',
		dateStart: '',
		dateEnd: '',
		datePreset: 'all',
		status: 'all',
		fileStatus: '',
		taskType: [],
		noteType: [],
		custom: {},
	});
});

test('overrides replace fields and custom is cloned', () => {
	const custom = { Score: '3' };
	const filters = createDefaultFilterState({
		name: 'x',
		status: 'completed',
		taskType: ['Input'],
		custom,
	});
	assert.equal(filters.name, 'x');
	assert.equal(filters.status, 'completed');
	assert.deepEqual(filters.taskType, ['Input']);
	assert.notEqual(filters.custom, custom);
	assert.deepEqual(filters.custom, { Score: '3' });

	filters.taskType.push('Output');
	assert.deepEqual(
		createDefaultFilterState({ taskType: ['Input'] }).taskType,
		['Input'],
	);
});

test('SavedQuery is adapted read-only, never mutated', () => {
	const query = {
		name: 'my query',
		filters: { name: 'abc', status: 'incomplete', custom: { A: 'b' } },
		sortOption: 'name',
		sortOrder: 'asc',
	};
	const snapshot = JSON.stringify(query);
	const filters = savedQueryToFilterState(query);
	assert.equal(filters.name, 'abc');
	assert.equal(filters.status, 'incomplete');
	assert.equal(filters.datePreset, 'all');
	assert.deepEqual(filters.custom, { A: 'b' });
	// SavedQuery 的 name/sort 不属于 FilterState（视图各自持有）。
	assert.ok(!('sortOption' in filters));
	assert.equal(JSON.stringify(query), snapshot);
	filters.custom.A = 'changed';
	assert.equal(query.filters.custom.A, 'b');
});
