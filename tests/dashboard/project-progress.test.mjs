import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	projectProgressComponent,
	percentText,
	displayRatio,
	visibleGroups,
	arrangeGroups,
} = await load('../../src/dashboard/components/project-progress.ts');

function bucket(overrides = {}) {
	return {
		total: 0,
		completed: 0,
		open: 0,
		cancelled: 0,
		other: 0,
		ratio: null,
		...overrides,
	};
}

function group(name, bucketOverrides = {}, overrides = {}) {
	const value = bucket(bucketOverrides);
	return {
		key: name,
		name,
		folder: `3-任务/${name}`,
		fileCount: 0,
		bucket: value,
		...overrides,
	};
}

function config(options = {}, extra = {}) {
	return {
		id: 'c1',
		type: 'project-progress',
		queryId: 'builtin:tasks-all',
		options,
		...extra,
	};
}

function result(groups) {
	return { key: 'k', kind: 'project-progress', basis: 'file', groups };
}

test('percentText never rounds an unfinished project up to 100%', () => {
	assert.equal(percentText(null), '—');
	assert.equal(percentText(0.995), '99.5%');
	assert.equal(percentText(1 / 3), '33.3%');
	assert.equal(percentText(0.999), '99.9%');
	assert.equal(percentText(1), '100%');
	assert.equal(percentText(0), '0%');
});

test('visibleGroups hides empty projects and can hide the unclassified row', () => {
	const groups = [
		group('Alpha', { total: 3, ratio: 1 / 3 }),
		group('Empty', {}),
		group('', { total: 2, ratio: 0 }, { nameKey: 'QUERY_UNCLASSIFIED' }),
	];

	assert.deepEqual(
		visibleGroups(result(groups)).map((item) => item.name),
		['Alpha', ''],
	);
	assert.deepEqual(
		visibleGroups(result(groups), config({ showEmptyProjects: true })).map(
			(item) => item.name,
		),
		['Alpha', 'Empty', ''],
	);
	assert.deepEqual(
		visibleGroups(result(groups), config({ showUnclassified: false })).map(
			(item) => item.name,
		),
		['Alpha'],
	);
});

test('displayRatio switches the denominator away from cancelled tasks', () => {
	const mixed = bucket({ total: 10, completed: 5, cancelled: 5, ratio: 0.5 });
	assert.equal(displayRatio(mixed, 'all'), 0.5);
	assert.equal(displayRatio(mixed, 'excludeCancelled'), 1);
	assert.equal(displayRatio(mixed, undefined), 0.5);

	const allCancelled = bucket({ total: 5, cancelled: 5, ratio: 0 });
	assert.equal(displayRatio(allCancelled, 'excludeCancelled'), null);
});

test('arrangeGroups sorts by name, ratio and open count, then limits', () => {
	const groups = [
		group('Alpha', { total: 4, completed: 1, open: 2, ratio: 0.25 }),
		group('Beta', { total: 2, completed: 2, ratio: 1 }),
		group('Gamma', { total: 3, completed: 1, open: 1, ratio: 1 / 3 }),
		group('Empty', {}),
	];
	const data = result(groups);

	assert.deepEqual(
		arrangeGroups(data, config()).map((item) => item.name),
		['Alpha', 'Beta', 'Gamma'],
	);
	assert.deepEqual(
		arrangeGroups(data, config({ sort: 'ratio' })).map((item) => item.name),
		['Beta', 'Gamma', 'Alpha'],
	);
	assert.deepEqual(
		arrangeGroups(data, config({ sort: 'open' })).map((item) => item.name),
		['Alpha', 'Gamma', 'Beta'],
	);
	assert.deepEqual(
		arrangeGroups(data, config({ sort: 'open' }, { limit: 2 })).map(
			(item) => item.name,
		),
		['Alpha', 'Gamma'],
	);
	assert.equal(arrangeGroups(data, config({}, { limit: 0 })).length, 3);
});

test('arrangeGroups falls back to the file denominator for sorting', () => {
	const groups = [
		group('Half', { total: 10, completed: 5, cancelled: 5, ratio: 0.5 }),
		group('Third', { total: 3, completed: 1, ratio: 1 / 3 }),
	];
	const sorted = arrangeGroups(
		result(groups),
		config({ sort: 'ratio', ratioBase: 'excludeCancelled' }),
	);
	assert.deepEqual(
		sorted.map((item) => item.name),
		['Half', 'Third'],
	);
});

test('toMetricRequest only passes task queries through', () => {
	const taskQuery = {
		id: 'user:tasks',
		name: 'tasks',
		target: 'task',
		scope: { folders: [], includeSubfolders: true },
		filters: {},
	};
	const noteQuery = {
		id: 'user:notes',
		name: 'notes',
		target: 'note',
		scope: { folders: [], includeSubfolders: true },
		filters: {},
	};
	const withQuery = (query, extra = {}) =>
		projectProgressComponent.toMetricRequest(
			config({}, { queryId: query.id, ...extra }),
			query,
		);

	assert.equal(withQuery(taskQuery).queryId, 'user:tasks');
	assert.equal(withQuery(noteQuery).queryId, 'builtin:tasks-all');
	assert.equal(withQuery(taskQuery).basis, 'file');
	assert.equal(withQuery(taskQuery, { basis: 'section' }).basis, 'section');
});

test('isEmpty follows the filtered view so empty projects do not show', () => {
	const data = result([group('Alpha', {}), group('Beta', {})]);

	assert.equal(projectProgressComponent.isEmpty(data), true);
	assert.equal(
		projectProgressComponent.isEmpty(data, config({ showEmptyProjects: true })),
		false,
	);
	assert.equal(
		projectProgressComponent.isEmpty(
			result([group('Alpha', { total: 1, open: 1, ratio: 0 })]),
		),
		false,
	);
});
