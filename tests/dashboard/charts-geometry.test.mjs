import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	scaleLinear,
	niceTicks,
	domainTicks,
	bandScale,
	barLayoutInDomain,
	linePointsInDomain,
	thinLabels,
	estimateTextWidth,
	truncateText,
	arcRatio,
} = await load('../../src/dashboard/dataset/charts/geometry.ts');

test('scaleLinear maps a domain onto a range', () => {
	const scale = scaleLinear([0, 10], [0, 100]);
	assert.equal(scale(0), 0);
	assert.equal(scale(5), 50);
	assert.equal(scale(10), 100);
});

test('scaleLinear degenerates to the range start on an empty domain', () => {
	const scale = scaleLinear([3, 3], [10, 20]);
	assert.equal(scale(3), 10);
	assert.equal(scale(99), 10);
});

test('niceTicks always includes zero for positive domains', () => {
	const ticks = niceTicks(0, 9, 4);
	assert.equal(ticks[0], 0);
	assert.ok(ticks.length >= 2);
	for (let i = 1; i < ticks.length; i += 1) {
		assert.ok(ticks[i] > ticks[i - 1], 'ticks ascend');
	}
});

test('niceTicks keeps an all-zero domain non-degenerate', () => {
	assert.deepEqual(niceTicks(0, 0, 4), [0, 0.5, 1]);
});

test('niceTicks covers negative domains', () => {
	const ticks = niceTicks(-5, 5, 4);
	assert.equal(ticks[0], -5);
	assert.equal(ticks[ticks.length - 1], 5);
});

test('domainTicks respects an explicit domain without forcing zero', () => {
	assert.deepEqual(domainTicks(2, 10, 4), [2, 4, 6, 8, 10]);
	assert.equal(domainTicks(1, 1).length, 1);
});

test('bandScale evenly divides the range and centers each band', () => {
	const band = bandScale(2, [0, 100], 0.2);
	assert.equal(band.step, 50);
	assert.equal(band.width, 40);
	assert.equal(band.start(0), 5);
	assert.equal(band.center(0), 25);
	assert.equal(band.center(1), 75);
	assert.equal(bandScale(0, [0, 100]).width, 1);
});

test('barLayoutInDomain keeps zero values visible and maps negatives', () => {
	const bars = barLayoutInDomain([0, 10], 100, 50, 0, [0, 10]);
	assert.equal(bars.length, 2);
	assert.equal(bars[0].h, 1);
	assert.equal(bars[1].h, 50);
	assert.equal(bars[1].y, 0);
	assert.ok(bars[0].x < bars[1].x);
	assert.equal(barLayoutInDomain([], 100, 50, 4, [0, 1]).length, 0);

	const negative = barLayoutInDomain([-4, 8], 100, 40, 0, [-4, 8]);
	assert.ok(negative[0].y > 0, 'negative bar sits below the zero line');
	assert.equal(negative[1].y, 0);
	assert.ok(
		Math.abs(negative[0].h + negative[1].h - 40) < 1e-6,
		'bars cover the plot height',
	);
});

test('linePointsInDomain maps values and centers a single point', () => {
	const points = linePointsInDomain([0, 5, 10], 100, 40, [0, 10]);
	assert.deepEqual(
		points.map((point) => point.x),
		[0, 50, 100],
	);
	assert.deepEqual(
		points.map((point) => point.y),
		[40, 20, 0],
	);
	assert.deepEqual(linePointsInDomain([5], 100, 40, [0, 10]), [
		{ x: 50, y: 20 },
	]);
	assert.equal(linePointsInDomain([], 100, 40, [0, 1]).length, 0);
});

test('thinLabels keeps first and last while thinning the middle', () => {
	assert.deepEqual(thinLabels([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4), [
		0, 3, 6, 9,
	]);
	assert.deepEqual(thinLabels([0, 1, 2], 3), [0, 1, 2]);
	assert.deepEqual(thinLabels([0, 1, 2], 2), [0, 2]);
	assert.deepEqual(thinLabels([0, 1, 2], 1), [0]);
	assert.deepEqual(thinLabels([], 2), []);
});

test('estimateTextWidth and truncateText follow the width budget', () => {
	assert.equal(estimateTextWidth('ab', 10), 12);
	assert.equal(estimateTextWidth('中', 10), 10);
	assert.equal(truncateText('abcdef', 100, 10), 'abcdef');
	assert.ok(truncateText('abcdefghij', 30, 10).endsWith('…'));
	assert.equal(truncateText('abc', 0, 10), '');
});

test('arcRatio clamps to [0, 1] and guards a zero total', () => {
	assert.equal(arcRatio(5, 10), 0.5);
	assert.equal(arcRatio(20, 10), 1);
	assert.equal(arcRatio(-1, 10), 0);
	assert.equal(arcRatio(1, 0), 0);
	assert.equal(arcRatio(1, Number.NaN), 0);
});
