import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { metricKey } = await load('../../src/metrics/types.ts');

test('identical requests share a key', () => {
	const request = {
		kind: 'task-count',
		queryId: 'builtin:tasks-all',
		basis: 'file',
		limit: 20,
	};
	assert.equal(metricKey(request), metricKey({ ...request }));
});

test('each request field participates in the key', () => {
	const base = { kind: 'task-count', queryId: 'q', basis: 'file' };
	const keys = new Set([
		metricKey(base),
		metricKey({ ...base, kind: 'note-count' }),
		metricKey({ ...base, queryId: 'other' }),
		metricKey({ ...base, basis: 'section' }),
		metricKey({ ...base, groupBy: 'project' }),
		metricKey({ ...base, limit: 20 }),
		metricKey({ ...base, limit: 21 }),
	]);
	assert.equal(keys.size, 7);
});

test('omitted optional fields stay distinct from explicit values', () => {
	assert.notEqual(
		metricKey({ kind: 'unfinished-tasks', queryId: 'q' }),
		metricKey({ kind: 'unfinished-tasks', queryId: 'q', limit: 0 }),
	);
	assert.equal(
		metricKey({ kind: 'unfinished-tasks', queryId: 'q' }),
		metricKey({ kind: 'unfinished-tasks', queryId: 'q', limit: undefined }),
	);
});

test('the measure participates in the metric key', () => {
	const base = { kind: 'task-count', queryId: 'q', basis: 'file' };
	assert.notEqual(metricKey(base), metricKey({ ...base, measure: 'completed' }));
	assert.notEqual(
		metricKey({ ...base, measure: 'completed' }),
		metricKey({ ...base, measure: 'open' }),
	);
	assert.notEqual(
		metricKey(base),
		metricKey({ ...base, measure: 'count' }),
	);
	assert.equal(
		metricKey(base),
		metricKey({ ...base, measure: undefined }),
	);
});
