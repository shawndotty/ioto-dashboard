import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buildLineSpec, buildBarSpec } = await load(
	'../../src/dashboard/dataset/charts/spec.ts',
);

function cell(text, sortValue) {
	return sortValue === undefined ? { text } : { text, sortValue };
}

function dataset(object, columns, rows, extra = {}) {
	return {
		object,
		measure: 'count',
		columns,
		rows: rows.map((cells, index) => ({ id: `${object}:${index}`, cells })),
		total: rows.length,
		truncated: false,
		...extra,
	};
}

const TASK_COLUMNS = [
	{ key: 'date', labelKey: 'DATASET_COL_DATE', type: 'date' },
	{ key: 'total', labelKey: 'DATASET_COL_TASKS', type: 'number' },
	{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
	{ key: 'open', labelKey: 'DATASET_COL_OPEN', type: 'number' },
];

function taskDataset(entries) {
	return dataset(
		'task',
		TASK_COLUMNS,
		entries.map(([date, total, completed, open]) => ({
			date: cell(date, date),
			total: cell(String(total), total),
			completed: cell(String(completed), completed),
			open: cell(String(open), open),
		})),
	);
}

const PROJECT_COLUMNS = [
	{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
	{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
	{ key: 'ratio', labelKey: 'DATASET_COL_RATIO', type: 'percent' },
];

function projectDataset(entries) {
	return dataset(
		'project',
		PROJECT_COLUMNS,
		entries.map(([name, completed, ratio]) => ({
			name: cell(name),
			completed: cell(String(completed), completed),
			ratio: cell(`${Math.round(ratio * 100)}%`, ratio),
		})),
	);
}

test('line charts default to the total column and dedupe stacked series', () => {
	const data = taskDataset([
		['2026-11-08', 5, 2, 3],
		['2026-11-09', 7, 4, 3],
	]);

	const single = buildLineSpec(data, {}, { w: 600, h: 300 }, 'task');
	assert.ok(single);
	assert.deepEqual(
		single.series.map((series) => series.key),
		['total'],
	);

	const stacked = buildLineSpec(
		data,
		{ yField: 'total', ySeriesCompleted: true, ySeriesOpen: true },
		{ w: 600, h: 300 },
		'task',
	);
	assert.deepEqual(
		stacked.series.map((series) => series.key),
		['total', 'completed', 'open'],
	);
	assert.deepEqual(
		stacked.series.map((series) => series.colorIndex),
		[1, 2, 3],
	);

	const deduped = buildLineSpec(
		data,
		{ yField: 'completed', ySeriesCompleted: true },
		{ w: 600, h: 300 },
		'task',
	);
	assert.deepEqual(
		deduped.series.map((series) => series.key),
		['completed'],
	);
});

test('unknown y fields fall back to the object default and then any number', () => {
	const data = taskDataset([['2026-11-08', 5, 2, 3]]);
	const fallback = buildLineSpec(data, { yField: 'nope' }, { w: 600, h: 300 }, 'task');
	assert.equal(fallback.series[0].key, 'total');

	const renamed = dataset(
		'task',
		[
			{ key: 'date', labelKey: 'DATASET_COL_DATE', type: 'date' },
			{ key: 'count', labelKey: 'DATASET_COL_TASKS', type: 'number' },
		],
		[{ date: cell('2026-11-08', '2026-11-08'), count: cell('4', 4) }],
	);
	const firstNumber = buildLineSpec(renamed, {}, { w: 600, h: 300 }, 'task');
	assert.equal(firstNumber.series[0].key, 'count');
	assert.equal(firstNumber.series[0].points[0].value, 4);
});

test('date labels honour iso / md / short formats', () => {
	const data = taskDataset([['2026-11-08', 5, 2, 3]]);
	const iso = buildLineSpec(data, { xLabelFormat: 'iso' }, { w: 600, h: 300 }, 'task');
	const md = buildLineSpec(data, { xLabelFormat: 'md' }, { w: 600, h: 300 }, 'task');
	const short = buildLineSpec(
		data,
		{ xLabelFormat: 'short' },
		{ w: 600, h: 300 },
		'task',
	);
	assert.equal(iso.x.ticks[0].label, '2026-11-08');
	assert.equal(md.x.ticks[0].label, '11-08');
	assert.equal(short.x.ticks[0].label, '11/8');
	assert.equal(md.x.ticks[0].fullLabel, '2026-11-08');
});

test('manual Y domains apply, and invalid bounds fall back to auto', () => {
	const data = taskDataset([
		['2026-11-08', 1, 0, 1],
		['2026-11-09', 9, 4, 5],
	]);

	const manual = buildLineSpec(
		data,
		{ yScale: 'manual', yMin: 2, yMax: 8 },
		{ w: 600, h: 300 },
		'task',
	);
	assert.equal(manual.y.min, 2);
	assert.equal(manual.y.max, 8);
	for (const tick of manual.y.ticks) {
		assert.ok(tick.value >= 2 && tick.value <= 8);
	}

	const invalid = buildLineSpec(
		data,
		{ yScale: 'manual', yMin: 8, yMax: 2 },
		{ w: 600, h: 300 },
		'task',
	);
	assert.equal(invalid.y.min, 0);
	assert.equal(invalid.y.max, 10);
});

test('all-zero and single-point data still produce a usable chart', () => {
	const zero = taskDataset([
		['2026-11-08', 0, 0, 0],
		['2026-11-09', 0, 0, 0],
	]);
	const zeroSpec = buildLineSpec(zero, {}, { w: 600, h: 300 }, 'task');
	assert.equal(zeroSpec.y.min, 0);
	assert.equal(zeroSpec.y.max, 1);

	const single = taskDataset([['2026-11-08', 5, 2, 3]]);
	const singleSpec = buildLineSpec(single, {}, { w: 600, h: 300 }, 'task');
	assert.equal(
		singleSpec.series[0].points[0].x,
		singleSpec.plot.left + singleSpec.plot.width / 2,
	);
});

test('legend only shows for stacked series and can be disabled', () => {
	const data = taskDataset([['2026-11-08', 5, 2, 3]]);
	const single = buildLineSpec(data, {}, { w: 600, h: 300 }, 'task');
	assert.equal(single.showLegend, false);

	const stacked = buildLineSpec(
		data,
		{ ySeriesCompleted: true },
		{ w: 600, h: 300 },
		'task',
	);
	assert.equal(stacked.showLegend, true);

	const off = buildLineSpec(
		data,
		{ ySeriesCompleted: true, showLegend: false },
		{ w: 600, h: 300 },
		'task',
	);
	assert.equal(off.showLegend, false);
});

test('bars sort, truncate and report the hidden count', () => {
	const data = projectDataset([
		['A', 3, 0.3],
		['B', 1, 0.1],
		['C', 5, 0.5],
	]);
	const spec = buildBarSpec(
		data,
		{ xSort: 'value-desc', topN: 2, yField: 'completed' },
		{ w: 600, h: 300 },
		'project',
	);
	assert.deepEqual(
		spec.series[0].bars.map((bar) => bar.value),
		[5, 3],
	);
	assert.equal(spec.hiddenCount, 1);
	assert.equal(spec.valueList.length, 2);
	assert.deepEqual(
		spec.valueList.map((entry) => entry.label),
		['C', 'A'],
	);
	assert.equal(spec.x.ticks.length, 2);
});

test('ratio columns format as percentages', () => {
	const data = projectDataset([['A', 1, 0.5]]);
	const spec = buildBarSpec(data, { yField: 'ratio' }, { w: 600, h: 300 }, 'project');
	assert.equal(spec.y.format(0.5), '50%');
	assert.equal(spec.valueList[0].text, '50%');
});

test('bar defaults follow the object when no fields are stored', () => {
	const files = dataset(
		'file',
		[
			{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
			{ key: 'size', labelKey: 'DATASET_COL_SIZE', type: 'size' },
		],
		[
			{ name: cell('a.md'), size: cell('1 KB', 1024) },
			{ name: cell('b.md'), size: cell('2 KB', 2048) },
		],
	);
	const spec = buildBarSpec(files, {}, { w: 600, h: 300 }, 'file');
	assert.ok(spec);
	assert.equal(spec.series[0].key, 'size');
	assert.deepEqual(
		spec.series[0].bars.map((bar) => bar.value),
		[1024, 2048],
	);
	assert.deepEqual(
		spec.x.ticks.map((tick) => tick.label),
		['a.md', 'b.md'],
	);

	const notes = dataset(
		'note',
		[
			{ key: 'note', labelKey: 'DATASET_COL_NOTE', type: 'text' },
			{ key: 'tasks', labelKey: 'DATASET_COL_TASKS', type: 'number' },
		],
		[{ note: cell('Note A'), tasks: cell('2', 2) }],
	);
	const noteSpec = buildBarSpec(notes, {}, { w: 600, h: 300 }, 'note');
	assert.equal(noteSpec.series[0].key, 'tasks');
});

test('every bar keeps a matching X label', () => {
	const rows = Array.from({ length: 20 }, (_, index) => [
		`P${index + 1}`,
		index,
		index / 20,
	]);
	const spec = buildBarSpec(
		projectDataset(rows),
		{ yField: 'completed' },
		{ w: 600, h: 300 },
		'project',
	);
	assert.equal(spec.series[0].bars.length, 20);
	assert.equal(spec.x.ticks.length, 20);
	assert.equal(spec.valueList.length, 20);
});

test('narrow cards hide Y labels, titles and grid', () => {
	const data = taskDataset([['2026-11-08', 5, 2, 3]]);
	const spec = buildLineSpec(
		data,
		{ xTitle: 'Day', yTitle: 'Tasks', yShowGrid: true },
		{ w: 280, h: 160 },
		'task',
	);
	assert.equal(spec.y.showLabels, false);
	assert.equal(spec.y.grid, false);
	assert.equal(spec.x.title, undefined);
	assert.equal(spec.y.title, undefined);
});

test('empty datasets produce no spec', () => {
	assert.equal(
		buildLineSpec(dataset('task', TASK_COLUMNS, []), {}, { w: 600, h: 300 }, 'task'),
		null,
	);
	assert.equal(
		buildBarSpec(
			dataset('project', PROJECT_COLUMNS, []),
			{},
			{ w: 600, h: 300 },
			'project',
		),
		null,
	);
});

test('bar value labels follow their toggle', () => {
	const data = projectDataset([['A', 1, 0.1]]);
	const on = buildBarSpec(
		data,
		{ showValueLabels: true },
		{ w: 600, h: 300 },
		'project',
	);
	assert.equal(on.showValueLabels, true);
	const off = buildBarSpec(data, {}, { w: 600, h: 300 }, 'project');
	assert.equal(off.showValueLabels, false);
});

const NOTE_TIMELINE_COLUMNS = [
	{ key: 'date', labelKey: 'DATASET_COL_DATE', type: 'date' },
	{ key: 'total', labelKey: 'DATASET_COL_NOTES', type: 'number' },
	{ key: 'tasks', labelKey: 'DATASET_COL_TASKS', type: 'number' },
	{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
	{ key: 'size', labelKey: 'DATASET_COL_SIZE', type: 'size' },
];

const FILE_TIMELINE_COLUMNS = [
	{ key: 'date', labelKey: 'DATASET_COL_DATE', type: 'date' },
	{ key: 'total', labelKey: 'DATASET_COL_FILES', type: 'number' },
	{ key: 'size', labelKey: 'DATASET_COL_SIZE', type: 'size' },
];

test('line charts default to the timeline date/total columns for notes and files', () => {
	const notes = dataset(
		'note',
		NOTE_TIMELINE_COLUMNS,
		[
			{
				date: cell('2026-11-08', '2026-11-08'),
				total: cell('2', 2),
				tasks: cell('5', 5),
				completed: cell('3', 3),
				size: cell('2 KB', 2048),
			},
		],
	);
	const noteSpec = buildLineSpec(notes, {}, { w: 600, h: 300 }, 'note');
	assert.equal(noteSpec.series[0].key, 'total');
	assert.equal(noteSpec.series[0].points[0].value, 2);

	const files = dataset(
		'file',
		FILE_TIMELINE_COLUMNS,
		[
			{
				date: cell('2026-11-08', '2026-11-08'),
				total: cell('3', 3),
				size: cell('1 KB', 1024),
			},
		],
	);
	const fileSpec = buildLineSpec(files, { yField: 'tasks' }, { w: 600, h: 300 }, 'file');
	assert.equal(fileSpec.series[0].key, 'total');
	const sizeSpec = buildLineSpec(files, { yField: 'size' }, { w: 600, h: 300 }, 'file');
	assert.equal(sizeSpec.series[0].key, 'size');
	assert.equal(sizeSpec.series[0].points[0].value, 1024);
});

test('month buckets render their labels verbatim and as categories', () => {
	const data = dataset(
		'note',
		NOTE_TIMELINE_COLUMNS,
		[
			{
				date: cell('2026-10', '2026-10'),
				total: cell('1', 1),
				tasks: cell('0', 0),
				completed: cell('0', 0),
				size: cell('0 B', 0),
			},
			{
				date: cell('2026-11', '2026-11'),
				total: cell('4', 4),
				tasks: cell('2', 2),
				completed: cell('1', 1),
				size: cell('1 KB', 1024),
			},
		],
	);
	const spec = buildLineSpec(data, { xLabelFormat: 'md' }, { w: 600, h: 300 }, 'note');
	assert.equal(spec.x.type, 'category');
	assert.deepEqual(
		spec.x.ticks.map((tick) => tick.label),
		['2026-10', '2026-11'],
	);
	assert.deepEqual(
		spec.series[0].points.map((point) => point.value),
		[1, 4],
	);
});

test('a single month bucket still produces a centred point', () => {
	const data = dataset(
		'note',
		NOTE_TIMELINE_COLUMNS,
		[
			{
				date: cell('2026-11', '2026-11'),
				total: cell('2', 2),
				tasks: cell('3', 3),
				completed: cell('1', 1),
				size: cell('1 KB', 1024),
			},
		],
	);
	const spec = buildLineSpec(data, {}, { w: 600, h: 300 }, 'note');
	assert.equal(spec.x.type, 'category');
	assert.equal(
		spec.series[0].points[0].x,
		spec.plot.left + spec.plot.width / 2,
	);
});
