import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { treemapChartComponent } = await load(
	'../../src/dashboard/components/treemap-chart.ts',
);
const { createComponentRegistry } = await load(
	'../../src/dashboard/components/index.ts',
);
const { TREEMAP_ROW_CAP } = await load(
	'../../src/dashboard/dataset/charts/treemap-spec.ts',
);
const {
	treemapObjectForQuery,
	objectForComponentType,
} = await load('../../src/dashboard/dataset/object.ts');

function settingOf(key) {
	const setting = treemapChartComponent.settings.find(
		(item) => item.key === key,
	);
	assert.ok(setting, `treemap chart is missing the ${key} setting`);
	return setting;
}

test('treemap chart registers with the treemap view', () => {
	const registry = createComponentRegistry();
	assert.equal(registry.get('treemap-chart').type, 'treemap-chart');
	assert.equal(registry.get('treemap-chart').views[0], 'treemap');
	assert.deepEqual(treemapChartComponent.views, ['treemap']);
	assert.deepEqual(treemapChartComponent.queryTargets, [
		'task',
		'note',
		'file',
		'folder',
	]);
	assert.equal(treemapChartComponent.icon, 'layout-grid');
});

test('createConfig writes the documented defaults', () => {
	const created = treemapChartComponent.createConfig('builtin:tasks-all');
	assert.equal(created.view, 'treemap');
	assert.equal(created.measure, 'count');
	assert.equal(created.w, 6);
	assert.equal(created.h, 4);
	assert.deepEqual(created.options, {
		noteGroupBy: 'folder',
		xField: 'name',
		yField: 'completed',
		yFormat: 'auto',
		groupField: 'auto',
		topN: 30,
		labelMode: 'name',
		showLegend: false,
	});
});

test('treemap axes are a category field and a numeric field', () => {
	const x = settingOf('xField');
	assert.equal(x.kind, 'field');
	assert.equal(x.role, 'x');
	assert.equal(x.fallback, 'name');
	assert.deepEqual(x.refreshOn, ['noteGroupBy']);

	const y = settingOf('yField');
	assert.equal(y.kind, 'field');
	assert.equal(y.role, 'y');
	assert.equal(y.fallback, 'completed');
	assert.deepEqual(y.refreshOn, ['noteGroupBy']);

	const format = settingOf('yFormat');
	assert.equal(format.kind, 'select');
	assert.deepEqual(format.refreshOn, ['yField']);
	assert.equal(format.fallback, 'auto');
});

test('note grouping is selectable only for note queries', () => {
	const setting = settingOf('noteGroupBy');
	assert.equal(setting.kind, 'select');
	assert.equal(setting.target, 'options');
	assert.deepEqual(
		setting.options.map((option) => option.value),
		['folder', 'project'],
	);
	assert.equal(setting.when(undefined, { query: { target: 'task' } }), false);
	assert.equal(setting.when(undefined, { query: { target: 'note' } }), true);
	assert.equal(setting.when(undefined, {}), false);

	const group = settingOf('groupField');
	assert.equal(group.kind, 'select');
	assert.equal(group.fallback, 'auto');
	assert.deepEqual(group.refreshOn, ['noteGroupBy']);
	const values = group.options({
		query: { target: 'note' },
		config: { options: { noteGroupBy: 'folder' } },
	}).map((option) => option.value);
	assert.deepEqual(values.slice(0, 2), ['auto', 'none']);
	assert.ok(values.includes('folder'));
});

test('topN and label mode stay within their contracts', () => {
	const topN = settingOf('topN');
	assert.equal(topN.kind, 'number');
	assert.equal(topN.min, 1);
	assert.equal(topN.max, 200);
	assert.equal(topN.fallback, 30);

	const labels = settingOf('labelMode');
	assert.deepEqual(
		labels.options.map((option) => option.value),
		['name', 'value', 'both', 'none'],
	);
	assert.equal(labels.fallback, 'name');

	assert.equal(settingOf('showLegend').fallback, false);
});

test('treemapObjectForQuery maps targets and note grouping', () => {
	assert.equal(treemapObjectForQuery({ target: 'task' }), 'project');
	assert.equal(treemapObjectForQuery({ target: 'note' }), 'note');
	assert.equal(
		treemapObjectForQuery({ target: 'note' }, { noteGroupBy: 'project' }),
		'project',
	);
	assert.equal(treemapObjectForQuery({ target: 'file' }), 'file');
	assert.equal(treemapObjectForQuery({ target: 'folder' }), 'folder');
	assert.equal(treemapObjectForQuery(undefined), 'project');
	assert.equal(
		objectForComponentType('treemap-chart', { target: 'note' }, {}),
		'note',
	);
	assert.equal(
		objectForComponentType(
			'treemap-chart',
			{ target: 'note' },
			{ noteGroupBy: 'project' },
		),
		'project',
	);
});

test('toDatasetRequest mirrors the render object and caps rows', () => {
	const config = {
		...treemapChartComponent.createConfig('builtin:tasks-all'),
		options: {
			...treemapChartComponent.createConfig('builtin:tasks-all').options,
			noteGroupBy: 'project',
		},
	};
	const request = treemapChartComponent.toDatasetRequest(
		config,
		{ target: 'note' },
	);
	assert.equal(request.object, 'project');
	assert.equal(request.measure, 'count');
	assert.equal(request.queryId, 'builtin:tasks-all');
	assert.equal(request.limit, TREEMAP_ROW_CAP);
	assert.equal(TREEMAP_ROW_CAP, 500);
});