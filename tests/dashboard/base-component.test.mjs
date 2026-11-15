import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { baseComponent } = await load(
	'../../src/dashboard/components/base.ts',
);

test('the base component is queryless and never requests data', () => {
	assert.equal(baseComponent.type, 'base');
	assert.equal(baseComponent.queryless, true);
	assert.equal(baseComponent.defaultQueryId, '');
	assert.equal(baseComponent.toMetricRequest, undefined);
	assert.equal(baseComponent.toDatasetRequest, undefined);
});

test('base createConfig starts empty with a visible toolbar', () => {
	assert.deepEqual(baseComponent.createConfig(''), {
		queryId: '',
		options: { basePath: '', view: '', hideToolbar: false },
		w: 6,
		h: 5,
	});
});

test('base declares a title and three options-backed settings', () => {
	const title = baseComponent.settings.find(
		(setting) => setting.key === 'title',
	);
	assert.equal(title.kind, 'text');
	const optionKeys = baseComponent.settings
		.filter((setting) => setting.target === 'options')
		.map((setting) => setting.key);
	assert.deepEqual(optionKeys, ['basePath', 'view', 'hideToolbar']);
	const file = baseComponent.settings.find(
		(setting) => setting.key === 'basePath',
	);
	assert.equal(file.kind, 'target');
	assert.equal(file.picker, 'base');
	const view = baseComponent.settings.find(
		(setting) => setting.key === 'view',
	);
	assert.equal(view.picker, 'baseView');
	const toolbar = baseComponent.settings.find(
		(setting) => setting.key === 'hideToolbar',
	);
	assert.equal(toolbar.kind, 'toggle');
	assert.equal(toolbar.fallback, false);
	assert.ok(!baseComponent.settings.some((s) => s.kind === 'query'));
});

test('the base card has no empty state and a distinct picker icon', () => {
	assert.equal(baseComponent.isEmpty(), false);
	assert.equal(baseComponent.icon, 'table-2');
});