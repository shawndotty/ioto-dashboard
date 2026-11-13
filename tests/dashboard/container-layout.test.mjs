import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	CONTAINER_ROW_FLOOR,
	CARD_HEADER_HEIGHT,
	containerInnerHeight,
	effectiveContainerRowHeight,
	fitContainerRows,
	gridRowsUsed,
} = await load('../../src/dashboard/container-layout.ts');

const hiddenTitle = (overrides = {}) => ({
	cardRows: 1,
	pageRowHeight: 72,
	pageGap: 12,
	headerHeight: 0,
	padding: 8,
	borderWidth: 1,
	gap: 8,
	rows: 1,
	configuredRowHeight: 56,
	...overrides,
});

test('gridRowsUsed returns 0 for an empty container', () => {
	assert.equal(gridRowsUsed([], 12), 0);
});

test('gridRowsUsed places a single card on one row', () => {
	assert.equal(gridRowsUsed([{ w: 6 }], 12), 1);
});

test('gridRowsUsed keeps two half-width cards on one row', () => {
	assert.equal(gridRowsUsed([{ w: 6 }, { w: 6 }], 12), 1);
});

test('gridRowsUsed wraps the third half-width card', () => {
	assert.equal(gridRowsUsed([{ w: 6 }, { w: 6 }, { w: 6 }], 12), 2);
});

test('gridRowsUsed advances past cards that span multiple rows', () => {
	assert.equal(
		gridRowsUsed([{ w: 6, h: 2 }, { w: 12 }], 12),
		3,
	);
});

test('gridRowsUsed keeps the auto-flow cursor and never backfills', () => {
	assert.equal(
		gridRowsUsed([{ w: 6 }, { w: 12 }, { w: 6 }], 12),
		3,
	);
});

test('gridRowsUsed clamps widths that exceed the column count', () => {
	assert.equal(gridRowsUsed([{ w: 20 }], 12), 1);
	assert.equal(gridRowsUsed([{ w: 1 }], 2), 1);
});

test('gridRowsUsed treats invalid column counts as one column', () => {
	assert.equal(gridRowsUsed([{ w: 2 }], 0), 1);
	assert.equal(gridRowsUsed([{ w: 2 }], Number.NaN), 1);
});

test('containerInnerHeight subtracts header, padding and border', () => {
	assert.equal(containerInnerHeight(hiddenTitle()), 54);
	assert.equal(containerInnerHeight(hiddenTitle({ cardRows: 2 })), 138);
});

test('effectiveContainerRowHeight fits a one-row container to its body', () => {
	const geo = hiddenTitle();
	assert.equal(containerInnerHeight(geo), 54);
	assert.equal(effectiveContainerRowHeight(geo), 54);
});

test('effectiveContainerRowHeight shrinks crowded content but keeps the floor', () => {
	const height = effectiveContainerRowHeight(hiddenTitle({ rows: 3 }));
	assert.ok(height >= CONTAINER_ROW_FLOOR);
	assert.ok(height < 56);
});

test('effectiveContainerRowHeight never enlarges a tall container', () => {
	assert.equal(
		effectiveContainerRowHeight(hiddenTitle({ cardRows: 4, rows: 1 })),
		56,
	);
});

test('compact density keeps a single row readable', () => {
	const geo = hiddenTitle({
		padding: 4,
		gap: 4,
		configuredRowHeight: 48,
	});
	assert.equal(containerInnerHeight(geo), 62);
	assert.equal(effectiveContainerRowHeight(geo), 48);
});

test('fitContainerRows keeps one-row content at one row when the title is hidden', () => {
	assert.equal(fitContainerRows(hiddenTitle()), 1);
});

test('fitContainerRows needs two rows when the title takes space', () => {
	assert.equal(
		fitContainerRows(hiddenTitle({ headerHeight: CARD_HEADER_HEIGHT })),
		2,
	);
});

test('fitContainerRows gives multi-row content its configured height', () => {
	assert.equal(fitContainerRows(hiddenTitle({ rows: 2 })), 2);
	assert.equal(fitContainerRows(hiddenTitle({ rows: 3 })), 3);
});

test('fitContainerRows ignores the current container height', () => {
	assert.equal(fitContainerRows(hiddenTitle({ cardRows: 4 })), 1);
});

test('fitContainerRows works with the compact preset', () => {
	assert.equal(
		fitContainerRows(
			hiddenTitle({ padding: 4, gap: 4, configuredRowHeight: 48 }),
		),
		1,
	);
});

test('fitContainerRows returns 1 for an empty container', () => {
	assert.equal(fitContainerRows(hiddenTitle({ rows: 0 })), 1);
});
