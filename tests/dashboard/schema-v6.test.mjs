import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { DashboardRepository } = await load('../../src/dashboard/repository.ts');
const { DASHBOARD_SCHEMA_VERSION } = await load('../../src/dashboard/types.ts');

function repository() {
	return new DashboardRepository({
		readData: async () => ({}),
		updateData: async () => {},
	});
}

function store(components, schemaVersion = 6) {
	return JSON.stringify({
		schemaVersion,
		dashboards: [
			{
				id: 'dashboard:1',
				name: 'Dash',
				pages: [{ id: 'page:1', name: 'Page', components }],
			},
		],
		activeDashboardId: 'dashboard:1',
		queries: [],
	});
}

function kpi(id, overrides = {}) {
	return { id, type: 'kpi', queryId: 'builtin:tasks-all', ...overrides };
}

function container(id, children, overrides = {}) {
	return { id, type: 'container', queryId: '', children, ...overrides };
}

test('v5 data loads as the current schema and keeps no children', () => {
	const imported = repository().importJson(store([kpi('component:1')], 5));
	assert.equal(imported.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.equal(imported.schemaVersion, 7);
	assert.equal('children' in imported.dashboards[0].pages[0].components[0], false);
});

test('v6 data keeps one level of children and drops grandchildren', () => {
	const imported = repository().importJson(
		store([
			container('component:box', [
				kpi('component:a'),
				container('component:inner', [kpi('component:deep')]),
			]),
		]),
	);
	const box = imported.dashboards[0].pages[0].components[0];
	assert.equal(box.type, 'container');
	assert.deepEqual(
		box.children.map((child) => child.id),
		['component:a', 'component:inner'],
	);
	assert.equal(box.children[1].children, undefined);
});

test('invalid children are filtered and unknown child keys are dropped', () => {
	const imported = repository().importJson(
		store([
			container('component:box', [
				kpi('component:a', { unknownField: 'gone' }),
				{ id: 'component:bad', type: 'kpi' },
				'not-a-component',
			]),
		]),
	);
	const box = imported.dashboards[0].pages[0].components[0];
	assert.deepEqual(box.children.map((child) => child.id), ['component:a']);
	assert.equal(box.children[0].unknownField, undefined);
});

test('a container with no valid children keeps no children key', () => {
	const imported = repository().importJson(
		store([container('component:box', ['nope'])]),
	);
	const box = imported.dashboards[0].pages[0].components[0];
	assert.equal('children' in box, false);
});
