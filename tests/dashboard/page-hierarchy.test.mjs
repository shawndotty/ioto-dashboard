import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { DashboardRepository } = await load('../../src/dashboard/repository.ts');
const { DASHBOARD_SCHEMA_VERSION } = await load('../../src/dashboard/types.ts');

function makeHost(pages, overrides = {}) {
	const data = {
		dashboardStore: {
			schemaVersion: 7,
			dashboards: [
				{
					id: 'dashboard:1',
					name: 'Dash',
					pages,
					lastPageId: pages[0]?.id,
					...overrides,
				},
			],
			activeDashboardId: 'dashboard:1',
			queries: [],
		},
	};
	return {
		data,
		readData: async () => structuredClone(data),
		updateData: async (mutate) => {
			mutate(data);
		},
	};
}

function repository(pages, overrides) {
	return new DashboardRepository(makeHost(pages, overrides));
}

function page(id, name = id, extra = {}) {
	return { id, name, components: [], ...extra };
}

function ids(pages) {
	return pages.map((item) => item.id);
}

test('valid parentId survives loading and is reordered into parent + children', async () => {
	const repo = repository([
		page('page:a'),
		page('page:b'),
		page('page:c', 'C', { parentId: 'page:a' }),
	]);
	const { store } = await repo.load();
	assert.deepEqual(ids(store.dashboards[0].pages), [
		'page:a',
		'page:c',
		'page:b',
	]);
	assert.equal(store.dashboards[0].pages[1].parentId, 'page:a');
});

test('parentId pointing to a missing page, itself or a subpage is dropped', async () => {
	const repo = repository([
		page('page:a'),
		page('page:b', 'B', { parentId: 'page:missing' }),
		page('page:c', 'C', { parentId: 'page:c' }),
		page('page:d', 'D', { parentId: 'page:a' }),
		page('page:e', 'E', { parentId: 'page:d' }),
	]);
	const { store } = await repo.load();
	const pages = store.dashboards[0].pages;
	assert.equal(pages.length, 5);
	assert.equal(pages.find((item) => item.id === 'page:b').parentId, undefined);
	assert.equal(pages.find((item) => item.id === 'page:c').parentId, undefined);
	assert.equal(pages.find((item) => item.id === 'page:e').parentId, undefined);
	assert.equal(pages.find((item) => item.id === 'page:d').parentId, 'page:a');
});

test('a parent chain collapses to one level without losing pages', async () => {
	const repo = repository([
		page('page:a', 'A', { parentId: 'page:b' }),
		page('page:b', 'B', { parentId: 'page:c' }),
		page('page:c', 'C'),
	]);
	const { store } = await repo.load();
	const pages = store.dashboards[0].pages;
	assert.equal(pages.length, 3);
	const byId = new Map(pages.map((item) => [item.id, item]));
	assert.equal(byId.get('page:c').parentId, undefined);
	assert.equal(byId.get('page:b').parentId, 'page:c');
	assert.equal(byId.get('page:a').parentId, undefined);
});

test('setPageParent moves a page to the end of the target group', async () => {
	const repo = repository([
		page('page:a'),
		page('page:b'),
		page('page:c'),
	]);
	const store = await repo.setPageParent('page:c', 'page:a');
	const pages = store.dashboards[0].pages;
	assert.deepEqual(ids(pages), ['page:a', 'page:c', 'page:b']);
	assert.equal(pages[1].parentId, 'page:a');
});

test('setPageParent rejects a subpage target and a page with children', async () => {
	const repo = repository([
		page('page:a'),
		page('page:child', 'Child', { parentId: 'page:a' }),
		page('page:b'),
	]);
	const rejected = await repo.setPageParent('page:b', 'page:child');
	assert.equal(
		rejected.dashboards[0].pages.find((item) => item.id === 'page:b')
			.parentId,
		undefined,
	);
	const guarded = await repo.setPageParent('page:a', 'page:b');
	assert.equal(
		guarded.dashboards[0].pages.find((item) => item.id === 'page:a')
			.parentId,
		undefined,
	);
});

test('setPageParent(null) restores the top level after the old group', async () => {
	const repo = repository([
		page('page:a'),
		page('page:child', 'Child', { parentId: 'page:a' }),
		page('page:b'),
	]);
	const store = await repo.setPageParent('page:child', null);
	const pages = store.dashboards[0].pages;
	assert.deepEqual(ids(pages), ['page:a', 'page:child', 'page:b']);
	assert.equal(pages[1].parentId, undefined);
});

test('removing a parent cascades to its subpages and rehomes lastPageId', async () => {
	const repo = repository([
		page('page:a'),
		page('page:a1', 'A1', { parentId: 'page:a' }),
		page('page:a2', 'A2', { parentId: 'page:a' }),
		page('page:b'),
	], { lastPageId: 'page:a1' });
	const store = await repo.removePage('page:a');
	const dashboard = store.dashboards[0];
	assert.deepEqual(ids(dashboard.pages), ['page:b']);
	assert.equal(dashboard.lastPageId, 'page:b');
});

test('removing the only page (including its subpages) is a no-op', async () => {
	const repo = repository([
		page('page:a'),
		page('page:a1', 'A1', { parentId: 'page:a' }),
	]);
	const store = await repo.removePage('page:a');
	assert.equal(store.dashboards[0].pages.length, 2);
});

test('duplicating a parent copies the group-less page and lands after the group', async () => {
	const repo = repository([
		page('page:a'),
		page('page:a1', 'A1', { parentId: 'page:a' }),
		page('page:b'),
	]);
	const result = await repo.duplicatePage('page:a', 'A copy');
	const pages = result.store.dashboards[0].pages;
	assert.deepEqual(ids(pages).slice(0, 4), [
		'page:a',
		'page:a1',
		result.pageId,
		'page:b',
	]);
	const copy = pages.find((item) => item.id === result.pageId);
	assert.equal(copy.parentId, undefined);
});

test('duplicating a subpage keeps the parent and inserts right after it', async () => {
	const repo = repository([
		page('page:a'),
		page('page:a1', 'A1', { parentId: 'page:a' }),
		page('page:a2', 'A2', { parentId: 'page:a' }),
	]);
	const result = await repo.duplicatePage('page:a1');
	const pages = result.store.dashboards[0].pages;
	assert.deepEqual(ids(pages), [
		'page:a',
		'page:a1',
		result.pageId,
		'page:a2',
	]);
	assert.equal(
		pages.find((item) => item.id === result.pageId).parentId,
		'page:a',
	);
});

test('moving a parent moves the whole group and keeps sibling order', async () => {
	const repo = repository([
		page('page:a'),
		page('page:a1', 'A1', { parentId: 'page:a' }),
		page('page:b'),
		page('page:c'),
	]);
	const store = await repo.movePage('page:a', 2);
	assert.deepEqual(ids(store.dashboards[0].pages), [
		'page:b',
		'page:c',
		'page:a',
		'page:a1',
	]);
});

test('moving a parent group backwards keeps the group intact', async () => {
	const repo = repository([
		page('page:a'),
		page('page:b'),
		page('page:b1', 'B1', { parentId: 'page:b' }),
		page('page:c'),
	]);
	const store = await repo.movePage('page:b', 0);
	assert.deepEqual(ids(store.dashboards[0].pages), [
		'page:b',
		'page:b1',
		'page:a',
		'page:c',
	]);
});

test('moving a subpage reorders inside its group only', async () => {
	const repo = repository([
		page('page:a'),
		page('page:a1', 'A1', { parentId: 'page:a' }),
		page('page:a2', 'A2', { parentId: 'page:a' }),
		page('page:b'),
	]);
	const store = await repo.movePage('page:a1', 1);
	assert.deepEqual(ids(store.dashboards[0].pages), [
		'page:a',
		'page:a2',
		'page:a1',
		'page:b',
	]);
});

test('moving a subpage out of range is clamped to its group', async () => {
	const repo = repository([
		page('page:a'),
		page('page:a1', 'A1', { parentId: 'page:a' }),
		page('page:a2', 'A2', { parentId: 'page:a' }),
		page('page:b'),
	]);
	const store = await repo.movePage('page:a1', 99);
	assert.deepEqual(ids(store.dashboards[0].pages), [
		'page:a',
		'page:a2',
		'page:a1',
		'page:b',
	]);
});

test('importJson applies the same hierarchy validation and writes schema 7', () => {
	const repo = new DashboardRepository({
		readData: async () => ({}),
		updateData: async () => {},
	});
	const imported = repo.importJson(
		JSON.stringify({
			schemaVersion: 6,
			dashboards: [
				{
					id: 'dashboard:1',
					name: 'Dash',
					pages: [
						page('page:a'),
						page('page:bad', 'Bad', { parentId: 'page:nope' }),
						page('page:a1', 'A1', { parentId: 'page:a' }),
					],
				},
			],
			activeDashboardId: 'dashboard:1',
			queries: [],
		}),
	);
	assert.equal(imported.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	assert.deepEqual(ids(imported.dashboards[0].pages), [
		'page:a',
		'page:a1',
		'page:bad',
	]);
	assert.equal(imported.dashboards[0].pages[2].parentId, undefined);
});
