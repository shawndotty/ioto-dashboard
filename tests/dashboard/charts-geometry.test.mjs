import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { scaleLinear, niceTicks, barLayout, linePoints, arcRatio } = await load(
	'../../src/dashboard/dataset/charts/geometry.ts',
);

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
	const ticks = niceTicks(0, 0, 4);
	assert.deepEqual(ticks, [0, 0.5, 1]);
});

test('niceTicks covers negative domains', () => {
	const ticks = niceTicks(-5, 5, 4);
	assert.equal(ticks[0], -5);
	assert.equal(ticks[ticks.length - 1], 5);
});

test('barLayout returns one bar per value and keeps zero values visible', () => {
	const bars = barLayout([0, 10], 100, 50, 4);
	assert.equal(bars.length, 2);
	assert.equal(bars[0].h, 1);
	assert.equal(bars[1].h, 50);
	assert.equal(bars[1].y, 0);
	assert.ok(bars[0].x < bars[1].x);
	assert.equal(barLayout([], 100, 50).length, 0);
});

test('barLayout clamps negatives to a hairline', () => {
	const bars = barLayout([-4, 8], 100, 40, 0);
	assert.equal(bars[0].h, 1);
	assert.equal(bars[1].h, 40);
});

test('linePoints spreads values across the width', () => {
	const points = linePoints([0, 5, 10], 100, 40);
	assert.equal(points.length, 3);
	assert.deepEqual(
		points.map((point) => point.x),
		[0, 50, 100],
	);
	assert.equal(points[0].y, 40);
	assert.equal(points[2].y, 0);
});

test('linePoints places a single value at the origin', () => {
	const points = linePoints([5], 100, 40);
	assert.deepEqual(points, [{ x: 0, y: 0 }]);
	assert.equal(linePoints([], 100, 40).length, 0);
});

test('arcRatio clamps to [0, 1] and guards a zero total', () => {
	assert.equal(arcRatio(5, 10), 0.5);
	assert.equal(arcRatio(20, 10), 1);
	assert.equal(arcRatio(-1, 10), 0);
	assert.equal(arcRatio(1, 0), 0);
	assert.equal(arcRatio(1, Number.NaN), 0);
});
