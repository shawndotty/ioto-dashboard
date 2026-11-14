import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { heatmapComponent, heatmapRangeOf, heatmapDateFieldOptions } = await load(
	'../../src/dashboard/components/heatmap.ts',
);
const { queryTargetsFor } = await load('../../src/dashboard/registry.ts');
const { createComponentRegistry } = await load(
	'../../src/dashboard/components/index.ts',
);

function query(target) {
	return {
		id: `builtin:${target}`,
		name: `${target} query`,
		target,
		scope: { folders: [], includeSubfolders: true },
		filters: {},
	};
}

function settingOf(key) {
	const setting = heatmapComponent.settings.find((item) => item.key === key);
	assert.ok(setting, `heatmap is missing the ${key} setting`);
	return setting;
}

test('heatmap is registered with its picker contract', () => {
	const registered = createComponentRegistry().get('heatmap');
	assert.ok(registered, 'registry should expose heatmap');
	assert.equal(registered.icon, 'calendar-days');
	assert.equal(registered.category, 'analysis');
	assert.equal(registered.measureDefault, 'timeline');
	assert.deepEqual(queryTargetsFor(registered), ['task', 'note', 'file']);
	assert.equal(registered.views, undefined);
});

test('createConfig writes the documented defaults', () => {
	const config = heatmapComponent.createConfig('builtin:tasks-all');
	assert.equal(config.queryId, 'builtin:tasks-all');
	assert.equal(config.measure, 'timeline');
	assert.equal(config.w, 6);
	assert.equal(config.h, 3);
	assert.deepEqual(config.options, {
		range: '30',
		dateField: 'modified',
		layout: 'auto',
		fill: 'center',
		showMonthLabels: true,
		showWeekdayLabels: true,
		showLegend: true,
		showSummary: true,
	});
});

test('the query setting leads and the title setting is present', () => {
	assert.equal(heatmapComponent.settings[0].kind, 'query');
	assert.ok(heatmapComponent.settings.some((item) => item.key === 'title'));
});

test('fill offers center and stretch and follows layout', () => {
	const fill = settingOf('fill');
	assert.equal(fill.kind, 'select');
	assert.equal(fill.fallback, 'center');
	assert.equal(fill.target, 'options');
	assert.deepEqual(
		fill.options.map((option) => option.value),
		['center', 'stretch'],
	);

	const keys = heatmapComponent.settings.map((item) => item.key);
	assert.equal(keys.indexOf('fill'), keys.indexOf('layout') + 1);
});

test('range rejects unknown values and keeps all six options', () => {
	assert.equal(heatmapRangeOf('7'), 7);
	assert.equal(heatmapRangeOf('14'), 14);
	assert.equal(heatmapRangeOf(30), 30);
	assert.equal(heatmapRangeOf('90'), 90);
	assert.equal(heatmapRangeOf('180'), 180);
	assert.equal(heatmapRangeOf('365'), 365);
	assert.equal(heatmapRangeOf(undefined), 30);
	assert.equal(heatmapRangeOf('45'), 30);
	assert.equal(heatmapRangeOf('abc'), 30);

	const range = settingOf('range');
	assert.deepEqual(
		range.options.map((option) => option.value),
		['7', '14', '30', '90', '180', '365'],
	);
});

test('requests always use daily timeline buckets', () => {
	const request = heatmapComponent.toDatasetRequest(
		heatmapComponent.createConfig('builtin:tasks-all'),
		query('task'),
	);
	assert.equal(request.object, 'task');
	assert.equal(request.measure, 'timeline');
	assert.equal(request.range, 30);
	assert.deepEqual(request.timeline, { bucket: 'day', dateField: 'modified' });

	const note = heatmapComponent.toDatasetRequest(
		{ queryId: 'builtin:note', options: { range: '14', dateField: 'created' } },
		query('note'),
	);
	assert.equal(note.object, 'note');
	assert.equal(note.range, 14);
	assert.equal(note.timeline.dateField, 'created');
});

test('file queries treat auto as modified and unsupported targets as task', () => {
	const auto = heatmapComponent.toDatasetRequest(
		{ queryId: 'builtin:file', options: { dateField: 'auto' } },
		query('file'),
	);
	assert.equal(auto.object, 'file');
	assert.equal(auto.timeline.dateField, 'modified');

	const folder = heatmapComponent.toDatasetRequest(
		{ queryId: 'builtin:folder', options: {} },
		query('folder'),
	);
	assert.equal(folder.object, 'task');
});

test('date field options narrow for file queries', () => {
	assert.deepEqual(
		heatmapDateFieldOptions(query('file')).map((option) => option.value),
		['created', 'modified'],
	);
	assert.deepEqual(
		heatmapDateFieldOptions(query('task')).map((option) => option.value),
		['auto', 'filename', 'created', 'modified'],
	);
	for (const value of ['created', 'modified']) {
		assert.ok(
			heatmapDateFieldOptions(query('file')).some(
				(option) => option.value === value,
			),
			`file query should offer ${value}`,
		);
	}
});

test('empty datasets come from the window total, not the row count', () => {
	assert.equal(heatmapComponent.isEmptyDataset({ sourceTotal: 0, total: 5 }), true);
	assert.equal(heatmapComponent.isEmptyDataset({ total: 0 }), true);
	assert.equal(heatmapComponent.isEmptyDataset({ sourceTotal: 12, total: 12 }), false);
	assert.equal(heatmapComponent.isEmpty(), false);
});
