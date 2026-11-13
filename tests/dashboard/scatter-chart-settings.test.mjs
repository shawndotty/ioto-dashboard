import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { scatterChartComponent } = await load(
	'../../src/dashboard/components/scatter-chart.ts',
);
const { createComponentRegistry } = await load(
	'../../src/dashboard/components/index.ts',
);
const {
	scatterObjectForQuery,
	objectForComponentType,
} = await load('../../src/dashboard/dataset/object.ts');
const { fieldAxisFor, columnMatchesAxis } = await load(
	'../../src/dashboard/dataset/field-roles.ts',
);

function settingOf(key) {
	const setting = scatterChartComponent.settings.find(
		(item) => item.key === key,
	);
	assert.ok(setting, `scatter chart is missing the ${key} setting`);
	return setting;
}

test('scatter chart registers with the scatter view', () => {
	const registry = createComponentRegistry();
	assert.equal(registry.get('scatter-chart').type, 'scatter-chart');
	assert.equal(registry.get('scatter-chart').views[0], 'scatter');

	const created = scatterChartComponent.createConfig('builtin:tasks-all');
	assert.equal(created.view, 'scatter');
	assert.deepEqual(scatterChartComponent.views, ['scatter']);
	assert.deepEqual(scatterChartComponent.objects, ['task', 'note', 'folder']);
	assert.equal(created.options.limit, 500);
	assert.equal(created.options.pointSize, 3.5);
	assert.equal(created.options.showPointLabels, false);
});

test('scatter axes are numeric fields', () => {
	for (const key of ['xField', 'yField']) {
		const setting = settingOf(key);
		assert.equal(setting.kind, 'field');
		assert.equal(setting.axisType, 'number');
	}
	assert.equal(settingOf('xField').role, 'x');
	assert.equal(settingOf('yField').role, 'y');
});

test('point count range is 50–2000', () => {
	const limit = settingOf('limit');
	assert.equal(limit.kind, 'number');
	assert.equal(limit.min, 50);
	assert.equal(limit.max, 2000);
	assert.equal(limit.fallback, 500);

	const pointSize = settingOf('pointSize');
	assert.equal(pointSize.min, 2);
	assert.equal(pointSize.max, 6);
	assert.equal(pointSize.integer, false);
});

test('scatterObjectForQuery keeps detail objects and falls back for tasks', () => {
	assert.equal(scatterObjectForQuery({ target: 'task' }), 'project');
	assert.equal(scatterObjectForQuery({ target: 'note' }), 'note');
	assert.equal(scatterObjectForQuery({ target: 'folder' }), 'folder');
	assert.equal(scatterObjectForQuery({ target: 'file' }), 'file');
	assert.equal(scatterObjectForQuery(undefined), 'project');
	assert.equal(scatterObjectForQuery(undefined, 'note'), 'note');
});

test('objectForComponentType routes each chart family', () => {
	assert.equal(objectForComponentType('bar-chart', { target: 'task' }), 'project');
	assert.equal(objectForComponentType('pie-chart', { target: 'note' }), 'project');
	assert.equal(
		objectForComponentType('donut-chart', { target: 'task' }),
		'project',
	);
	assert.equal(
		objectForComponentType('scatter-chart', { target: 'note' }),
		'note',
	);
	assert.equal(objectForComponentType('kpi', { target: 'folder' }), 'folder');
});

test('field axis defaults and matching stay in one place', () => {
	assert.equal(fieldAxisFor({ role: 'y' }), 'number');
	assert.equal(fieldAxisFor({ role: 'x' }), 'category');
	assert.equal(fieldAxisFor({ role: 'x', axisType: 'number' }), 'number');
	assert.equal(fieldAxisFor({ role: 'y', axisType: 'category' }), 'category');

	const number = { key: 'n', labelKey: 'N', type: 'number' };
	const text = { key: 't', labelKey: 'T', type: 'text' };
	const date = { key: 'd', labelKey: 'D', type: 'date' };
	const size = { key: 's', labelKey: 'S', type: 'size' };

	assert.equal(columnMatchesAxis(number, 'number'), true);
	assert.equal(columnMatchesAxis(size, 'number'), true);
	assert.equal(columnMatchesAxis(text, 'number'), false);
	assert.equal(columnMatchesAxis(text, 'category'), true);
	assert.equal(columnMatchesAxis(date, 'category'), true);
	assert.equal(columnMatchesAxis(number, 'category'), false);
});
