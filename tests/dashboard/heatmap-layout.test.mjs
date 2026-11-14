import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	fitHeatmap,
	chooseHeatmapLayout,
	STRIP_ENTER_CELL,
	STRIP_EXIT_CELL,
} = await load('../../src/dashboard/dataset/heatmap-fit.ts');

const GAP = 3;
const MIN = 10;
const MAX = 40;

function fit(overrides = {}) {
	return fitHeatmap({
		width: 640,
		height: 180,
		columns: 14,
		rows: 1,
		gap: GAP,
		labelWidth: 0,
		chromeHeight: 0,
		minCell: MIN,
		maxCell: MAX,
		...overrides,
	});
}

function choose(overrides = {}) {
	return chooseHeatmapLayout({
		range: 14,
		width: 640,
		height: 180,
		calendarColumns: 3,
		gap: GAP,
		minCell: MIN,
		maxCell: MAX,
		weekdayLabelWidth: 28,
		calendarChromeHeight: 40,
		stripChromeHeight: 6,
		...overrides,
	});
}

test('width-limited single row clamps at the max cell', () => {
	const result = fit();
	assert.equal(result.rawCell, 42);
	assert.equal(result.cellH, MAX);
	assert.equal(result.cellW, MAX);
});

test('height-limited calendar row clamps below the raw width budget', () => {
	const result = fit({
		columns: 5,
		rows: 7,
		labelWidth: 28,
		chromeHeight: 40,
	});
	assert.equal(result.rawCell, 17);
	assert.equal(result.cellH, 17);
});

test('a narrow host clamps at the min cell and reports no leftover', () => {
	const result = fit({ width: 200, columns: 30 });
	assert.equal(result.rawCell, 3);
	assert.equal(result.cellH, MIN);
	assert.equal(result.cellW, MIN);
	assert.equal(result.leftover, 0);
});

test('stretch widens cells up to the ratio and the width budget', () => {
	const stretched = fit({
		columns: 5,
		rows: 7,
		width: 600,
		labelWidth: 28,
		chromeHeight: 40,
		stretch: 2,
	});
	assert.equal(stretched.cellH, 17);
	assert.equal(stretched.cellW, 34);

	const square = fit({
		columns: 5,
		rows: 7,
		width: 600,
		labelWidth: 28,
		chromeHeight: 40,
		stretch: 1,
	});
	assert.equal(square.cellW, square.cellH);
});

test('leftover is the centering margin and never negative', () => {
	assert.equal(fit().leftover, 41);
	assert.equal(fit({ width: 100 }).leftover, 0);
});

test('unbounded height falls back to the width budget', () => {
	const result = fit({ height: 0, columns: 7 });
	assert.equal(result.cellH, MAX);
});

test('auto layout prefers a single row while cells stay readable', () => {
	assert.equal(choose({ range: 7 }).layout, 'strip');
	assert.equal(choose({ range: 14 }).layout, 'strip');
	assert.equal(choose({ range: 30, calendarColumns: 5 }).layout, 'strip');
	assert.equal(choose({ range: 365, calendarColumns: 53 }).layout, 'calendar');
});

test('auto layout falls back to a calendar on a narrow card', () => {
	assert.equal(
		choose({ range: 30, width: 300, calendarColumns: 5 }).layout,
		'calendar',
	);
});

test('hysteresis keeps the current layout just below the threshold', () => {
	assert.equal(STRIP_ENTER_CELL, 14);
	assert.equal(STRIP_EXIT_CELL, 13);

	const raw13 = choose({ range: 30, width: 480, calendarColumns: 5 });
	assert.equal(raw13.strip.rawCell, 13);
	assert.equal(raw13.layout, 'calendar');

	const stayingStrip = choose({
		range: 30,
		width: 480,
		calendarColumns: 5,
		previous: 'strip',
	});
	assert.equal(stayingStrip.layout, 'strip');

	const raw12 = choose({
		range: 30,
		width: 450,
		calendarColumns: 5,
		previous: 'strip',
	});
	assert.equal(raw12.strip.rawCell, 12);
	assert.equal(raw12.layout, 'calendar');
});
