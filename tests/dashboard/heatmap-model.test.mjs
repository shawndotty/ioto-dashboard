import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buildHeatmapModel } = await load(
	'../../src/dashboard/dataset/heatmap-model.ts',
);

const NOW = () => new Date(2026, 10, 14, 15, 30).getTime();

function row(key, count, extra = {}) {
	return {
		id: key,
		cells: { total: { text: String(count), sortValue: count } },
		...extra,
	};
}

function keyed(model) {
	return new Map(model.cells.map((cell) => [cell.key, cell]));
}

function dayOf(model, key) {
	const cell = keyed(model).get(key);
	assert.ok(cell, `missing cell ${key}`);
	return cell;
}

test('7 days with a Monday start pads to whole weeks', () => {
	const model = buildHeatmapModel([], {
		range: 7,
		now: NOW,
		firstDayOfWeek: 1,
	});
	assert.equal(model.columns, 2);
	assert.equal(model.cells.length, 14);
	const days = model.cells.filter((cell) => cell.inRange);
	assert.equal(days.length, 7);
	assert.equal(days[0].key, '2026-11-08');
	assert.equal(days[days.length - 1].key, '2026-11-14');
	assert.equal(dayOf(model, '2026-11-02').inRange, false);
	assert.equal(dayOf(model, '2026-11-15').inRange, false);
});

test('7 days with a Sunday start is a single week', () => {
	const model = buildHeatmapModel([], {
		range: 7,
		now: NOW,
		firstDayOfWeek: 0,
	});
	assert.equal(model.columns, 1);
	assert.equal(model.cells.length, 7);
	assert.ok(model.cells.every((cell) => cell.inRange));
});

test('14 days span three calendar weeks', () => {
	const model = buildHeatmapModel([], {
		range: 14,
		now: NOW,
		firstDayOfWeek: 1,
	});
	assert.equal(model.columns, 3);
	const days = model.cells.filter((cell) => cell.inRange);
	assert.equal(days.length, 14);
	assert.equal(days[0].key, '2026-11-01');
	assert.equal(days[days.length - 1].key, '2026-11-14');
});

test('365 days covers exactly one year including today', () => {
	const model = buildHeatmapModel([], {
		range: 365,
		now: NOW,
		firstDayOfWeek: 0,
	});
	const days = model.cells.filter((cell) => cell.inRange);
	assert.equal(days.length, 365);
	assert.equal(days[0].key, '2025-11-15');
	assert.equal(days[days.length - 1].key, '2026-11-14');
});

test('empty rows still produce a full zero grid', () => {
	const model = buildHeatmapModel([], { range: 30, now: NOW });
	const inRange = model.cells.filter((cell) => cell.inRange);
	assert.equal(inRange.length, 30);
	assert.ok(model.cells.every((cell) => cell.count === 0 && cell.level === 0));
	assert.deepEqual(model.thresholds, [0, 0, 0]);
	assert.equal(model.activeDays, 0);
	assert.equal(model.peak, 0);
});

test('outside cells stay zero even when a row exists for that day', () => {
	const model = buildHeatmapModel([row('2026-11-02', 50)], {
		range: 7,
		now: NOW,
		firstDayOfWeek: 1,
	});
	const outside = dayOf(model, '2026-11-02');
	assert.equal(outside.inRange, false);
	assert.equal(outside.count, 0);
	assert.equal(outside.level, 0);
	assert.equal(model.activeDays, 0);
	assert.equal(model.peak, 0);
});

test('level thresholds use the 25/50/75 percentiles of positive days', () => {
	const keys = [
		'2026-11-08',
		'2026-11-09',
		'2026-11-10',
		'2026-11-11',
		'2026-11-12',
	];
	const model = buildHeatmapModel(
		keys.map((key, index) => row(key, index + 1)),
		{ range: 7, now: NOW, firstDayOfWeek: 0 },
	);
	assert.deepEqual(model.thresholds, [2, 3, 4]);
	assert.equal(dayOf(model, '2026-11-08').level, 1);
	assert.equal(dayOf(model, '2026-11-09').level, 1);
	assert.equal(dayOf(model, '2026-11-10').level, 2);
	assert.equal(dayOf(model, '2026-11-11').level, 3);
	assert.equal(dayOf(model, '2026-11-12').level, 4);
});

test('a single positive day collapses thresholds to its value', () => {
	const model = buildHeatmapModel([row('2026-11-10', 7)], {
		range: 7,
		now: NOW,
	});
	assert.deepEqual(model.thresholds, [7, 7, 7]);
	assert.equal(dayOf(model, '2026-11-10').level, 1);
	assert.equal(model.activeDays, 1);
	assert.equal(model.peak, 7);
});

test('an all-zero window keeps every cell at level 0', () => {
	const model = buildHeatmapModel(
		[row('2026-11-10', 0), row('2026-11-11', 0)],
		{ range: 7, now: NOW },
	);
	assert.deepEqual(model.thresholds, [0, 0, 0]);
	assert.ok(model.cells.every((cell) => cell.level === 0));
});

test('exactly one cell is today', () => {
	const model = buildHeatmapModel([], { range: 90, now: NOW });
	const today = model.cells.filter((cell) => cell.isToday);
	assert.equal(today.length, 1);
	assert.equal(today[0].key, '2026-11-14');
	assert.ok(today[0].inRange);
});

test('month marks change at the first column of each month', () => {
	const model = buildHeatmapModel([], {
		range: 30,
		now: NOW,
		firstDayOfWeek: 0,
	});
	assert.equal(model.columns, 5);
	assert.deepEqual(
		model.months.map((mark) => mark.key),
		['2026-10', '2026-11'],
	);
	assert.deepEqual(
		model.months.map((mark) => mark.column),
		[0, 3],
	);
});

test('month marks cross the year boundary correctly', () => {
	const model = buildHeatmapModel([], {
		range: 90,
		now: () => new Date(2026, 0, 15, 9, 0).getTime(),
		firstDayOfWeek: 0,
	});
	assert.deepEqual(
		model.months.map((mark) => mark.key),
		['2025-10', '2025-11', '2025-12', '2026-01'],
	);
});

test('the first column is labelled by its first in-range day', () => {
	const model = buildHeatmapModel([], {
		range: 14,
		now: NOW,
		firstDayOfWeek: 1,
	});
	assert.equal(model.columns, 3);
	assert.equal(model.cells.length, model.columns * 7);
	assert.deepEqual(
		model.months.map((mark) => mark.column),
		[0],
	);
	assert.deepEqual(
		model.months.map((mark) => mark.key),
		['2026-11'],
	);
});

test('counts prefer sortValue over the formatted text', () => {
	const model = buildHeatmapModel(
		[
			{
				id: '2026-11-10',
				cells: { total: { text: '99', sortValue: 2 } },
			},
		],
		{ range: 7, now: NOW },
	);
	assert.equal(dayOf(model, '2026-11-10').count, 2);
});

test('refs and relatedTotal follow the source row', () => {
	const refs = [{ path: 'A.md', label: 'A', kind: 'task' }];
	const model = buildHeatmapModel(
		[row('2026-11-10', 1, { related: refs, relatedTotal: 42 })],
		{ range: 7, now: NOW },
	);
	const cell = dayOf(model, '2026-11-10');
	assert.deepEqual(cell.refs, refs);
	assert.equal(cell.relatedTotal, 42);
});
