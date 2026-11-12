import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	lineChartComponent,
	bucketOptionsForRange,
	xLabelFormatOptionsForBucket,
} = await load('../../src/dashboard/components/line-chart.ts');
const { yFormatOptionsForField } = await load(
	'../../src/dashboard/dataset/charts/settings.ts',
);
const { coerceSettingValue } = await load('../../src/dashboard/registry.ts');

function query(target) {
	return {
		id: `builtin:${target}`,
		name: `${target} query`,
		target,
		scope: { folders: [], includeSubfolders: true },
		filters: {},
	};
}

const QUERY_IDS = new Set(['builtin:task', 'builtin:note', 'builtin:file']);

function settingOf(key) {
	const setting = lineChartComponent.settings.find((item) => item.key === key);
	assert.ok(setting, `line chart is missing the ${key} setting`);
	return setting;
}

function values(options) {
	return options.map((option) => option.value);
}

test('bucket options narrow with the range', () => {
	assert.deepEqual(values(bucketOptionsForRange(7)), ['day']);
	assert.deepEqual(values(bucketOptionsForRange('30')), ['day', 'week']);
	assert.deepEqual(values(bucketOptionsForRange(90)), [
		'day',
		'week',
		'month',
	]);
	assert.deepEqual(values(bucketOptionsForRange(180)), [
		'day',
		'week',
		'month',
	]);
	assert.deepEqual(values(bucketOptionsForRange(undefined)), [
		'day',
		'week',
	]);
});

test('month buckets swap the label formats for month ones', () => {
	const month = xLabelFormatOptionsForBucket('month');
	assert.deepEqual(values(month), ['iso', 'short', 'md']);
	assert.deepEqual(
		month.map((option) => option.labelKey),
		['AXIS_MONTH_ISO', 'AXIS_MONTH_SHORT', 'AXIS_MONTH_MD'],
	);

	for (const bucket of ['day', 'week']) {
		const options = xLabelFormatOptionsForBucket(bucket);
		assert.deepEqual(values(options), ['iso', 'md', 'short']);
		assert.deepEqual(
			options.map((option) => option.labelKey),
			['AXIS_DATE_ISO', 'AXIS_DATE_MD', 'AXIS_DATE_SHORT'],
		);
	}
});

test('size fields only offer the automatic number format', () => {
	assert.deepEqual(values(yFormatOptionsForField('size')), ['auto']);
	assert.deepEqual(values(yFormatOptionsForField('total')), [
		'auto',
		'number',
		'compact',
	]);
});

test('settings wire their dynamic options and refresh keys', () => {
	const bucket = settingOf('bucket');
	assert.equal(bucket.group, 'axesX');
	assert.deepEqual(values(bucket.options({ config: { options: { range: '7' } } })), [
		'day',
	]);
	assert.deepEqual(bucket.refreshOn, ['range']);

	const xFormat = settingOf('xLabelFormat');
	assert.equal(xFormat.group, 'axesX');
	assert.deepEqual(
		values(xFormat.options({ config: { options: { bucket: 'month' } } })),
		['iso', 'short', 'md'],
	);
	assert.deepEqual(xFormat.refreshOn, ['bucket']);

	const yFormat = settingOf('yFormat');
	assert.equal(yFormat.group, 'axesY');
	assert.deepEqual(
		values(yFormat.options({ config: { options: { yField: 'size' } } })),
		['auto'],
	);
	assert.deepEqual(yFormat.refreshOn, ['yField']);
});

test('series toggles follow the query object', () => {
	const completed = settingOf('ySeriesCompleted');
	const open = settingOf('ySeriesOpen');
	for (const [target, expectCompleted, expectOpen] of [
		['task', true, true],
		['note', true, false],
		['file', false, false],
	]) {
		const context = { query: query(target), config: {} };
		assert.equal(
			completed.when(undefined, context),
			expectCompleted,
			`${target} completed toggle`,
		);
		assert.equal(
			open.when(undefined, context),
			expectOpen,
			`${target} open toggle`,
		);
	}
});

test('coercing a number format rejects it for size fields', () => {
	const setting = settingOf('yFormat');
	const config = { options: { yField: 'size' } };
	assert.deepEqual(
		coerceSettingValue(setting, 'number', QUERY_IDS, query('file'), config),
		{},
	);
	assert.deepEqual(
		coerceSettingValue(setting, 'compact', QUERY_IDS, query('file'), config),
		{},
	);
	assert.deepEqual(
		coerceSettingValue(
			setting,
			'number',
			QUERY_IDS,
			query('file'),
			{ options: { yField: 'total' } },
		),
		{ options: { yFormat: 'number' } },
	);
});

test('coercing a bucket rejects it for the current range', () => {
	const setting = settingOf('bucket');
	assert.deepEqual(
		coerceSettingValue(
			setting,
			'month',
			QUERY_IDS,
			query('task'),
			{ options: { range: '7' } },
		),
		{},
	);
	assert.deepEqual(
		coerceSettingValue(
			setting,
			'month',
			QUERY_IDS,
			query('task'),
			{ options: { range: '90' } },
		),
		{ options: { bucket: 'month' } },
	);
});

test('file queries resolve auto to modified time', () => {
	const base = { queryId: 'builtin:file', options: { range: '30' } };
	assert.equal(
		lineChartComponent.toDatasetRequest(base, query('file')).timeline.dateField,
		'modified',
	);
	assert.equal(
		lineChartComponent.toDatasetRequest(
			{ ...base, options: { ...base.options, dateField: 'created' } },
			query('file'),
		).timeline.dateField,
		'created',
	);
	assert.equal(
		lineChartComponent.toDatasetRequest(base, query('task')).timeline.dateField,
		'auto',
	);
});
