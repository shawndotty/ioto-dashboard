import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { measuresForObject, resolveMeasure, measureLabelKey } = await load(
	'../../src/dashboard/dataset/measures.ts',
);
const { resolveSettingOptions, coerceSettingValue } = await load(
	'../../src/dashboard/registry.ts',
);
const { kpiComponent } = await load('../../src/dashboard/components/kpi.ts');
const { tableComponent } = await load('../../src/dashboard/components/table.ts');

function query(target) {
	return {
		id: `builtin:${target}`,
		name: `${target} query`,
		target,
		scope: { folders: [], includeSubfolders: true },
		filters: {},
	};
}

const QUERY_IDS = new Set([
	'builtin:tasks-all',
	'builtin:files-all',
	'builtin:folders-all',
	'builtin:notes-all',
]);

function measureSetting() {
	const setting = kpiComponent.settings.find((item) => item.key === 'measure');
	assert.equal(setting.kind, 'select');
	return setting;
}

function basisSetting() {
	const setting = kpiComponent.settings.find((item) => item.key === 'basis');
	assert.equal(setting.kind, 'basis');
	return setting;
}

test('measures are scoped per object', () => {
	assert.deepEqual(measuresForObject('task'), [
		'count',
		'completed',
		'open',
		'ratio',
	]);
	assert.deepEqual(measuresForObject('note'), ['count']);
	assert.deepEqual(measuresForObject('file'), ['count', 'size', 'mtime']);
	assert.deepEqual(measuresForObject('folder'), ['count', 'mtime']);
});

test('measuresForObject returns a copy, not the declared array', () => {
	const measures = measuresForObject('file');
	measures.push('ratio');
	assert.deepEqual(measuresForObject('file'), ['count', 'size', 'mtime']);
});

test('resolveMeasure falls back to count for unsupported or missing values', () => {
	assert.equal(resolveMeasure('size', 'file'), 'size');
	assert.equal(resolveMeasure('ratio', 'file'), 'count');
	assert.equal(resolveMeasure('size', 'folder'), 'count');
	assert.equal(resolveMeasure(undefined, 'task'), 'count');
	assert.equal(resolveMeasure('timeline', 'task'), 'count');
});

test('measure labels use the latest-mtime wording for KPI numbers', () => {
	assert.equal(measureLabelKey('mtime'), 'DATASET_MEASURE_LATEST_MTIME');
	assert.equal(measureLabelKey('size'), 'DATASET_MEASURE_SIZE');
	assert.equal(measureLabelKey('series'), 'DATASET_MEASURE_COUNT');
});

test('resolveSettingOptions supports static and function options', () => {
	const staticSetting = {
		key: 'textAlign',
		kind: 'select',
		group: 'style',
		labelKey: 'SETTING_TEXT_ALIGN',
		options: [{ value: 'left', labelKey: 'SETTING_ALIGN_LEFT' }],
		fallback: 'left',
	};
	assert.deepEqual(resolveSettingOptions(staticSetting), [
		{ value: 'left', labelKey: 'SETTING_ALIGN_LEFT' },
	]);

	const dynamicSetting = {
		key: 'measure',
		kind: 'select',
		group: 'data',
		labelKey: 'SETTING_MEASURE',
		options: ({ query: current }) =>
			measuresForObject(current?.target === 'file' ? 'file' : 'task').map(
				(value) => ({ value, labelKey: value }),
			),
		fallback: 'count',
	};
	assert.deepEqual(
		resolveSettingOptions(dynamicSetting, { query: query('file') }).map(
			(option) => option.value,
		),
		['count', 'size', 'mtime'],
	);
	assert.deepEqual(
		resolveSettingOptions(dynamicSetting).map((option) => option.value),
		['count', 'completed', 'open', 'ratio'],
	);
});

test('KPI rejects measures the current object cannot produce', () => {
	const setting = measureSetting();
	assert.deepEqual(
		coerceSettingValue(setting, 'size', QUERY_IDS, query('file')),
		{ measure: 'size' },
	);
	assert.deepEqual(
		coerceSettingValue(setting, 'ratio', QUERY_IDS, query('file')),
		{},
	);
	assert.deepEqual(
		coerceSettingValue(setting, 'ratio', QUERY_IDS, query('task')),
		{ measure: 'ratio' },
	);
	assert.deepEqual(
		coerceSettingValue(setting, 'size', QUERY_IDS, query('task')),
		{},
	);
});

test('KPI exposes a dynamic measure list', () => {
	const setting = measureSetting();
	assert.equal(typeof setting.options, 'function');
	const fileOptions = resolveSettingOptions(setting, {
		query: query('file'),
	});
	assert.deepEqual(
		fileOptions.map((option) => option.value),
		['count', 'size', 'mtime'],
	);
	assert.deepEqual(
		fileOptions.map((option) => option.labelKey),
		['DATASET_MEASURE_COUNT', 'DATASET_MEASURE_SIZE', 'DATASET_MEASURE_LATEST_MTIME'],
	);
});

test('KPI only shows the basis row for task queries', () => {
	const setting = basisSetting();
	assert.equal(setting.when({ type: 'kpi' }, { query: query('task') }), true);
	assert.equal(setting.when({ type: 'kpi' }, { query: query('file') }), false);
	assert.equal(
		setting.when({ type: 'kpi' }, { query: query('folder') }),
		false,
	);
	assert.equal(setting.when({ type: 'kpi' }), true);
});

test('KPI requests carry basis only for task queries', () => {
	const config = {
		id: 'component:1',
		type: 'kpi',
		queryId: 'builtin:files-all',
		basis: 'section',
		measure: 'size',
	};
	assert.deepEqual(kpiComponent.toDatasetRequest(config, query('file')), {
		object: 'file',
		measure: 'size',
		queryId: 'builtin:files-all',
	});
	assert.deepEqual(
		kpiComponent.toDatasetRequest(
			{ ...config, queryId: 'builtin:tasks-all' },
			query('task'),
		),
		{
			object: 'task',
			measure: 'count',
			queryId: 'builtin:tasks-all',
			basis: 'section',
		},
	);
	assert.equal(
		kpiComponent.toDatasetRequest(
			{ ...config, queryId: 'builtin:tasks-all', basis: undefined, measure: 'ratio' },
			query('task'),
		).basis,
		'file',
	);
});

function tableSetting(key) {
	const setting = tableComponent.settings.find((item) => item.key === key);
	assert.ok(setting, `table is missing the ${key} setting`);
	return setting;
}

test('table exposes measures derived from the query object', () => {
	const setting = tableSetting('measure');
	assert.equal(setting.kind, 'select');
	assert.equal(typeof setting.options, 'function');
	assert.deepEqual(
		resolveSettingOptions(setting, { query: query('task') }).map(
			(option) => option.value,
		),
		['count', 'completed', 'open', 'ratio'],
	);
	assert.deepEqual(
		resolveSettingOptions(setting, { query: query('file') }).map(
			(option) => option.value,
		),
		['count', 'size', 'mtime'],
	);
	assert.deepEqual(
		resolveSettingOptions(setting, { query: query('folder') }).map(
			(option) => option.value,
		),
		['count', 'mtime'],
	);
	assert.deepEqual(
		resolveSettingOptions(setting, { query: query('note') }).map(
			(option) => option.value,
		),
		['count'],
	);
});

test('table requests normalise a stale measure and keep a fixed row cap', () => {
	const stale = {
		id: 'component:1',
		type: 'table',
		queryId: 'builtin:files-all',
		measure: 'completed',
	};
	const request = tableComponent.toDatasetRequest(stale, query('file'));
	assert.equal(request.object, 'file');
	assert.equal(request.measure, 'count');
	assert.equal(request.limit, 2000);
	assert.equal(request.basis, undefined);

	const taskRequest = tableComponent.toDatasetRequest(
		{ ...stale, queryId: 'builtin:tasks-all', measure: 'ratio' },
		query('task'),
	);
	assert.equal(taskRequest.measure, 'ratio');
	assert.equal(taskRequest.basis, 'file');
});

test('table only offers grouping dimensions the object can group by', () => {
	const setting = tableSetting('groupBy');
	assert.equal(setting.target, 'options');
	const values = (target) =>
		resolveSettingOptions(setting, { query: query(target) }).map(
			(option) => option.value,
		);
	assert.deepEqual(values('task'), ['none', 'project', 'section', 'status']);
	assert.deepEqual(values('note'), ['none', 'ioType', 'folder']);
	assert.deepEqual(values('file'), ['none', 'extension', 'folder']);
	assert.deepEqual(values('folder'), ['none']);
	assert.deepEqual(coerceSettingValue(setting, 'status', QUERY_IDS, query('task')), {
		options: { groupBy: 'status' },
	});
	assert.deepEqual(coerceSettingValue(setting, 'status', QUERY_IDS, query('note')), {});
});
