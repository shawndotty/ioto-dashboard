import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { datasetKey } = await load('../../src/dashboard/dataset/types.ts');

const BASE = {
	object: 'task',
	measure: 'count',
	queryId: 'builtin:tasks-all',
};

test('identical requests share a dataset key', () => {
	assert.equal(datasetKey(BASE), datasetKey({ ...BASE }));
});

test('each request field participates in the key', () => {
	const keys = new Set([
		datasetKey(BASE),
		datasetKey({ ...BASE, object: 'note' }),
		datasetKey({ ...BASE, measure: 'ratio' }),
		datasetKey({ ...BASE, queryId: 'user:1' }),
		datasetKey({ ...BASE, basis: 'section' }),
		datasetKey({ ...BASE, groupBy: 'project' }),
		datasetKey({ ...BASE, limit: 10 }),
		datasetKey({ ...BASE, range: 30 }),
		datasetKey({
			...BASE,
			measure: 'timeline',
			timeline: { bucket: 'day', dateField: 'auto' },
		}),
		datasetKey({
			...BASE,
			measure: 'timeline',
			timeline: { bucket: 'week', dateField: 'auto' },
		}),
		datasetKey({
			...BASE,
			measure: 'timeline',
			timeline: { bucket: 'day', dateField: 'created' },
		}),
	]);
	assert.equal(keys.size, 11);
});

test('timeline options only participate when present', () => {
	assert.equal(
		datasetKey(BASE),
		datasetKey({ ...BASE, timeline: undefined }),
	);
	assert.notEqual(
		datasetKey({
			...BASE,
			timeline: { bucket: 'day', dateField: 'auto' },
		}),
		datasetKey(BASE),
	);
});

test('omitted and explicit optional values stay distinguishable', () => {
	assert.notEqual(
		datasetKey(BASE),
		datasetKey({ ...BASE, limit: 0 }),
	);
	assert.equal(
		datasetKey(BASE),
		datasetKey({ ...BASE, limit: undefined, range: undefined }),
	);
});
