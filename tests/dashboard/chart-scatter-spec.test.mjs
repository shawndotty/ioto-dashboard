import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buildScatterSpec } = await load(
	'../../src/dashboard/dataset/charts/scatter-spec.ts',
);

function cell(text, sortValue) {
	return sortValue === undefined ? { text } : { text, sortValue };
}

const NOTE_COLUMNS = [
	{ key: 'note', labelKey: 'DATASET_COL_NAME', type: 'text' },
	{ key: 'tasks', labelKey: 'DATASET_COL_TASKS', type: 'number' },
	{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
];

function noteDataset(rows, columns = NOTE_COLUMNS) {
	return {
		object: 'note',
		measure: 'count',
		columns,
		rows: rows.map(([name, tasks, completed], index) => ({
			id: `note:${index}`,
			cells: {
				note: cell(name),
				tasks: cell(String(tasks), tasks),
				completed: cell(String(completed), completed),
			},
		})),
		total: rows.length,
		truncated: false,
	};
}

const SIZE = { w: 480, h: 320 };

test('scatter maps both numeric fields into the plot', () => {
	const spec = buildScatterSpec(
		noteDataset([
			['A', 1, 1],
			['B', 4, 2],
			['C', 6, 5],
		]),
		{},
		SIZE,
		'note',
	);

	assert.ok(spec);
	assert.equal(spec.kind, 'scatter');
	assert.equal(spec.points.length, 3);
	assert.equal(spec.x.labelKey, 'DATASET_COL_TASKS');
	assert.equal(spec.y.labelKey, 'DATASET_COL_COMPLETED');
	for (const point of spec.points) {
		assert.ok(point.x >= spec.plot.left);
		assert.ok(point.x <= spec.plot.left + spec.plot.width);
		assert.ok(point.y >= spec.plot.top);
		assert.ok(point.y <= spec.plot.top + spec.plot.height);
	}
	// The highest X value sits furthest right.
	const right = spec.points[2];
	const left = spec.points[0];
	assert.ok(right.x > left.x);
});

test('scatter truncates to the configured limit and reports the rest', () => {
	const rows = Array.from({ length: 60 }, (_, index) => [
		`N${index}`,
		index,
		index % 5,
	]);
	const spec = buildScatterSpec(
		noteDataset(rows),
		{ limit: 50 },
		SIZE,
		'note',
	);

	assert.ok(spec);
	assert.equal(spec.points.length, 50);
	assert.equal(spec.hiddenCount, 10);
	assert.equal(spec.extrasHeight, 20);
});

test('missing numeric columns return null', () => {
	const spec = buildScatterSpec(
		{
			object: 'note',
			measure: 'count',
			columns: [{ key: 'note', labelKey: 'DATASET_COL_NAME', type: 'text' }],
			rows: [{ id: 'n:0', cells: { note: cell('A') } }],
			total: 1,
			truncated: false,
		},
		{},
		SIZE,
		'note',
	);

	assert.equal(spec, null);
});

test('identical values keep a finite domain', () => {
	const spec = buildScatterSpec(
		noteDataset([
			['A', 2, 1],
			['B', 2, 1],
		]),
		{},
		SIZE,
		'note',
	);

	assert.ok(spec);
	assert.ok(spec.x.max > spec.x.min);
	assert.ok(spec.y.max > spec.y.min);
	for (const point of spec.points) {
		assert.ok(Number.isFinite(point.x));
		assert.ok(Number.isFinite(point.y));
	}
});

test('folder objects default to files × size', () => {
	const spec = buildScatterSpec(
		{
			object: 'folder',
			measure: 'count',
			columns: [
				{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
				{ key: 'files', labelKey: 'DATASET_COL_FILES', type: 'number' },
				{ key: 'size', labelKey: 'DATASET_COL_SIZE', type: 'size' },
			],
			rows: [
				{
					id: 'folder:0',
					cells: {
						name: cell('X'),
						files: cell('4', 4),
						size: cell('2 KB', 2048),
					},
				},
			],
			total: 1,
			truncated: false,
		},
		{},
		SIZE,
		'folder',
	);

	assert.ok(spec);
	assert.equal(spec.x.labelKey, 'DATASET_COL_FILES');
	assert.equal(spec.y.labelKey, 'DATASET_COL_SIZE');
});

test('point radius follows pointSize within bounds', () => {
	const small = buildScatterSpec(
		noteDataset([['A', 1, 1]]),
		{ pointSize: 1 },
		SIZE,
		'note',
	);
	const large = buildScatterSpec(
		noteDataset([['A', 1, 1]]),
		{ pointSize: 99 },
		SIZE,
		'note',
	);
	assert.equal(small.pointRadius, 2);
	assert.equal(large.pointRadius, 6);
});
