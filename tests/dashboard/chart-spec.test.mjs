import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buildLineSpec, buildBarSpec } = await load(
	'../../src/dashboard/dataset/charts/spec.ts',
);
const { estimateTextWidth } = await load(
	'../../src/dashboard/dataset/charts/geometry.ts',
);

const LABEL_FONT = 11;

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
		{ xSort: 'value-desc', topN: 2, yField: 'completed', showLabels: true },
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
	const spec = buildBarSpec(data, { yField: 'ratio', showLabels: true }, { w: 600, h: 300 }, 'project');
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

test('dense bars thin their X labels instead of overlapping', () => {
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
	assert.ok(spec.x.ticks.length >= 2);
	assert.ok(spec.x.ticks.length <= 20);
	assert.equal(spec.x.ticks[0].position, spec.series[0].bars[0].x + spec.series[0].bars[0].w / 2);
	const lastBar = spec.series[0].bars[spec.series[0].bars.length - 1];
	const lastTick = spec.x.ticks[spec.x.ticks.length - 1];
	assert.equal(lastTick.position, lastBar.x + lastBar.w / 2);
});

test('bar data lists are off unless explicitly enabled', () => {
	const rows = Array.from({ length: 20 }, (_, index) => [
		`P${index + 1}`,
		index,
		index / 20,
	]);
	const data = projectDataset(rows);
	assert.equal(
		buildBarSpec(data, { yField: 'completed' }, { w: 600, h: 300 }, 'project')
			.valueList,
		null,
	);
	assert.equal(
		buildBarSpec(
			data,
			{ yField: 'completed', showLabels: true },
			{ w: 600, h: 300 },
			'project',
		).valueList.length,
		20,
	);
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

test('month buckets format iso, short and md labels as categories', () => {
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
	const iso = buildLineSpec(data, { xLabelFormat: 'iso' }, { w: 600, h: 300 }, 'note');
	assert.equal(iso.x.type, 'category');
	assert.deepEqual(
		iso.x.ticks.map((tick) => tick.label),
		['2026-10', '2026-11'],
	);

	const short = buildLineSpec(
		data,
		{ xLabelFormat: 'short' },
		{ w: 600, h: 300 },
		'note',
	);
	assert.deepEqual(
		short.x.ticks.map((tick) => tick.label),
		['26-10', '26-11'],
	);

	const md = buildLineSpec(data, { xLabelFormat: 'md' }, { w: 600, h: 300 }, 'note');
	assert.deepEqual(
		md.x.ticks.map((tick) => tick.label),
		['10', '11'],
	);
	assert.deepEqual(
		md.series[0].points.map((point) => point.value),
		[1, 4],
	);
	assert.equal(md.x.type, 'category');
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

test('series toggles only add columns the object really has', () => {
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
	const fileSpec = buildLineSpec(
		files,
		{ ySeriesCompleted: true, ySeriesOpen: true },
		{ w: 600, h: 300 },
		'file',
	);
	assert.deepEqual(
		fileSpec.series.map((series) => series.key),
		['total'],
	);

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
	const noteSpec = buildLineSpec(
		notes,
		{ ySeriesOpen: true },
		{ w: 600, h: 300 },
		'note',
	);
	assert.deepEqual(
		noteSpec.series.map((series) => series.key),
		['total'],
	);
});

test('stacked series must share the primary column unit', () => {
	const data = dataset(
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
	const spec = buildLineSpec(
		data,
		{ yField: 'size', ySeriesCompleted: true },
		{ w: 600, h: 300 },
		'note',
	);
	assert.deepEqual(
		spec.series.map((series) => series.key),
		['size'],
	);
});

test('size columns always format as KB/MB regardless of yFormat', () => {
	const files = dataset(
		'file',
		FILE_TIMELINE_COLUMNS,
		[
			{
				date: cell('2026-11-08', '2026-11-08'),
				total: cell('3', 3),
				size: cell('2 KB', 2048),
			},
		],
	);
	const spec = buildLineSpec(
		files,
		{ yField: 'size', yFormat: 'number' },
		{ w: 600, h: 300 },
		'file',
	);
	assert.equal(spec.y.format(2048), '2 KB');
	assert.equal(spec.y.format(1024 * 1024), '1.0 MB');
});

test('cumulative sums each series across the visible buckets', () => {
	const data = taskDataset([
		['2026-11-08', 1, 0, 1],
		['2026-11-09', 3, 1, 2],
	]);
	const cumulative = buildLineSpec(
		data,
		{ yCumulative: true },
		{ w: 600, h: 300 },
		'task',
	);
	assert.equal(cumulative.cumulative, true);
	assert.deepEqual(
		cumulative.series[0].points.map((point) => point.value),
		[1, 4],
	);
	assert.equal(cumulative.showLegend, true);

	const plain = buildLineSpec(
		data,
		{ yCumulative: false },
		{ w: 600, h: 300 },
		'task',
	);
	assert.equal(plain.cumulative, false);
	assert.deepEqual(
		plain.series[0].points.map((point) => point.value),
		[1, 3],
	);
	assert.equal(plain.showLegend, false);
});

function dailyEntries(days, startYear = 2026, startMonth = 9) {
	return Array.from({ length: days }, (_, index) => {
		const date = new Date(startYear, startMonth, index + 1);
		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
		return [key, index + 1, index, 1];
	});
}

test('30-day iso labels never overflow either edge at 0°', () => {
	const data = taskDataset(dailyEntries(30));
	const spec = buildLineSpec(
		data,
		{ xLabelFormat: 'iso', xRotate: '0' },
		{ w: 600, h: 300 },
		'task',
	);
	const first = spec.x.ticks[0];
	const last = spec.x.ticks[spec.x.ticks.length - 1];
	assert.ok(
		first.position - estimateTextWidth(first.label, LABEL_FONT) / 2 >= 0,
		'first label stays inside the canvas',
	);
	assert.ok(
		last.position + estimateTextWidth(last.label, LABEL_FONT) / 2 <=
			spec.width,
		'last label stays inside the canvas',
	);
});

test('180-day rotated labels reserve their text width at 90°', () => {
	const data = taskDataset(dailyEntries(180, 2026, 3));
	const spec = buildLineSpec(
		data,
		{ xLabelFormat: 'iso', xRotate: '90' },
		{ w: 600, h: 300 },
		'task',
	);
	assert.ok(spec.plot.height >= 30);
	const gap = spec.height - (spec.plot.top + spec.plot.height);
	const labelWidth = estimateTextWidth('2026-04-01', LABEL_FONT);
	assert.ok(
		gap >= Math.min(Math.ceil(labelWidth), Math.ceil((spec.height - 14) * 0.35)),
		'rotated labels get a bottom gutter based on text width',
	);
	assert.ok(spec.plot.top + spec.plot.height <= spec.height);
});

test('a narrow card with one point still yields a valid plot', () => {
	const data = taskDataset([['2026-11-08', 5, 2, 3]]);
	const spec = buildLineSpec(
		data,
		{ xLabelFormat: 'iso' },
		{ w: 200, h: 120 },
		'task',
	);
	assert.ok(spec);
	assert.ok(spec.plot.width > 0);
	assert.ok(spec.plot.height > 0);
	assert.ok(spec.plot.left + spec.plot.width <= spec.width);
});

test('hidden Y labels keep the first X label inside the canvas', () => {
	const data = taskDataset(dailyEntries(7));
	const spec = buildLineSpec(
		data,
		{ xLabelFormat: 'iso', yShowLabels: false },
		{ w: 400, h: 240 },
		'task',
	);
	const first = spec.x.ticks[0];
	assert.ok(
		first.position - estimateTextWidth(first.label, LABEL_FONT) / 2 >= 0,
	);
});

test('oversized edge labels fall back to start/end anchors', () => {
	const label = 'abcdefghijklmn';
	const data = dataset(
		'task',
		[
			{ key: 'label', labelKey: 'DATASET_COL_DATE', type: 'text' },
			{ key: 'total', labelKey: 'DATASET_COL_TASKS', type: 'number' },
		],
		[
			{ label: cell(label), total: cell('1', 1) },
			{ label: cell(label), total: cell('2', 2) },
		],
	);
	const spec = buildLineSpec(data, {}, { w: 60, h: 200 }, 'task');
	assert.equal(spec.x.ticks[0].anchor, 'start');
	assert.equal(spec.x.ticks[spec.x.ticks.length - 1].anchor, 'end');
});

test('line points map to their dataset row ids and series keys', () => {
	const data = taskDataset([
		['2026-11-08', 5, 2, 3],
		['2026-11-09', 7, 4, 3],
	]);
	const spec = buildLineSpec(
		data,
		{ ySeriesCompleted: true },
		{ w: 600, h: 300 },
		'task',
	);
	assert.equal(spec.interactive, true);
	assert.equal(spec.series[0].key, 'total');
	assert.deepEqual(
		spec.series[0].points.map((point) => point.bucketKey),
		data.rows.map((row) => row.id),
	);
	assert.deepEqual(
		spec.series[1].points.map((point) => point.seriesKey),
		['completed', 'completed'],
	);
});

test('bars carry the row path for the reserved click-through', () => {
	const data = {
		object: 'project',
		measure: 'count',
		columns: [
			{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
			{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
		],
		rows: [
			{
				id: 'project:alpha',
				cells: {
					name: { text: 'Alpha', path: '3-任务/Alpha.md' },
					completed: { text: '4', sortValue: 4 },
				},
			},
		],
		total: 1,
		truncated: false,
	};
	const spec = buildBarSpec(data, {}, { w: 600, h: 300 }, 'project');
	assert.deepEqual(spec.series[0].bars[0].ref, {
		path: '3-任务/Alpha.md',
		bucketKey: 'project:alpha',
	});
});

function labelBarDataset(labels, values) {
	return dataset(
		'project',
		[
			{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
			{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
		],
		labels.map((label, index) => ({
			name: cell(label),
			completed: cell(String(values?.[index] ?? index + 1), values?.[index] ?? index + 1),
		})),
	);
}

test('50 wide labels are thinned by width, not cut at a fixed 34px', () => {
	const labels = Array.from({ length: 50 }, () => '长'.repeat(12));
	const spec = buildBarSpec(
		labelBarDataset(labels),
		{},
		{ w: 600, h: 300 },
		'project',
	);
	assert.ok(spec.x.ticks.length < 50, 'dense labels get thinned');
	assert.ok(
		spec.x.ticks.some((tick) => estimateTextWidth(tick.label, LABEL_FONT) > 34),
		'kept labels may exceed the old 34px cut',
	);
	for (let index = 1; index < spec.x.ticks.length; index += 1) {
		const previous = spec.x.ticks[index - 1];
		const current = spec.x.ticks[index];
		const gap = current.position - previous.position;
		assert.ok(
			gap >=
				Math.max(
					estimateTextWidth(previous.label, LABEL_FONT),
					estimateTextWidth(current.label, LABEL_FONT),
				) + 6,
			'neighbouring labels never overlap',
		);
	}
});

test('60 bars keep the first and last tick and stay within the slot budget', () => {
	const labels = Array.from({ length: 60 }, () => '长'.repeat(12));
	const spec = buildBarSpec(
		labelBarDataset(labels),
		{},
		{ w: 600, h: 300 },
		'project',
	);
	assert.ok(spec.x.ticks.length <= Math.floor(spec.plot.width / 30));
	const bars = spec.series[0].bars;
	assert.ok(Math.abs(spec.x.ticks[0].position - (bars[0].x + bars[0].w / 2)) < 1e-9);
	const last = bars[bars.length - 1];
	assert.ok(
		Math.abs(
			spec.x.ticks[spec.x.ticks.length - 1].position -
				(last.x + last.w / 2),
		) < 1e-9,
	);
});

test('90° labels fit the bottom reserve at a short card height', () => {
	const labels = Array.from({ length: 50 }, () => '长'.repeat(12));
	const spec = buildBarSpec(
		labelBarDataset(labels),
		{ xRotate: '90' },
		{ w: 600, h: 160 },
		'project',
	);
	const reserve = spec.height - (spec.plot.top + spec.plot.height);
	assert.ok(spec.plot.height >= 30);
	for (const tick of spec.x.ticks) {
		assert.ok(estimateTextWidth(tick.label, LABEL_FONT) <= reserve);
	}
	assert.ok(spec.plot.top + spec.plot.height <= spec.height);
});

test('45° labels fit their projected width into the bottom reserve', () => {
	const labels = Array.from({ length: 50 }, () => '长'.repeat(12));
	const spec = buildBarSpec(
		labelBarDataset(labels),
		{ xRotate: '45' },
		{ w: 600, h: 160 },
		'project',
	);
	const reserve = spec.height - (spec.plot.top + spec.plot.height);
	for (const tick of spec.x.ticks) {
		assert.ok(estimateTextWidth(tick.label, LABEL_FONT) * 0.72 <= reserve);
	}
});

test('0° labels always stay inside the canvas after truncation', () => {
	const spec = buildBarSpec(
		labelBarDataset(['长'.repeat(30), 'B', 'C']),
		{},
		{ w: 600, h: 300 },
		'project',
	);
	for (const tick of spec.x.ticks) {
		const half = estimateTextWidth(tick.label, LABEL_FONT) / 2;
		assert.ok(tick.position - half >= 0);
		assert.ok(tick.position + half <= spec.width);
		assert.equal(tick.anchor, undefined);
	}
});

test('a single bar centres its label and is never thinned away', () => {
	const spec = buildBarSpec(
		labelBarDataset(['Only']),
		{},
		{ w: 600, h: 300 },
		'project',
	);
	assert.equal(spec.x.ticks.length, 1);
	assert.equal(
		spec.x.ticks[0].position,
		spec.plot.left + spec.plot.width / 2,
	);
});

test('bars expose row ids for the interaction layer', () => {
	const data = labelBarDataset(['A', 'B']);
	const spec = buildBarSpec(data, {}, { w: 600, h: 300 }, 'project');
	assert.equal(spec.interactive, true);
	assert.deepEqual(
		spec.series[0].bars.map((bar) => bar.bucketKey),
		data.rows.map((row) => row.id),
	);
	assert.deepEqual(
		spec.series[0].bars.map((bar) => bar.seriesKey),
		['completed', 'completed'],
	);
	assert.deepEqual(
		spec.series[0].bars.map((bar) => bar.ref.bucketKey),
		data.rows.map((row) => row.id),
	);
});
