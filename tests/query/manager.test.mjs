import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { QUERY_TARGETS } = await load('../../src/query/types.ts');
const {
	firstQueryOfTarget,
	groupByTarget,
	querySourceOf,
	resolveQueryPicker,
} = await load('../../src/query/manager.ts');
const { queryDisplayName } = await load('../../src/ui/query-labels.ts');

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

test('queryDisplayName prefers nameKey over name', () => {
	const translated = {
		...query('builtin:tasks-all', 'task'),
		name: 'raw',
		nameKey: 'QUERY_BUILTIN_TASKS_ALL',
	};

	assert.equal(queryDisplayName(translated), 'All tasks');
	assert.equal(queryDisplayName(query('user:1', 'task')), 'user:1');
});

test('firstQueryOfTarget returns undefined for an empty bucket', () => {
	assert.equal(firstQueryOfTarget([query('user:1', 'task')], 'file'), undefined);
	assert.equal(firstQueryOfTarget([], 'task'), undefined);
});

test('firstQueryOfTarget keeps repository order inside the bucket', () => {
	const queries = [
		query('user:1', 'note'),
		query('user:2', 'task'),
		query('user:3', 'task'),
	];

	assert.equal(firstQueryOfTarget(queries, 'task').id, 'user:2');
	assert.equal(firstQueryOfTarget(queries, 'note').id, 'user:1');
});

test('resolveQueryPicker keeps single-type components single-layer', () => {
	const state = resolveQueryPicker(
		['task'],
		[query('user:1', 'task'), query('user:2', 'note')],
		'user:1',
		null,
	);

	assert.equal(state.needsTypeSelect, false);
	assert.deepEqual(state.targets, ['task']);
	assert.equal(state.activeTarget, 'task');
	assert.equal(state.legacy, false);
	assert.equal(state.missing, false);
	assert.equal(state.current.id, 'user:1');
});

test('resolveQueryPicker sorts multi-type buckets by QUERY_TARGETS', () => {
	const state = resolveQueryPicker(
		['note', 'task', 'file'],
		[query('user:1', 'task')],
		'user:1',
		null,
	);

	assert.equal(state.needsTypeSelect, true);
	assert.deepEqual(state.targets, ['task', 'note', 'file']);
	assert.equal(state.activeTarget, 'task');
});

test('resolveQueryPicker derives the active bucket from the current value', () => {
	const state = resolveQueryPicker(
		['task', 'note'],
		[query('user:1', 'task'), query('user:2', 'note')],
		'user:2',
		null,
	);

	assert.equal(state.activeTarget, 'note');
});

test('resolveQueryPicker flags values outside the allowed types', () => {
	const state = resolveQueryPicker(
		['task'],
		[query('user:1', 'task'), query('user:2', 'note')],
		'user:2',
		null,
	);

	assert.equal(state.legacy, true);
	assert.equal(state.missing, false);
	assert.deepEqual(state.targets, ['task', 'note']);
	assert.equal(state.activeTarget, 'note');
});

test('resolveQueryPicker does not duplicate a legacy bucket already allowed', () => {
	const state = resolveQueryPicker(
		['task', 'note'],
		[query('user:1', 'task')],
		'ghost:1',
		null,
	);

	assert.equal(state.legacy, false);
	assert.equal(state.missing, true);
	assert.deepEqual(state.targets, ['task', 'note']);
});

test('resolveQueryPicker falls back to the first non-empty bucket when the id is gone', () => {
	const state = resolveQueryPicker(
		['task', 'note', 'file'],
		[query('user:1', 'note')],
		'deleted:1',
		null,
	);

	assert.equal(state.missing, true);
	assert.equal(state.current, undefined);
	assert.equal(state.activeTarget, 'note');
});

test('resolveQueryPicker honours a remembered bucket when it is selectable', () => {
	const state = resolveQueryPicker(
		['task', 'note'],
		[query('user:1', 'task'), query('user:2', 'note')],
		'user:1',
		'note',
	);

	assert.equal(state.activeTarget, 'task');

	const missing = resolveQueryPicker(
		['task', 'note'],
		[query('user:2', 'note')],
		'deleted:1',
		'note',
	);
	assert.equal(missing.activeTarget, 'note');
});

test('resolveQueryPicker ignores an unusable remembered bucket', () => {
	const state = resolveQueryPicker(
		['task', 'note'],
		[query('user:1', 'task')],
		'deleted:1',
		'file',
	);

	assert.equal(state.activeTarget, 'task');
});

test('resolveQueryPicker keeps empty buckets in targets so the UI can disable them', () => {
	const state = resolveQueryPicker(
		['task', 'file'],
		[query('user:1', 'task')],
		'user:1',
		null,
	);

	assert.deepEqual(state.targets, ['task', 'file']);
	assert.equal(state.groups.file.length, 0);
});

test('resolveQueryPicker falls back to all four buckets when nothing is allowed', () => {
	const state = resolveQueryPicker([], [query('user:1', 'folder')], 'user:1', null);

	assert.deepEqual(state.targets, [...QUERY_TARGETS]);
	assert.equal(state.activeTarget, 'folder');
	assert.equal(state.needsTypeSelect, true);
	assert.equal(state.legacy, false);
});
