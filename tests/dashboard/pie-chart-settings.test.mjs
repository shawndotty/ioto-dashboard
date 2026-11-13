import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { pieChartComponent, donutChartComponent } = await load(
	'../../src/dashboard/components/pie-chart.ts',
);
const { createComponentRegistry } = await load(
	'../../src/dashboard/components/index.ts',
);

function settingOf(component, key) {
	const setting = component.settings.find((item) => item.key === key);
	assert.ok(setting, `${component.type} is missing the ${key} setting`);
	return setting;
}

test('both pie and donut components register', () => {
	const registry = createComponentRegistry();
	assert.equal(registry.get('pie-chart').type, 'pie-chart');
	assert.equal(registry.get('donut-chart').type, 'donut-chart');
	assert.equal(registry.get('pie-chart').views[0], 'pie');
	assert.equal(registry.get('donut-chart').views[0], 'donut');
});

test('createConfig seeds shared defaults and the right view', () => {
	for (const [component, view] of [
		[pieChartComponent, 'pie'],
		[donutChartComponent, 'donut'],
	]) {
		const created = component.createConfig('builtin:tasks-all');
		assert.equal(created.view, view);
		assert.equal(created.measure, 'count');
		assert.deepEqual(component.views, [view]);
		assert.equal(component.viewDefault, view);
		assert.equal(created.options.topN, 8);
		assert.equal(created.options.labelMode, 'percent');
		assert.equal(created.options.showLegend, true);
		assert.equal(created.options.xField, 'name');
		assert.equal(created.options.yField, 'completed');
	}
});

test('innerRadius only appears for the donut', () => {
	const setting = settingOf(pieChartComponent, 'innerRadius');
	const donutSetting = donutChartComponent.settings.find(
		(item) => item.key === 'innerRadius',
	);
	assert.ok(donutSetting);
	assert.equal(donutSetting.labelKey, setting.labelKey);
	assert.equal(donutSetting.fallback, setting.fallback);
	assert.equal(setting.when({ type: 'donut-chart' }), true);
	assert.equal(setting.when({ type: 'pie-chart' }), false);
	assert.equal(setting.min, 0.35);
	assert.equal(setting.max, 0.8);
	assert.equal(setting.integer, false);
});

test('topN and label mode expose the declared ranges', () => {
	const topN = settingOf(pieChartComponent, 'topN');
	assert.equal(topN.kind, 'number');
	assert.equal(topN.min, 1);
	assert.equal(topN.max, 50);
	assert.equal(topN.fallback, 8);

	const labelMode = settingOf(pieChartComponent, 'labelMode');
	assert.deepEqual(
		labelMode.options.map((option) => option.value),
		['percent', 'value', 'both', 'none'],
	);
});

test('pie datasets aggregate task/note queries per project', () => {
	for (const query of [{ target: 'task' }, { target: 'note' }]) {
		assert.equal(
			pieChartComponent.toDatasetRequest(
				{ queryId: 'q' },
				query,
			).object,
			'project',
		);
	}
	assert.equal(
		pieChartComponent.toDatasetRequest(
			{ queryId: 'q' },
			{ target: 'file' },
		).object,
		'file',
	);
});
