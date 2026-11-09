import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { DashboardRepository } = await load('../../src/dashboard/repository.ts');
const { DASHBOARD_SCHEMA_VERSION, DEFAULT_PAGE_ID, activePage } =
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

function page(overrides = {}) {
	return {
		id: 'page:1',
		name: 'Page 1',
		components: [],
		...overrides,
	};
}

test('load creates and persists the default store when the namespace is missing', async () => {
	const host = makeHost({ theme: 'dark' });
	const repository = new DashboardRepository(host);

	const result = await repository.load();

	assert.equal(result.damaged, false);
	assert.equal(result.store.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.equal(result.store.pages.length, 1);
	assert.equal(result.store.pages[0].id, DEFAULT_PAGE_ID);
	assert.equal(result.store.activePageId, DEFAULT_PAGE_ID);
	assert.deepEqual(result.store.queries, []);
	assert.equal(host.writes, 1);
	assert.equal(host.data.theme, 'dark');
	assert.equal(host.data.dashboardStore.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.deepEqual(host.data.dashboardStore.pages, result.store.pages);
	assert.equal(host.data.dashboardStore.dashboards, undefined);
});

test('malformed store is reported as damaged and never overwritten', async () => {
	const host = makeHost({ dashboardStore: 'not-a-store' });
	const repository = new DashboardRepository(host);

	const result = await repository.load();

	assert.equal(result.damaged, true);
	assert.equal(result.store.pages[0].id, DEFAULT_PAGE_ID);
	assert.equal(host.data.dashboardStore, 'not-a-store');
	assert.equal(host.writes, 0);
});

test('add / update / remove component round-trips through updateData', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	await repository.addComponent(DEFAULT_PAGE_ID, component());
	let store = await repository.load();
	assert.equal(activePage(store.store).components.length, 1);

	await repository.updateComponent(DEFAULT_PAGE_ID, 'component:1', {
		basis: 'section',
		queryId: 'user:x',
	});
	store = await repository.load();
	assert.equal(activePage(store.store).components[0].basis, 'section');
	assert.equal(activePage(store.store).components[0].queryId, 'user:x');

	await repository.removeComponent(DEFAULT_PAGE_ID, 'component:1');
	store = await repository.load();
	assert.equal(activePage(store.store).components.length, 0);
});

test('component and query entries with broken shapes are dropped on load', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 3,
			pages: [
				{
					id: DEFAULT_PAGE_ID,
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
		activePage(store).components.map((item) => item.id),
		['component:1'],
	);
	assert.deepEqual(store.queries.map((item) => item.id), ['user:1']);
});

test('query CRUD and reference counting', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();
	await repository.addComponent(DEFAULT_PAGE_ID, component({ queryId: 'user:1' }));

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

test('setActivePage only accepts existing pages', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	let store = await repository.setActivePage('page:missing');
	assert.equal(store.activePageId, DEFAULT_PAGE_ID);

	store = await repository.setActivePage('page:second');
	assert.equal(store.activePageId, DEFAULT_PAGE_ID);
});

test('export / import round-trips normalised JSON', async () => {
	const repository = new DashboardRepository(makeHost());
	const original = {
		schemaVersion: DASHBOARD_SCHEMA_VERSION,
		pages: [{ id: DEFAULT_PAGE_ID, name: 'Mine', components: [component()] }],
		activePageId: DEFAULT_PAGE_ID,
		queries: [query()],
	};

	const exported = repository.exportJson(original);
	const imported = repository.importJson(exported);

	assert.deepEqual(imported, original);
	assert.equal(repository.importJson('{ not json'), null);
	assert.equal(repository.importJson('null'), null);
});

test('v2 dashboards migrate to v3 pages in memory, keeping ids', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 2,
			dashboards: [
				{
					id: 'dashboard:default',
					name: 'My Dashboard',
					components: [component()],
				},
			],
			activeDashboardId: 'dashboard:default',
			queries: [query()],
		},
	});
	const repository = new DashboardRepository(host);

	const { store, damaged } = await repository.load();

	assert.equal(damaged, false);
	assert.equal(store.schemaVersion, 3);
	assert.equal(store.pages.length, 1);
	assert.equal(store.pages[0].id, 'dashboard:default');
	assert.equal(store.pages[0].name, 'My Dashboard');
	assert.equal(store.pages[0].components.length, 1);
	assert.equal(store.activePageId, 'dashboard:default');
	assert.deepEqual(store.queries.map((item) => item.id), ['user:1']);
	assert.equal(host.writes, 0);
});

test('v2 migration is read-only and idempotent', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 2,
			dashboards: [{ id: 'dashboard:default', name: 'Mine', components: [] }],
			activeDashboardId: 'dashboard:default',
			queries: [],
		},
	});
	const repository = new DashboardRepository(host);

	const first = await repository.load();
	const second = await repository.load();

	assert.equal(host.writes, 0);
	assert.deepEqual(second.store, first.store);
	assert.equal(host.data.dashboardStore.schemaVersion, 2);
});

test('v3 pages win over a leftover v2 dashboards array', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 3,
			pages: [{ id: 'page:new', name: 'New', components: [] }],
			dashboards: [{ id: 'dashboard:old', name: 'Old', components: [] }],
			activePageId: 'page:new',
		},
	});
	const repository = new DashboardRepository(host);

	const { store } = await repository.load();

	assert.deepEqual(store.pages.map((item) => item.id), ['page:new']);
});

test('empty pages fall back to a single default page', async () => {
	const repository = new DashboardRepository(
		makeHost({ dashboardStore: { schemaVersion: 3, pages: [], queries: [] } }),
	);

	const { store } = await repository.load();

	assert.equal(store.pages.length, 1);
	assert.equal(store.pages[0].id, DEFAULT_PAGE_ID);
	assert.equal(store.activePageId, DEFAULT_PAGE_ID);
});

test('an unknown activePageId falls back to the first page', async () => {
	const repository = new DashboardRepository(
		makeHost({
			dashboardStore: {
				schemaVersion: 3,
				pages: [
					{ id: 'page:a', name: 'A', components: [] },
					{ id: 'page:b', name: 'B', components: [] },
				],
				activePageId: 'missing',
				queries: [],
			},
		}),
	);

	const { store } = await repository.load();

	assert.equal(store.activePageId, 'page:a');
});

test('page CRUD: add appends in order, rename updates, remove deletes', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	await repository.addPage(page({ id: 'page:a', name: 'A' }));
	await repository.addPage(page({ id: 'page:b', name: 'B' }));
	let store = await repository.load();
	assert.deepEqual(store.store.pages.map((item) => item.id), [
		DEFAULT_PAGE_ID,
		'page:a',
		'page:b',
	]);

	await repository.addPage(page({ id: 'page:a', name: 'duplicate' }));
	store = await repository.load();
	assert.deepEqual(store.store.pages.map((item) => item.id), [
		DEFAULT_PAGE_ID,
		'page:a',
		'page:b',
	]);
	assert.equal(store.store.pages[1].name, 'A');

	await repository.renamePage('page:a', '  Renamed  ');
	store = await repository.load();
	assert.equal(store.store.pages[1].name, 'Renamed');

	await repository.renamePage('page:a', '   ');
	store = await repository.load();
	assert.equal(store.store.pages[1].name, 'Renamed');

	await repository.removePage('page:b');
	store = await repository.load();
	assert.deepEqual(store.store.pages.map((item) => item.id), [
		DEFAULT_PAGE_ID,
		'page:a',
	]);
});

test('the last page is never removed', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	const store = await repository.removePage(DEFAULT_PAGE_ID);

	assert.equal(store.pages.length, 1);
	assert.equal(store.pages[0].id, DEFAULT_PAGE_ID);
});

test('removing the active page falls back to the first remaining page', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 3,
			pages: [
				{ id: 'page:a', name: 'A', components: [] },
				{ id: 'page:b', name: 'B', components: [] },
			],
			activePageId: 'page:a',
			queries: [],
		},
	});
	const repository = new DashboardRepository(host);

	const store = await repository.removePage('page:a');

	assert.deepEqual(store.pages.map((item) => item.id), ['page:b']);
	assert.equal(store.activePageId, 'page:b');
});

test('components and queries stay isolated per page', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 3,
			pages: [
				{ id: 'page:a', name: 'A', components: [] },
				{ id: 'page:b', name: 'B', components: [] },
			],
			activePageId: 'page:a',
			queries: [],
		},
	});
	const repository = new DashboardRepository(host);

	await repository.addComponent('page:a', component({ id: 'component:a' }));
	await repository.addComponent('page:b', component({ id: 'component:b' }));
	let store = await repository.load();
	const pages = Object.fromEntries(
		store.store.pages.map((item) => [item.id, item.components.map((c) => c.id)]),
	);
	assert.deepEqual(pages, {
		'page:a': ['component:a'],
		'page:b': ['component:b'],
	});

	await repository.updateComponent('page:b', 'component:b', { basis: 'section' });
	store = await repository.load();
	assert.equal(store.store.pages[0].components[0].basis, 'file');
	assert.equal(store.store.pages[1].components[0].basis, 'section');

	await repository.removeComponent('page:a', 'component:a');
	store = await repository.load();
	assert.equal(store.store.pages[0].components.length, 0);
	assert.equal(store.store.pages[1].components.length, 1);
});

test('reference counts span pages and survive page deletion', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 3,
			pages: [
				{
					id: 'page:a',
					name: 'A',
					components: [component({ id: 'component:a', queryId: 'user:1' })],
				},
				{
					id: 'page:b',
					name: 'B',
					components: [component({ id: 'component:b', queryId: 'user:1' })],
				},
			],
			activePageId: 'page:a',
			queries: [query()],
		},
	});
	const repository = new DashboardRepository(host);
	let { store } = await repository.load();
	assert.equal(repository.referenceCount(store, 'user:1'), 2);

	store = await repository.removePage('page:b');
	assert.equal(repository.referenceCount(store, 'user:1'), 1);
	assert.deepEqual(store.queries.map((item) => item.id), ['user:1']);
});

test('importing v2 JSON upgrades it to the v3 shape', async () => {
	const repository = new DashboardRepository(makeHost());
	const v2 = JSON.stringify({
		schemaVersion: 2,
		dashboards: [
			{ id: 'dashboard:default', name: 'Mine', components: [component()] },
		],
		activeDashboardId: 'dashboard:default',
		queries: [query()],
	});

	const imported = repository.importJson(v2);

	assert.equal(imported.schemaVersion, 3);
	assert.equal(imported.pages[0].id, 'dashboard:default');
	assert.equal(imported.activePageId, 'dashboard:default');
	assert.deepEqual(imported.queries, [query()]);
});

test('moveComponent reorders within a page and clamps the target index', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 3,
			pages: [
				{
					id: DEFAULT_PAGE_ID,
					name: 'Page 1',
					components: ['a', 'b', 'c'].map((id) =>
						component({ id: `component:${id}` }),
					),
				},
			],
			activePageId: DEFAULT_PAGE_ID,
			queries: [],
		},
	});
	const repository = new DashboardRepository(host);

	const ids = async () =>
		(await repository.load()).store.pages[0].components.map((item) => item.id);

	await repository.moveComponent(DEFAULT_PAGE_ID, 'component:a', 2);
	assert.deepEqual(await ids(), [
		'component:b',
		'component:c',
		'component:a',
	]);

	await repository.moveComponent(DEFAULT_PAGE_ID, 'component:a', 0);
	assert.deepEqual(await ids(), [
		'component:a',
		'component:b',
		'component:c',
	]);

	await repository.moveComponent(DEFAULT_PAGE_ID, 'component:a', 99);
	assert.deepEqual(await ids(), [
		'component:b',
		'component:c',
		'component:a',
	]);

	await repository.moveComponent(DEFAULT_PAGE_ID, 'component:b', -5);
	assert.deepEqual(await ids(), [
		'component:b',
		'component:c',
		'component:a',
	]);
});

test('moveComponent keeps the store intact for unknown ids but still writes once', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 3,
			pages: [
				{
					id: DEFAULT_PAGE_ID,
					name: 'Page 1',
					components: [component({ id: 'component:a' })],
				},
			],
			activePageId: DEFAULT_PAGE_ID,
			queries: [],
		},
	});
	const repository = new DashboardRepository(host);
	const writesBefore = host.writes;

	await repository.moveComponent(DEFAULT_PAGE_ID, 'component:missing', 0);
	await repository.moveComponent('page:missing', 'component:a', 0);

	const { store } = await repository.load();
	assert.deepEqual(
		store.pages[0].components.map((item) => item.id),
		['component:a'],
	);
	assert.equal(host.writes, writesBefore + 2);
});

