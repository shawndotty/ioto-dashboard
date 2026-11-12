import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { barChartComponent } = await load(
	'../../src/dashboard/components/bar-chart.ts',
);
const { yFormatOptionsForField } = await load(
	'../../src/dashboard/dataset/charts/settings.ts',
);

function settingOf(key) {
	const setting = barChartComponent.settings.find((item) => item.key === key);
	assert.ok(setting, `bar chart is missing the ${key} setting`);
	return setting;
}

function values(options) {
	return options.map((option) => option.value);
}

test('shared y format options stay field aware', () => {
	assert.deepEqual(values(yFormatOptionsForField('size')), ['auto']);
	assert.deepEqual(values(yFormatOptionsForField('completed')), [
		'auto',
		'number',
		'compact',
	]);
});

test('bar settings split into X and Y sections', () => {
	for (const key of [
		'xField',
		'xShowLabels',
		'xRotate',
		'xSort',
		'xTitle',
		'topN',
	]) {
		assert.equal(settingOf(key).group, 'axesX', `${key} belongs to axesX`);
	}
	for (const key of [
		'yField',
		'yShowLabels',
		'yShowGrid',
		'yScale',
		'yMin',
		'yMax',
		'yFormat',
		'yTitle',
	]) {
		assert.equal(settingOf(key).group, 'axesY', `${key} belongs to axesY`);
	}
});

test('yFormat follows the y field and refreshes with it', () => {
	const yFormat = settingOf('yFormat');
	assert.equal(yFormat.group, 'axesY');
	assert.deepEqual(
		values(yFormat.options({ config: { options: { yField: 'size' } } })),
		['auto'],
	);
	assert.deepEqual(
		values(yFormat.options({ config: { options: { yField: 'completed' } } })),
		['auto', 'number', 'compact'],
	);
	assert.deepEqual(yFormat.refreshOn, ['yField']);
});

test('yScale explains the manual range and bars carry it too', () => {
	const yScale = settingOf('yScale');
	assert.equal(yScale.hintKey, 'SETTING_AXIS_Y_SCALE_HINT');
});

test('the bar data list is off by default and opt-in', () => {
	const config = barChartComponent.createConfig('builtin:tasks-all');
	assert.equal(config.options.showLabels, false);
	assert.equal(config.options.showValueLabels, false);

	const showLabels = settingOf('showLabels');
	assert.equal(showLabels.kind, 'toggle');
	assert.equal(showLabels.group, 'display');
	assert.equal(showLabels.fallback, false);
	assert.equal(showLabels.labelKey, 'SETTING_SHOW_DATA_LIST');
});
