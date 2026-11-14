import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { DashboardRepository, ImportApplyError } = await load(
	'../../src/dashboard/repository.ts',
);
const { DASHBOARD_STORE_KEY } = await load('../../src/dashboard/types.ts');

function makeHost(initial = {}) {
	const data = structuredClone(initial);
	const host = {
		data,
		writes: 0,
		readData: async () => structuredClone(data),
		updateData: async (mutate) => {
			host.writes++;
			mutate(data);
		},
	};
	return host;
}

function storeData(overrides = {}) {
	return {
		schemaVersion: 7,
		dashboards: [
			{
				id: 'dashboard:1',
				name: 'Main',
				pages: [{ id: 'page:1', name: 'Page 1', components: [] }],
			},
		],
		queries: [],
		activeDashboardId: 'dashboard:1',
		activePageId: 'page:1',
		...overrides,
	};
}

function plan(overrides = {}) {
	return {
		kind: 'ioto-dashboard-page',
		mode: 'append',
		targetDashboardId: 'dashboard:1',
		pages: [
			{
				id: 'page:import-1',
				name: 'Imported',
				components: [
					{
						id: 'component:import-1',
						type: 'task-list',
						queryId: 'user:import-1',
					},
				],
			},
		],
		dashboards: [],
		queries: [],
		customFilters: [],
		pageIdMap: {},
		queryIdMap: {},
		createdPageIds: ['page:import-1'],
		warnings: [],
		...overrides,
	};
}

test('applyImport appends pages and queries in a single write', async () => {
	const host = makeHost({ [DASHBOARD_STORE_KEY]: storeData() });
	const repo = new DashboardRepository(host);
	let notified = 0;
	repo.onChange(() => {
		notified++;
	});

	const result = await repo.applyImport(
		plan({
			queries: [
				{
					id: 'user:import-1',
					name: 'Imported query',
					target: 'task',
					scope: { folders: [], includeSubfolders: true },
					filters: {},
				},
			],
		}),
	);

	assert.equal(host.writes, 1);
	assert.equal(notified, 1);
	const dashboards = result.store.dashboards;
	assert.equal(dashboards[0].pages.length, 2);
	assert.equal(dashboards[0].pages[1].name, 'Imported');
	assert.equal(result.store.queries[0].id, 'user:import-1');
	assert.equal(result.customFilters, undefined);
});

test('applyImport merges new custom filters into data', async () => {
	const host = makeHost({
		[DASHBOARD_STORE_KEY]: storeData(),
		customFilters: [{ name: 'status', type: 'text', target: 'all' }],
	});
	const repo = new DashboardRepository(host);

	const result = await repo.applyImport(
		plan({
			customFilters: [
				{ name: 'status', type: 'number', target: 'all' },
				{ name: 'owner', type: 'text', target: 'note' },
			],
		}),
	);

	assert.deepEqual(result.customFilters, [
		{ name: 'status', type: 'text', target: 'all' },
		{ name: 'owner', type: 'text', target: 'note' },
	]);
	assert.deepEqual(host.data.customFilters, result.customFilters);
	assert.equal(host.writes, 1);
});

test('applyImport replace mode swaps dashboards and picks the first one', async () => {
	const host = makeHost({ [DASHBOARD_STORE_KEY]: storeData() });
	const repo = new DashboardRepository(host);

	const result = await repo.applyImport({
		...plan(),
		kind: 'ioto-dashboard-backup',
		mode: 'replace',
		pages: [],
		targetDashboardId: undefined,
		dashboards: [
			{
				id: 'dashboard:backup',
				name: 'Backup',
				pages: [{ id: 'page:backup', name: 'Backup page', components: [] }],
			},
		],
	});

	assert.equal(result.store.dashboards.length, 1);
	assert.equal(result.store.dashboards[0].id, 'dashboard:backup');
	assert.equal(result.store.activeDashboardId, 'dashboard:backup');
});

test('applyImport rejects an empty backup', async () => {
	const host = makeHost({ [DASHBOARD_STORE_KEY]: storeData() });
	const repo = new DashboardRepository(host);

	await assert.rejects(
		() =>
			repo.applyImport({
				...plan(),
				kind: 'ioto-dashboard-backup',
				mode: 'replace',
				dashboards: [],
			}),
		(error) =>
			error instanceof ImportApplyError && error.code === 'empty-backup',
	);
	assert.equal(host.writes, 0);
});

test('applyImport never writes when the stored data is damaged', async () => {
	const host = makeHost({ [DASHBOARD_STORE_KEY]: 'not-a-store' });
	const repo = new DashboardRepository(host);

	await assert.rejects(
		() => repo.applyImport(plan()),
		(error) =>
			error instanceof ImportApplyError && error.code === 'damaged',
	);
	assert.equal(host.writes, 0);
});

test('applyImport rejects when the target dashboard disappeared', async () => {
	const host = makeHost({ [DASHBOARD_STORE_KEY]: storeData() });
	const repo = new DashboardRepository(host);

	await assert.rejects(
		() => repo.applyImport(plan({ targetDashboardId: 'dashboard:missing' })),
		(error) =>
			error instanceof ImportApplyError && error.code === 'missing-target',
	);
	assert.equal(host.writes, 0);
});
