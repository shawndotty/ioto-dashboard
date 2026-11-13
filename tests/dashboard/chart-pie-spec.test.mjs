import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buildPieSpec, allocatePercents } = await load(
	'../../src/dashboard/dataset/charts/pie-spec.ts',
);

function cell(text, sortValue) {
	return sortValue === undefined ? { text } : { text, sortValue };
}

const PROJECT_COLUMNS = [
	{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
	{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
];

function dataset(rows, columns = PROJECT_COLUMNS, extra = {}) {
	return {
		object: 'project',
		measure: 'count',
		columns,
		rows: rows.map(([name, completed], index) => ({
			id: `project:${index}`,
			cells: { name: cell(name), completed: cell(String(completed), completed) },
		})),
		total: rows.length,
		truncated: false,
		...extra,
	};
}

const SIZE = { w: 400, h: 300 };

test('allocatePercents always sums to exactly 100', () => {
	const thirds = allocatePercents([1, 1, 1]);
	assert.equal(thirds.reduce((sum, value) => sum + value, 0), 100);
	assert.deepEqual(thirds, [34, 33, 33]);

	const sevenths = allocatePercents([1, 1, 1, 1, 1, 1, 1]);
	assert.equal(sevenths.reduce((sum, value) => sum + value, 0), 100);
	assert.deepEqual(allocatePercents([0, 0]), [0, 0]);
});

test('pie slices are sorted by value and cover the full circle', () => {
	const spec = buildPieSpec(
		dataset([
			['A', 3],
			['B', 2],
			['C', 1],
		]),
		{},
		SIZE,
		'project',
	);

	assert.ok(spec);
	assert.equal(spec.kind, 'pie');
	assert.deepEqual(
		spec.slices.map((slice) => slice.label),
		['A', 'B', 'C'],
	);
	assert.equal(spec.slices[0].integerPercent, 50);
	assert.equal(
		spec.slices.reduce((sum, slice) => sum + slice.integerPercent, 0),
		100,
	);
	assert.equal(spec.slices[0].startAngle, 0);
	assert.ok(Math.abs(spec.slices[2].endAngle - Math.PI * 2) < 1e-9);
	assert.ok(spec.slices.every((slice) => slice.path.length > 0));
	assert.equal(spec.totalText, '6');
});

test('a single category becomes a two-arc full circle', () => {
	const spec = buildPieSpec(dataset([['Only', 5]]), {}, SIZE, 'project');

	assert.ok(spec);
	assert.equal(spec.slices.length, 1);
	assert.equal(spec.slices[0].integerPercent, 100);
	const arcs = (spec.slices[0].path.match(/A /g) ?? []).length;
	assert.equal(arcs, 2);
});

test('donut inner radius is clamped and pie stays solid', () => {
	const pie = buildPieSpec(dataset([['A', 1]]), { innerRadius: 0.9 }, SIZE, 'project');
	const donutHigh = buildPieSpec(
		dataset([['A', 1]]),
		{ innerRadius: 0.9 },
		SIZE,
		'project',
		'donut',
	);
	const donutLow = buildPieSpec(
		dataset([['A', 1]]),
		{ innerRadius: 0.1 },
		SIZE,
		'project',
		'donut',
	);

	assert.ok(pie && donutHigh && donutLow);
	assert.equal(pie.innerRadius, 0);
	assert.ok(Math.abs(donutHigh.innerRadius / donutHigh.radius - 0.8) < 1e-9);
	assert.ok(Math.abs(donutLow.innerRadius / donutLow.radius - 0.35) < 1e-9);
	assert.equal(donutHigh.kind, 'donut');
	assert.equal(donutHigh.ariaKey, 'CHART_ARIA_DONUT');
});

test('topN aggregates the tail into an “other” slice', () => {
	const rows = Array.from({ length: 10 }, (_, index) => [
		`P${index}`,
		index + 1,
	]);
	const spec = buildPieSpec(dataset(rows), { topN: 3 }, SIZE, 'project');

	assert.ok(spec);
	assert.equal(spec.slices.length, 4);
	const other = spec.slices[3];
	assert.equal(other.isOther, true);
	assert.equal(other.labelKey, 'SETTING_PIE_OTHER');
	assert.equal(spec.hiddenCount, 7);
	assert.equal(
		spec.slices.reduce((sum, slice) => sum + slice.value, 0),
		55,
	);
});

test('empty, all-zero and tiny datasets return null', () => {
	assert.equal(buildPieSpec(dataset([]), {}, SIZE, 'project'), null);
	assert.equal(
		buildPieSpec(
			dataset([
				['A', 0],
				['B', 0],
			]),
			{},
			SIZE,
			'project',
		),
		null,
	);
	assert.equal(
		buildPieSpec(dataset([['A', 1]]), {}, { w: 60, h: 60 }, 'project'),
		null,
	);
});

test('extrasHeight follows legend rows, value list and truncation', () => {
	const rows = Array.from({ length: 5 }, (_, index) => [
		`P${index}`,
		index + 1,
	]);
	const three = buildPieSpec(
		dataset(rows.slice(0, 3)),
		{ showLegend: true },
		SIZE,
		'project',
	);
	const withList = buildPieSpec(
		dataset(rows.slice(0, 3)),
		{ showLegend: false, showLabels: true },
		SIZE,
		'project',
	);
	const truncated = buildPieSpec(
		dataset(rows),
		{ showLegend: false, topN: 2 },
		SIZE,
		'project',
	);

	assert.equal(three.extrasHeight, 2 * 22);
	assert.equal(withList.extrasHeight, 3 * 20);
	assert.equal(truncated.extrasHeight, 20);
});

test('pie defaults to the project name / completed columns', () => {
	const spec = buildPieSpec(dataset([['A', 2]]), {}, SIZE, 'project');

	assert.ok(spec);
	assert.equal(spec.slices[0].label, 'A');
	assert.equal(spec.slices[0].value, 2);
	assert.equal(spec.valueLabelKey, 'DATASET_COL_COMPLETED');
});
