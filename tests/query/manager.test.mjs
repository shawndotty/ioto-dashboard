import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { QUERY_TARGETS } = await load('../../src/query/types.ts');
const { groupByTarget, querySourceOf } = await load('../../src/query/manager.ts');

function query(id, target) {
	return {
		id,
		name: id,
		target,
		scope: { folders: [], includeSubfolders: true },
		filters: {},
	};
}

test('QUERY_TARGETS keeps the frozen display order', () => {
	assert.deepEqual([...QUERY_TARGETS], ['task', 'note', 'file', 'folder']);
});

test('groupByTarget keeps repository order inside each bucket', () => {
	const queries = [
		query('builtin:tasks-all', 'task'),
		query('saved:1', 'note'),
		query('user:2', 'file'),
		query('builtin:tasks-unfinished', 'task'),
		query('user:3', 'task'),
		query('user:4', 'folder'),
	];

	const groups = groupByTarget(queries);

	assert.deepEqual(Object.keys(groups), ['task', 'note', 'file', 'folder']);
	assert.deepEqual(
		groups.task.map((item) => item.id),
		['builtin:tasks-all', 'builtin:tasks-unfinished', 'user:3'],
	);
	assert.deepEqual(groups.note.map((item) => item.id), ['saved:1']);
	assert.deepEqual(groups.file.map((item) => item.id), ['user:2']);
	assert.deepEqual(groups.folder.map((item) => item.id), ['user:4']);
});

test('groupByTarget returns four empty buckets for an empty list', () => {
	const groups = groupByTarget([]);

	for (const target of QUERY_TARGETS) {
		assert.ok(Array.isArray(groups[target]));
		assert.equal(groups[target].length, 0);
	}
});

test('groupByTarget does not mutate the input list', () => {
	const queries = [query('user:1', 'task'), query('user:2', 'note')];
	const snapshot = [...queries];

	groupByTarget(queries);

	assert.deepEqual(queries, snapshot);
});

test('querySourceOf maps every known id prefix', () => {
	assert.equal(querySourceOf('builtin:tasks-all'), 'builtin');
	assert.equal(querySourceOf('saved:42'), 'saved');
	assert.equal(querySourceOf('user:1762676400000'), 'user');
});

test('querySourceOf ignores unknown or missing prefixes', () => {
	assert.equal(querySourceOf('legacy-42'), null);
	assert.equal(querySourceOf(''), null);
	assert.equal(querySourceOf('Builtin:task'), null);
});
