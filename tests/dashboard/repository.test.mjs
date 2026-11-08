import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { DashboardRepository } = await load('../../src/dashboard/repository.ts');
const { DASHBOARD_SCHEMA_VERSION, DEFAULT_DASHBOARD_ID, activeDashboard } =
	await load('../../src/dashboard/types.ts');

function makeHost(initial = {}) {
	const data = structuredClone(initial);
	const host = {
		data,
		reads: 0,
		writes: 0,
		readData: async () => {
			host.reads++;
			return structuredClone(data);
		},
		updateData: async (mutate) => {
			host.writes++;
			mutate(data);
		},
	};
	return host;
}

function component(overrides = {}) {
	return {
		id: 'component:1',
		type: 'kpi',
		queryId: 'builtin:tasks-all',
		basis: 'file',
		w: 3,
		h: 2,
		...overrides,
	};
}

function query(overrides = {}) {
	return {
		id: 'user:1',
		name: 'My query',
		target: 'task',
		scope: { folders: [], includeSubfolders: true },
		filters: {},
		...overrides,
	};
}

test('load creates and persists the default store when the namespace is missing', async () => {
	const host = makeHost({ theme: 'dark' });
	const repository = new DashboardRepository(host);

	const result = await repository.load();

	assert.equal(result.damaged, false);
	assert.equal(result.store.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.equal(result.store.dashboards.length, 1);
	assert.equal(result.store.dashboards[0].id, DEFAULT_DASHBOARD_ID);
	assert.deepEqual(result.store.queries, []);
	assert.equal(host.writes, 1);
	assert.equal(host.data.theme, 'dark');
	assert.equal(host.data.dashboardStore.schemaVersion, DASHBOARD_SCHEMA_VERSION);
});

test('malformed store is reported as damaged and never overwritten', async () => {
	const host = makeHost({ dashboardStore: 'not-a-store' });
	const repository = new DashboardRepository(host);

	const result = await repository.load();

	assert.equal(result.damaged, true);
	assert.equal(result.store.dashboards[0].id, DEFAULT_DASHBOARD_ID);
	assert.equal(host.data.dashboardStore, 'not-a-store');
	assert.equal(host.writes, 0);
});

test('add / update / remove component round-trips through updateData', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	await repository.addComponent(DEFAULT_DASHBOARD_ID, component());
	let store = await repository.load();
	assert.equal(activeDashboard(store.store).components.length, 1);

	await repository.updateComponent(DEFAULT_DASHBOARD_ID, 'component:1', {
		basis: 'section',
		queryId: 'user:x',
	});
	store = await repository.load();
	assert.equal(activeDashboard(store.store).components[0].basis, 'section');
	assert.equal(activeDashboard(store.store).components[0].queryId, 'user:x');

	await repository.removeComponent(DEFAULT_DASHBOARD_ID, 'component:1');
	store = await repository.load();
	assert.equal(activeDashboard(store.store).components.length, 0);
});

test('component and query entries with broken shapes are dropped on load', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 2,
			dashboards: [
				{
					id: DEFAULT_DASHBOARD_ID,
					name: 'Mine',
					components: [component(), { id: 'no-type', queryId: 'q' }],
				},
			],
			queries: [query(), { id: 'broken', name: 'no-target' }],
		},
	});
	const repository = new DashboardRepository(host);

	const { store, damaged } = await repository.load();

	assert.equal(damaged, false);
	assert.deepEqual(
		activeDashboard(store).components.map((item) => item.id),
		['component:1'],
	);
	assert.deepEqual(store.queries.map((item) => item.id), ['user:1']);
});

test('query CRUD and reference counting', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();
	await repository.addComponent(DEFAULT_DASHBOARD_ID, component({ queryId: 'user:1' }));

	await repository.addQuery(query());
	let store = await repository.load();
	assert.equal(store.store.queries.length, 1);
	assert.equal(repository.referenceCount(store.store, 'user:1'), 1);

	await repository.updateQuery(query({ name: 'Renamed' }));
	store = await repository.load();
	assert.equal(store.store.queries[0].name, 'Renamed');

	await repository.deleteQuery('user:1');
	store = await repository.load();
	assert.deepEqual(store.store.queries, []);
	assert.equal(repository.referenceCount(store.store, 'user:1'), 1);
});

test('setActiveDashboard only accepts existing dashboards', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	let store = await repository.setActiveDashboard('dashboard:missing');
	assert.equal(store.activeDashboardId, DEFAULT_DASHBOARD_ID);

	store = await repository.setActiveDashboard('dashboard:second');
	assert.equal(store.activeDashboardId, DEFAULT_DASHBOARD_ID);
});

test('export / import round-trips normalised JSON', async () => {
	const repository = new DashboardRepository(makeHost());
	const original = {
		schemaVersion: DASHBOARD_SCHEMA_VERSION,
		dashboards: [
			{ id: DEFAULT_DASHBOARD_ID, name: 'Mine', components: [component()] },
		],
		activeDashboardId: DEFAULT_DASHBOARD_ID,
		queries: [query()],
	};

	const exported = repository.exportJson(original);
	const imported = repository.importJson(exported);

	assert.deepEqual(imported, original);
	assert.equal(repository.importJson('{ not json'), null);
	assert.equal(repository.importJson('null'), null);
});
