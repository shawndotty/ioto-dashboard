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

function store(componentOverrides = {}, pageOverrides = {}) {
	return JSON.stringify({
		schemaVersion: 4,
		dashboards: [
			{
				id: 'dashboard:1',
				name: 'Dash',
				pages: [
					{
						id: 'page:1',
						name: 'Page',
						components: [
							{
								id: 'component:1',
								type: 'kpi',
								queryId: 'builtin:tasks-all',
								...componentOverrides,
							},
						],
						...pageOverrides,
					},
				],
			},
		],
		activeDashboardId: 'dashboard:1',
		queries: [],
	});
}

test('v4 data loads as v5 and keeps the new feedback fields', () => {
	const imported = repository().importJson(
		store({
			view: 'table',
			measure: 'ratio',
			options: { showRowNumber: true, limitHint: 20, note: 'x' },
		}),
	);
	assert.equal(imported.schemaVersion, DASHBOARD_SCHEMA_VERSION);
	const component = imported.dashboards[0].pages[0].components[0];
	assert.equal(component.view, 'table');
	assert.equal(component.measure, 'ratio');
	assert.deepEqual(component.options, {
		showRowNumber: true,
		limitHint: 20,
		note: 'x',
	});
});

test('unknown view/measure values and non-scalar options are dropped', () => {	const imported = repository().importJson(
		store({
			view: 'hologram',
			measure: 'telepathy',
			options: { good: 'keep', nested: { no: 1 }, list: [1, 2] },
			unknownField: 'gone',
		}),
	);
	const component = imported.dashboards[0].pages[0].components[0];
	assert.equal(component.view, undefined);
	assert.equal(component.measure, undefined);
	assert.deepEqual(component.options, { good: 'keep' });
	assert.equal(component.unknownField, undefined);
});

test('pie, donut and scatter views survive normalization', () => {
	for (const view of ['pie', 'donut', 'scatter']) {
		const imported = repository().importJson(store({ view }));
		assert.equal(imported.dashboards[0].pages[0].components[0].view, view);
	}
});

test('page columns accept only 12/24 and rowHeight is clamped', () => {
	const ok = repository().importJson(store({}, { columns: 24, rowHeight: 90 }));
	const page = ok.dashboards[0].pages[0];
	assert.equal(page.columns, 24);
	assert.equal(page.rowHeight, 90);

	const bad = repository().importJson(store({}, { columns: 7, rowHeight: 9999 }));
	const badPage = bad.dashboards[0].pages[0];
	assert.equal(badPage.columns, undefined);
	assert.equal(badPage.rowHeight, 200);
});

test('file and folder query targets survive a load', () => {
	const imported = repository().importJson(
		JSON.stringify({
			schemaVersion: 5,
			dashboards: [
				{
					id: 'dashboard:1',
					name: 'Dash',
					pages: [{ id: 'page:1', name: 'Page', components: [] }],
				},
			],
			activeDashboardId: 'dashboard:1',
			queries: [
				{
					id: 'user:file',
					name: 'Files',
					target: 'file',
					scope: { folders: [], includeSubfolders: true },
					filters: {},
				},
				{
					id: 'user:folder',
					name: 'Folders',
					target: 'folder',
					scope: { folders: [], includeSubfolders: true },
					filters: {},
				},
				{
					id: 'user:bad',
					name: 'Bad',
					target: 'planet',
					scope: { folders: [], includeSubfolders: true },
					filters: {},
				},
			],
		}),
	);
	const ids = imported.queries.map((query) => query.id);
	assert.deepEqual(ids, ['user:file', 'user:folder']);
});
