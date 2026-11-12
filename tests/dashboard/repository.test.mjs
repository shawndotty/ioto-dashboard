import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { DashboardRepository } = await load('../../src/dashboard/repository.ts');
const {
	DASHBOARD_SCHEMA_VERSION,
	DEFAULT_DASHBOARD_ID,
	DEFAULT_PAGE_ID,
	activeDashboard,
	activePageOf,
	findDashboardForPage,
} = await load('../../src/dashboard/types.ts');

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

function dashboard(overrides = {}) {
	return {
		id: 'dashboard:1',
		name: 'Dash 1',
		pages: [page()],
		...overrides,
	};
}

function currentPage(store) {
	return activePageOf(activeDashboard(store));
}

function v4(host, dashboards, extra = {}) {
	return makeHost({
		...host,
		dashboardStore: {
			schemaVersion: 4,
			dashboards,
			activeDashboardId: dashboards[0]?.id,
			queries: [],
			...extra,
		},
	});
}

test('load creates and persists the default v4 store when the namespace is missing', async () => {
	const host = makeHost({ theme: 'dark' });
	const repository = new DashboardRepository(host);

	const result = await repository.load();

	assert.equal(result.damaged, false);
	assert.equal(result.store.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.equal(result.store.dashboards.length, 1);
	assert.equal(result.store.dashboards[0].id, DEFAULT_DASHBOARD_ID);
	assert.equal(result.store.activeDashboardId, DEFAULT_DASHBOARD_ID);
	assert.equal(result.store.dashboards[0].pages.length, 1);
	assert.equal(result.store.dashboards[0].pages[0].id, DEFAULT_PAGE_ID);
	assert.equal(result.store.dashboards[0].lastPageId, DEFAULT_PAGE_ID);
	assert.deepEqual(result.store.queries, []);
	assert.equal(host.writes, 1);
	assert.equal(host.data.theme, 'dark');
	assert.equal(
		host.data.dashboardStore.schemaVersion,
		DASHBOARD_SCHEMA_VERSION,
	);
	assert.deepEqual(host.data.dashboardStore.dashboards, result.store.dashboards);
	assert.equal(host.data.dashboardStore.pages, undefined);
});

test('the default dashboard name can be localised by the caller', async () => {
	const repository = new DashboardRepository(makeHost(), {
		defaultDashboardName: () => '工作台 1',
	});

	const { store } = await repository.load();

	assert.equal(store.dashboards[0].name, '工作台 1');
});

test('malformed store is reported as damaged and never overwritten', async () => {
	const host = makeHost({ dashboardStore: 'not-a-store' });
	const repository = new DashboardRepository(host);

	const result = await repository.load();

	assert.equal(result.damaged, true);
	assert.equal(result.store.dashboards[0].pages[0].id, DEFAULT_PAGE_ID);
	assert.equal(host.data.dashboardStore, 'not-a-store');
	assert.equal(host.writes, 0);
});

test('add / update / remove component round-trips through updateData', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	await repository.addComponent(DEFAULT_PAGE_ID, component());
	let store = await repository.load();
	assert.equal(currentPage(store.store).components.length, 1);

	await repository.updateComponent(DEFAULT_PAGE_ID, 'component:1', {
		basis: 'section',
		queryId: 'user:x',
	});
	store = await repository.load();
	assert.equal(currentPage(store.store).components[0].basis, 'section');
	assert.equal(currentPage(store.store).components[0].queryId, 'user:x');

	await repository.removeComponent(DEFAULT_PAGE_ID, 'component:1');
	store = await repository.load();
	assert.equal(currentPage(store.store).components.length, 0);
});

test('an undefined patch value removes that component key (cleared title)', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	await repository.addComponent(
		DEFAULT_PAGE_ID,
		component({ title: 'My KPI', limit: 20 }),
	);
	await repository.updateComponent(DEFAULT_PAGE_ID, 'component:1', {
		title: undefined,
	});

	const stored = currentPage((await repository.load()).store).components[0];
	assert.equal('title' in stored, false, 'title should be deleted, not set to undefined');
	assert.equal(stored.limit, 20, 'other keys must be untouched');

	await repository.updateComponent(DEFAULT_PAGE_ID, 'component:1', {
		limit: undefined,
	});
	const cleared = currentPage((await repository.load()).store).components[0];
	assert.equal('limit' in cleared, false);
});

test('an undefined option value deletes that key and keeps the others', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	await repository.addComponent(
		DEFAULT_PAGE_ID,
		component({ options: { range: '30', yMin: 2, yMax: 8 } }),
	);
	await repository.updateComponent(DEFAULT_PAGE_ID, 'component:1', {
		options: { yMin: undefined },
	});

	const stored = currentPage((await repository.load()).store).components[0];
	assert.deepEqual(stored.options, { range: '30', yMax: 8 });
});

test('component and query entries with broken shapes are dropped on load', async () => {
	const host = v4(
		{},
		[
			dashboard({
				id: DEFAULT_DASHBOARD_ID,
				pages: [
					page({
						id: DEFAULT_PAGE_ID,
						name: 'Mine',
						components: [component(), { id: 'no-type', queryId: 'q' }],
					}),
				],
			}),
		],
		{ queries: [query(), { id: 'broken', name: 'no-target' }] },
	);
	const repository = new DashboardRepository(host);

	const { store, damaged } = await repository.load();

	assert.equal(damaged, false);
	assert.deepEqual(
		currentPage(store).components.map((item) => item.id),
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

test('setLastPage only accepts pages owned by that dashboard', async () => {
	const host = v4({}, [
		dashboard({ id: 'dashboard:a', pages: [page({ id: 'page:a' })] }),
		dashboard({ id: 'dashboard:b', pages: [page({ id: 'page:b' })] }),
	]);
	const repository = new DashboardRepository(host);
	await repository.load();

	let store = await repository.setLastPage('dashboard:a', 'page:b');
	assert.equal(store.dashboards[0].lastPageId, undefined);

	store = await repository.setLastPage('dashboard:a', 'page:missing');
	assert.equal(store.dashboards[0].lastPageId, undefined);

	store = await repository.setLastPage('dashboard:a', 'page:a');
	assert.equal(store.dashboards[0].lastPageId, 'page:a');
});

test('export / import round-trips normalised v4 JSON', async () => {
	const repository = new DashboardRepository(makeHost());
	const original = {
		schemaVersion: DASHBOARD_SCHEMA_VERSION,
		dashboards: [
			dashboard({
				id: DEFAULT_DASHBOARD_ID,
				pages: [
					page({
						id: DEFAULT_PAGE_ID,
						name: 'Mine',
						components: [component()],
					}),
				],
				lastPageId: DEFAULT_PAGE_ID,
			}),
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

test('v3 pages migrate to v4 inside the default dashboard in memory', async () => {
	const host = makeHost({
		dashboardStore: {
			schemaVersion: 3,
			pages: [
				{ id: 'page:home', name: 'Home', components: [component()] },
			],
			activePageId: 'page:home',
			queries: [query()],
		},
	});
	const repository = new DashboardRepository(host);

	const { store, damaged } = await repository.load();

	assert.equal(damaged, false);
	assert.equal(store.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.equal(store.dashboards.length, 1);
	assert.equal(store.dashboards[0].id, DEFAULT_DASHBOARD_ID);
	assert.equal(store.dashboards[0].pages[0].id, 'page:home');
	assert.equal(store.dashboards[0].pages[0].name, 'Home');
	assert.equal(store.dashboards[0].pages[0].components.length, 1);
	assert.equal(store.dashboards[0].lastPageId, 'page:home');
	assert.equal(store.activeDashboardId, DEFAULT_DASHBOARD_ID);
	assert.deepEqual(store.queries.map((item) => item.id), ['user:1']);
	assert.equal(host.writes, 0);
});

test('v2 dashboards (pages without a level) migrate to v4, keeping ids', async () => {
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
	assert.equal(store.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.equal(store.dashboards.length, 1);
	assert.equal(store.dashboards[0].id, DEFAULT_DASHBOARD_ID);
	assert.equal(store.dashboards[0].pages[0].id, 'dashboard:default');
	assert.equal(store.dashboards[0].pages[0].name, 'My Dashboard');
	assert.equal(store.dashboards[0].pages[0].components.length, 1);
	assert.equal(store.activeDashboardId, DEFAULT_DASHBOARD_ID);
	assert.deepEqual(store.queries.map((item) => item.id), ['user:1']);
	assert.equal(host.writes, 0);
});

test('v4 loading is read-only and idempotent', async () => {
	const host = v4(
		{},
		[dashboard({ id: DEFAULT_DASHBOARD_ID, name: 'Mine', pages: [page()] })],
		{ activeDashboardId: DEFAULT_DASHBOARD_ID },
	);
	const repository = new DashboardRepository(host);

	const first = await repository.load();
	const second = await repository.load();

	assert.equal(host.writes, 0);
	assert.deepEqual(second.store, first.store);
	assert.equal(host.data.dashboardStore.schemaVersion, 4);
});

test('mixed v4 and v2 entries in dashboards[] do not misclassify each other', async () => {
	const host = v4({}, [
		{
			id: 'dashboard:v4',
			name: 'V4',
			pages: [page({ id: 'page:v4', components: [component()] })],
		},
		{ id: 'legacy', name: 'Old', components: [component({ id: 'component:old' })] },
	]);
	const repository = new DashboardRepository(host);

	const { store } = await repository.load();

	assert.equal(store.dashboards.length, 2);
	assert.equal(store.dashboards[0].id, 'dashboard:v4');
	assert.equal(store.dashboards[0].pages[0].id, 'page:v4');
	assert.equal(store.dashboards[1].id, DEFAULT_DASHBOARD_ID);
	assert.equal(store.dashboards[1].pages[0].id, 'legacy');
	assert.equal(store.dashboards[1].pages[0].name, 'Old');
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

	assert.equal(store.dashboards.length, 1);
	assert.deepEqual(store.dashboards[0].pages.map((item) => item.id), ['page:new']);
	assert.equal(store.dashboards[0].lastPageId, 'page:new');
});

test('an empty dashboard gets a default page with a unique id', async () => {
	const repository = new DashboardRepository(
		makeHost({
			dashboardStore: {
				schemaVersion: 4,
				dashboards: [{ id: 'dashboard:empty', name: 'Empty', pages: [] }],
				activeDashboardId: 'dashboard:empty',
				queries: [],
			},
		}),
	);

	const { store } = await repository.load();

	assert.equal(store.dashboards.length, 1);
	assert.equal(store.dashboards[0].pages.length, 1);
	assert.equal(store.dashboards[0].pages[0].id, 'page:default-dashboard-empty');
	assert.equal(store.activeDashboardId, 'dashboard:empty');
});

test('an unknown activeDashboardId falls back to the first dashboard', async () => {
	const repository = new DashboardRepository(
		v4({}, [dashboard({ id: 'dashboard:a' }), dashboard({ id: 'dashboard:b' })], {
			activeDashboardId: 'missing',
		}),
	);

	const { store } = await repository.load();

	assert.equal(store.activeDashboardId, 'dashboard:a');
});

test('duplicate dashboard ids and page ids keep the first occurrence', async () => {
	const repository = new DashboardRepository(
		v4({}, [
			dashboard({ id: 'dashboard:a', pages: [page({ id: 'page:shared' })] }),
			dashboard({ id: 'dashboard:a', pages: [page({ id: 'page:b' })] }),
			dashboard({ id: 'dashboard:b', pages: [page({ id: 'page:shared' })] }),
		]),
	);

	const { store } = await repository.load();

	assert.deepEqual(store.dashboards.map((item) => item.id), [
		'dashboard:a',
		'dashboard:b',
	]);
	assert.deepEqual(store.dashboards[0].pages.map((item) => item.id), ['page:shared']);
	assert.equal(store.dashboards[1].pages.length, 1);
});

test('page CRUD is scoped to one dashboard, rename works across dashboards', async () => {
	const host = v4({}, [
		dashboard({ id: 'dashboard:a', pages: [page({ id: 'page:a1' })] }),
		dashboard({ id: 'dashboard:b', pages: [page({ id: 'page:b1' })] }),
	]);
	const repository = new DashboardRepository(host);
	await repository.load();

	await repository.addPage('dashboard:a', page({ id: 'page:a2', name: 'A2' }));
	let store = await repository.load();
	assert.deepEqual(store.store.dashboards[0].pages.map((item) => item.id), [
		'page:a1',
		'page:a2',
	]);
	assert.equal(store.store.dashboards[1].pages.length, 1);

	await repository.addPage('dashboard:b', page({ id: 'page:a2', name: 'duplicate' }));
	store = await repository.load();
	assert.equal(store.store.dashboards[1].pages.length, 1);

	await repository.renamePage('page:a2', '  Renamed  ');
	store = await repository.load();
	assert.equal(store.store.dashboards[0].pages[1].name, 'Renamed');
	assert.equal(store.store.dashboards[0].lastPageId, 'page:a2');

	await repository.renamePage('page:a2', '   ');
	store = await repository.load();
	assert.equal(store.store.dashboards[0].pages[1].name, 'Renamed');

	await repository.removePage('page:a2');
	store = await repository.load();
	assert.deepEqual(store.store.dashboards[0].pages.map((item) => item.id), ['page:a1']);
});

test('the last page of a dashboard is never removed', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	const store = await repository.removePage(DEFAULT_PAGE_ID);

	assert.equal(store.dashboards[0].pages.length, 1);
	assert.equal(store.dashboards[0].pages[0].id, DEFAULT_PAGE_ID);
});

test('removing the last page falls back to the first remaining page', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [page({ id: 'page:a' }), page({ id: 'page:b' })],
			lastPageId: 'page:a',
		}),
	]);
	const repository = new DashboardRepository(host);

	const store = await repository.removePage('page:a');

	assert.deepEqual(store.dashboards[0].pages.map((item) => item.id), ['page:b']);
	assert.equal(store.dashboards[0].lastPageId, 'page:b');
});

test('components stay isolated per page and per dashboard', async () => {
	const host = v4({}, [
		dashboard({
			id: 'dashboard:a',
			pages: [page({ id: 'page:a1' }), page({ id: 'page:a2' })],
		}),
		dashboard({ id: 'dashboard:b', pages: [page({ id: 'page:b1' })] }),
	]);
	const repository = new DashboardRepository(host);

	await repository.addComponent('page:a1', component({ id: 'component:a1' }));
	await repository.addComponent('page:a2', component({ id: 'component:a2' }));
	await repository.addComponent('page:b1', component({ id: 'component:b1' }));
	let store = await repository.load();
	const pages = Object.fromEntries(
		store.store.dashboards.flatMap((item) =>
			item.pages.map((p) => [p.id, p.components.map((c) => c.id)]),
		),
	);
	assert.deepEqual(pages, {
		'page:a1': ['component:a1'],
		'page:a2': ['component:a2'],
		'page:b1': ['component:b1'],
	});

	await repository.updateComponent('page:b1', 'component:b1', { basis: 'section' });
	store = await repository.load();
	assert.equal(store.store.dashboards[0].pages[0].components[0].basis, 'file');
	assert.equal(store.store.dashboards[1].pages[0].components[0].basis, 'section');

	await repository.removeComponent('page:a1', 'component:a1');
	store = await repository.load();
	assert.equal(store.store.dashboards[0].pages[0].components.length, 0);
	assert.equal(store.store.dashboards[1].pages[0].components.length, 1);
});

test('reference counts span dashboards and survive dashboard deletion', async () => {
	const host = v4(
		{},
		[
			dashboard({
				id: 'dashboard:a',
				pages: [page({ id: 'page:a', components: [component({ queryId: 'user:1' })] })],
			}),
			dashboard({
				id: 'dashboard:b',
				pages: [page({ id: 'page:b', components: [component({ queryId: 'user:1' })] })],
			}),
		],
		{ queries: [query()] },
	);
	const repository = new DashboardRepository(host);
	let { store } = await repository.load();
	assert.equal(repository.referenceCount(store, 'user:1'), 2);

	store = await repository.removeDashboard('dashboard:b');
	assert.equal(repository.referenceCount(store, 'user:1'), 1);
	assert.deepEqual(store.queries.map((item) => item.id), ['user:1']);
});

test('importing v3 / v2 JSON upgrades it to the v5 shape', async () => {
	const repository = new DashboardRepository(makeHost());
	const v3 = JSON.stringify({
		schemaVersion: 3,
		pages: [{ id: 'page:home', name: 'Home', components: [component()] }],
		activePageId: 'page:home',
		queries: [query()],
	});
	const v2 = JSON.stringify({
		schemaVersion: 2,
		dashboards: [{ id: 'dashboard:default', name: 'Mine', components: [component()] }],
		activeDashboardId: 'dashboard:default',
		queries: [query()],
	});

	const importedV3 = repository.importJson(v3);
	assert.equal(importedV3.schemaVersion, 5);
	assert.equal(importedV3.dashboards[0].pages[0].id, 'page:home');

	const importedV2 = repository.importJson(v2);
	assert.equal(importedV2.schemaVersion, 5);
	assert.equal(importedV2.dashboards[0].pages[0].id, 'dashboard:default');
	assert.deepEqual(importedV2.queries, [query()]);
});

test('moveComponent reorders within a page and clamps the target index', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [
				page({
					id: DEFAULT_PAGE_ID,
					components: ['a', 'b', 'c'].map((id) =>
						component({ id: `component:${id}` }),
					),
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);

	const ids = async () =>
		(await repository.load()).store.dashboards[0].pages[0].components.map(
			(item) => item.id,
		);

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
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [
				page({
					id: DEFAULT_PAGE_ID,
					components: [component({ id: 'component:a' })],
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);
	const writesBefore = host.writes;

	await repository.moveComponent(DEFAULT_PAGE_ID, 'component:missing', 0);
	await repository.moveComponent('page:missing', 'component:a', 0);

	const { store } = await repository.load();
	assert.deepEqual(
		store.dashboards[0].pages[0].components.map((item) => item.id),
		['component:a'],
	);
	assert.equal(host.writes, writesBefore + 2);
});

test('transferComponent moves a component across pages and keeps every field', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			lastPageId: 'page:one',
			pages: [
				page({
					id: 'page:one',
					components: [
						component({
							id: 'component:a',
							type: 'kpi',
							queryId: 'builtin:tasks-all',
							title: 'Tasks',
							basis: 'section',
							view: 'list',
							measure: 'count',
							options: { accent: '#fff' },
							w: 6,
							h: 3,
							x: 1,
							y: 2,
						}),
					],
				}),
				page({
					id: 'page:two',
					components: [component({ id: 'component:b' })],
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);
	await repository.load();

	const result = await repository.transferComponent(
		'page:one',
		'component:a',
		'page:two',
	);

	assert.ok(result);
	assert.equal(result.componentId, 'component:a');
	const [first, second] = result.store.dashboards[0].pages;
	assert.deepEqual(first.components, []);
	const [, moved] = second.components;
	assert.deepEqual(
		second.components.map((item) => item.id),
		['component:b', 'component:a'],
	);
	assert.equal(moved.id, 'component:a');
	assert.equal(moved.type, 'kpi');
	assert.equal(moved.queryId, 'builtin:tasks-all');
	assert.equal(moved.title, 'Tasks');
	assert.equal(moved.basis, 'section');
	assert.equal(moved.view, 'list');
	assert.equal(moved.measure, 'count');
	assert.deepEqual(moved.options, { accent: '#fff' });
	assert.equal(moved.w, 6);
	assert.equal(moved.h, 3);
	assert.equal(moved.x, 1);
	assert.equal(moved.y, 2);
	assert.equal(host.writes, 1);
});

test('transferComponent honours toIndex with clamping and defaults to the end', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [
				page({
					id: 'page:one',
					components: ['a', 'd'].map((id) =>
						component({ id: `component:${id}` }),
					),
				}),
				page({
					id: 'page:two',
					components: ['x', 'y', 'z'].map((id) =>
						component({ id: `component:${id}` }),
					),
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);
	await repository.load();

	const ids = async () =>
		(await repository.load()).store.dashboards[0].pages[1].components.map(
			(item) => item.id,
		);

	await repository.transferComponent(
		'page:one',
		'component:a',
		'page:two',
		-5,
	);
	assert.deepEqual(await ids(), [
		'component:a',
		'component:x',
		'component:y',
		'component:z',
	]);

	await repository.transferComponent(
		'page:one',
		'component:d',
		'page:two',
		99,
	);
	assert.deepEqual(await ids(), [
		'component:a',
		'component:x',
		'component:y',
		'component:z',
		'component:d',
	]);

	await repository.transferComponent('page:two', 'component:a', 'page:one');
	assert.deepEqual(
		(await repository.load()).store.dashboards[0].pages[0].components.map(
			(item) => item.id,
		),
		['component:a'],
	);
});

test('transferComponent refuses same-page, unknown ids and id collisions', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			lastPageId: 'page:one',
			pages: [
				page({
					id: 'page:one',
					components: [component({ id: 'component:a' })],
				}),
				page({
					id: 'page:two',
					components: [component({ id: 'component:b' })],
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);
	await repository.load();
	const writesBefore = host.writes;

	assert.equal(
		await repository.transferComponent(
			'page:one',
			'component:a',
			'page:one',
		),
		null,
	);
	assert.equal(
		await repository.transferComponent(
			'page:nope',
			'component:a',
			'page:two',
		),
		null,
	);
	assert.equal(
		await repository.transferComponent(
			'page:one',
			'component:missing',
			'page:two',
			0,
		),
		null,
	);

	const { store } = await repository.load();
	assert.deepEqual(
		store.dashboards[0].pages.map((item) =>
			item.components.map((c) => c.id),
		),
		[['component:a'], ['component:b']],
	);
	assert.equal(store.dashboards[0].lastPageId, 'page:one');
	assert.equal(store.activeDashboardId, DEFAULT_DASHBOARD_ID);
	assert.equal(store.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.ok(host.writes > writesBefore);
});

test('transferComponent cannot collide when the target page already has the id', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [
				page({
					id: 'page:one',
					components: [component({ id: 'component:a' })],
				}),
				page({
					id: 'page:two',
					components: [component({ id: 'component:a' })],
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);
	await repository.load();

	const result = await repository.transferComponent(
		'page:one',
		'component:a',
		'page:two',
	);

	assert.equal(result, null);
	const { store } = await repository.load();
	assert.deepEqual(
		store.dashboards[0].pages.map((item) =>
			item.components.map((c) => c.id),
		),
		[['component:a'], ['component:a']],
	);
});

test('transferComponent moves across dashboards and leaves queries shared', async () => {
	const host = v4(
		{},
		[
			dashboard({
				id: DEFAULT_DASHBOARD_ID,
				pages: [
					page({
						id: DEFAULT_PAGE_ID,
						components: [component({ id: 'component:a' })],
					}),
				],
			}),
			dashboard({
				id: 'dashboard:two',
				name: 'Two',
				pages: [page({ id: 'page:two' })],
			}),
		],
		{ queries: [query()] },
	);
	const repository = new DashboardRepository(host);
	await repository.load();

	const result = await repository.transferComponent(
		DEFAULT_PAGE_ID,
		'component:a',
		'page:two',
	);
	assert.ok(result);
	assert.deepEqual(result.store.dashboards[0].pages[0].components, []);
	assert.deepEqual(
		result.store.dashboards[1].pages[0].components.map((item) => item.id),
		['component:a'],
	);
	assert.equal(result.store.dashboards[1].pages[0].components[0].queryId, 'builtin:tasks-all');
	assert.deepEqual(result.store.queries, [query()]);
	assert.equal(result.store.activeDashboardId, DEFAULT_DASHBOARD_ID);
});

test('addDashboard appends, rejects duplicate ids and becomes active', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	const workspace = dashboard({
		id: 'dashboard:two',
		name: 'Two',
		pages: [page({ id: 'page:two' })],
	});
	let store = await repository.addDashboard(workspace);
	assert.equal(store.dashboards.length, 2);
	assert.equal(store.activeDashboardId, 'dashboard:two');
	assert.equal(store.dashboards[1].lastPageId, 'page:two');

	store = await repository.addDashboard(
		dashboard({ id: 'dashboard:two', name: 'Duplicate' }),
	);
	assert.equal(store.dashboards.length, 2);
	assert.equal(store.dashboards[1].name, 'Two');
});

test('addDashboard gives an empty workspace a default page', async () => {
	const repository = new DashboardRepository(makeHost());
	await repository.load();

	const store = await repository.addDashboard({
		id: 'dashboard:empty',
		name: 'Empty',
		pages: [],
	});

	assert.equal(store.dashboards[1].pages.length, 1);
	assert.equal(store.dashboards[1].lastPageId, store.dashboards[1].pages[0].id);
});

test('renameDashboard trims and ignores blank names', async () => {
	const repository = new DashboardRepository(makeHost());
	await repository.load();

	let store = await repository.renameDashboard(DEFAULT_DASHBOARD_ID, '  Work  ');
	assert.equal(store.dashboards[0].name, 'Work');

	store = await repository.renameDashboard(DEFAULT_DASHBOARD_ID, '   ');
	assert.equal(store.dashboards[0].name, 'Work');

	store = await repository.renameDashboard('dashboard:missing', 'Nope');
	assert.equal(store.dashboards[0].name, 'Work');
});

test('removeDashboard refuses the last item and falls back when deleting the active one', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	let store = await repository.removeDashboard(DEFAULT_DASHBOARD_ID);
	assert.equal(store.dashboards.length, 1);

	await repository.addDashboard(
		dashboard({ id: 'dashboard:two', name: 'Two', pages: [page({ id: 'page:two' })] }),
	);
	store = await repository.removeDashboard('dashboard:two');
	assert.equal(store.dashboards.length, 1);
	assert.equal(store.activeDashboardId, DEFAULT_DASHBOARD_ID);
});

test('setActiveDashboard only accepts existing dashboards', async () => {
	const repository = new DashboardRepository(makeHost());
	await repository.load();
	await repository.addDashboard(
		dashboard({ id: 'dashboard:two', name: 'Two', pages: [page({ id: 'page:two' })] }),
	);

	let store = await repository.setActiveDashboard('missing');
	assert.equal(store.activeDashboardId, 'dashboard:two');

	store = await repository.setActiveDashboard(DEFAULT_DASHBOARD_ID);
	assert.equal(store.activeDashboardId, DEFAULT_DASHBOARD_ID);
});

test('duplicateDashboard regenerates every page/component id and deep-copies content', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();
	await repository.addPage(DEFAULT_DASHBOARD_ID, page({ id: 'page:a' }));
	await repository.addComponent('page:a', component({ id: 'component:a' }));
	await repository.setLastPage(DEFAULT_DASHBOARD_ID, 'page:a');

	const store = await repository.duplicateDashboard(DEFAULT_DASHBOARD_ID, 'Copy');
	assert.equal(store.dashboards.length, 2);
	const copy = store.dashboards[1];
	assert.notEqual(copy.id, DEFAULT_DASHBOARD_ID);
	assert.equal(copy.name, 'Copy');
	assert.equal(copy.pages.length, 2);
	assert.notEqual(copy.pages[0].id, DEFAULT_PAGE_ID);
	assert.notEqual(copy.pages[1].id, 'page:a');
	assert.equal(copy.lastPageId, copy.pages[1].id);
	const copyComponent = copy.pages[1].components[0];
	assert.notEqual(copyComponent.id, 'component:a');

	await repository.updateComponent(copy.pages[1].id, copyComponent.id, {
		title: 'changed',
	});
	const reloaded = (await repository.load()).store;
	assert.equal(reloaded.dashboards[0].pages[1].components[0].title, undefined);
	assert.equal(
		reloaded.dashboards[1].pages[1].components[0].title,
		'changed',
	);
});

test('duplicateComponent inserts a copy right after the source and returns its id', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [
				page({
					id: DEFAULT_PAGE_ID,
					components: [
						component({ id: 'component:a' }),
						component({ id: 'component:b' }),
						component({ id: 'component:c' }),
					],
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);
	await repository.load();

	const result = await repository.duplicateComponent(
		DEFAULT_PAGE_ID,
		'component:a',
		'A (copy)',
	);

	assert.ok(result);
	const components = currentPage(result.store).components;
	assert.equal(components.length, 4);
	assert.deepEqual(
		components.map((item) => item.id),
		['component:a', result.componentId, 'component:b', 'component:c'],
	);
	assert.equal(host.writes, 1);
});

test('duplicateComponent deep-copies the config and keeps a shared queryId', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [
				page({
					id: DEFAULT_PAGE_ID,
					components: [
						component({
							id: 'component:a',
							title: 'Tasks',
							basis: 'section',
							view: 'list',
							measure: 'count',
							options: { accent: '#fff' },
							w: 6,
							h: 3,
							x: 2,
							y: 5,
						}),
					],
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);
	await repository.load();

	const result = await repository.duplicateComponent(
		DEFAULT_PAGE_ID,
		'component:a',
	);
	assert.ok(result);

	const [source, copy] = currentPage(result.store).components;
	assert.notEqual(copy.id, source.id);
	assert.equal(copy.title, 'Tasks');
	assert.equal(copy.type, source.type);
	assert.equal(copy.queryId, source.queryId);
	assert.equal(copy.basis, 'section');
	assert.equal(copy.view, 'list');
	assert.equal(copy.measure, 'count');
	assert.equal(copy.w, 6);
	assert.equal(copy.h, 3);
	assert.equal(copy.x, 2);
	assert.equal(copy.y, 5);
	assert.deepEqual(copy.options, { accent: '#fff' });
	assert.notEqual(copy.options, source.options);
	copy.options.accent = '#000';
	assert.equal(source.options.accent, '#fff');
});

test('duplicateComponent avoids every id already used in the store', async () => {
	const originalNow = Date.now;
	Date.now = () => 1234;
	try {
		const host = v4({}, [
			dashboard({
				id: DEFAULT_DASHBOARD_ID,
				pages: [
					page({
						id: DEFAULT_PAGE_ID,
						components: [component({ id: 'component:1234' })],
					}),
				],
			}),
			dashboard({
				id: 'dashboard:two',
				name: 'Two',
				pages: [
					page({
						id: 'page:two',
						components: [component({ id: 'component:1234-2' })],
					}),
				],
			}),
		]);
		const repository = new DashboardRepository(host);
		await repository.load();

		const result = await repository.duplicateComponent(
			DEFAULT_PAGE_ID,
			'component:1234',
		);
		assert.ok(result);
		assert.equal(result.componentId, 'component:1234-3');
	} finally {
		Date.now = originalNow;
	}
});

test('duplicateComponent only overrides the title when one is provided', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();
	await repository.addComponent(
		DEFAULT_PAGE_ID,
		component({ id: 'component:titled', title: 'Mine' }),
	);
	await repository.addComponent(
		DEFAULT_PAGE_ID,
		component({ id: 'component:untitled' }),
	);

	const titled = await repository.duplicateComponent(
		DEFAULT_PAGE_ID,
		'component:titled',
		'Mine (copy)',
	);
	const untitled = await repository.duplicateComponent(
		DEFAULT_PAGE_ID,
		'component:untitled',
	);
	assert.ok(titled && untitled);

	const store = (await repository.load()).store;
	const byId = (id) =>
		currentPage(store).components.find((item) => item.id === id);
	assert.equal(byId(titled.componentId).title, 'Mine (copy)');
	assert.equal(byId('component:titled').title, 'Mine');
	assert.equal('title' in byId(untitled.componentId), false);
});

test('duplicateComponent returns null for unknown ids but still writes once', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [
				page({
					id: DEFAULT_PAGE_ID,
					components: [component({ id: 'component:a' })],
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);
	const writesBefore = host.writes;

	const missingComponent = await repository.duplicateComponent(
		DEFAULT_PAGE_ID,
		'component:missing',
	);
	const missingPage = await repository.duplicateComponent(
		'page:missing',
		'component:a',
	);

	assert.equal(missingComponent, null);
	assert.equal(missingPage, null);
	const { store } = await repository.load();
	assert.deepEqual(
		store.dashboards[0].pages[0].components.map((item) => item.id),
		['component:a'],
	);
	assert.equal(host.writes, writesBefore + 2);
});

test('findDashboardForPage resolves the owning dashboard', async () => {
	const repository = new DashboardRepository(makeHost());
	const { store } = await repository.load();
	await repository.addPage(DEFAULT_DASHBOARD_ID, page({ id: 'page:extra' }));
	const loaded = (await repository.load()).store;

	assert.equal(findDashboardForPage(loaded, DEFAULT_PAGE_ID)?.id, DEFAULT_DASHBOARD_ID);
	assert.equal(findDashboardForPage(loaded, 'page:extra')?.id, DEFAULT_DASHBOARD_ID);
	assert.equal(findDashboardForPage(loaded, 'page:missing'), undefined);
	assert.equal(store.dashboards.length, 1);
});

test('onChange fires once per write and stops after unsubscribe', async () => {
	const host = makeHost();
	const repository = new DashboardRepository(host);
	await repository.load();

	const seen = [];
	const unsubscribe = repository.onChange((store) => seen.push(store));

	await repository.addComponent(DEFAULT_PAGE_ID, component());
	assert.equal(seen.length, 1);
	assert.equal(seen[0].dashboards[0].pages[0].components.length, 1);

	unsubscribe();
	await repository.addComponent(DEFAULT_PAGE_ID, component({ id: 'component:2' }));
	assert.equal(seen.length, 1);
});

test('legacy unfinished-tasks components migrate to task-list and drop measure', async () => {
	const host = v4({}, [
		dashboard({
			id: DEFAULT_DASHBOARD_ID,
			pages: [
				page({
					id: DEFAULT_PAGE_ID,
					components: [
						component({
							id: 'component:legacy',
							type: 'unfinished-tasks',
							measure: 'open',
							queryId: 'builtin:tasks-unfinished',
							basis: 'section',
							limit: 15,
							w: 6,
							h: 3,
						}),
						component({
							id: 'component:plain',
							type: 'unfinished-tasks',
							queryId: 'user:1',
						}),
					],
				}),
			],
		}),
	]);
	const repository = new DashboardRepository(host);

	const { store } = await repository.load();
	const [legacy, plain] = currentPage(store).components;

	assert.equal(legacy.type, 'task-list');
	assert.equal(legacy.measure, undefined);
	assert.equal('measure' in legacy, false, 'legacy measure must be dropped');
	assert.equal(legacy.queryId, 'builtin:tasks-unfinished');
	assert.equal(legacy.basis, 'section');
	assert.equal(legacy.limit, 15);
	assert.equal(legacy.w, 6);
	assert.equal(legacy.h, 3);

	assert.equal(plain.type, 'task-list');
	assert.equal(plain.queryId, 'user:1');
	assert.equal('measure' in plain, false);

	assert.equal(host.writes, 0, 'migration happens in memory only');
});
