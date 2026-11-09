import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	dropIndex,
	moveItem,
	moveById,
	stepSize,
	resizeByDelta,
	gridMetrics,
} = await load('../../src/dashboard/layout.ts');

const {
	MIN_COMPONENT_W,
	MIN_COMPONENT_H,
	MAX_COMPONENT_W,
	MAX_COMPONENT_H,
} = await load('../../src/dashboard/registry.ts');

function component(id, overrides = {}) {
	return { id, type: 'kpi', queryId: 'builtin:tasks-all', ...overrides };
}

function rect(id, top, left, width = 100, height = 72) {
	return { id, top, left, width, height };
}

test('moveItem moves forward and backward without mutating the input', () => {
	const source = ['a', 'b', 'c', 'd'];

	assert.deepEqual(moveItem(source, 0, 2), ['b', 'c', 'a', 'd']);
	assert.deepEqual(moveItem(source, 3, 1), ['a', 'd', 'b', 'c']);
	assert.deepEqual(source, ['a', 'b', 'c', 'd']);
});

test('moveItem clamps indexes and short-circuits no-ops', () => {
	const source = ['a', 'b', 'c'];

	assert.deepEqual(moveItem(source, 2, 2), ['a', 'b', 'c']);
	assert.deepEqual(moveItem(source, 99, 0), ['c', 'a', 'b']);
	assert.deepEqual(moveItem(source, -5, 99), ['b', 'c', 'a']);
	assert.deepEqual(moveItem([], 0, 1), []);
});

test('moveById keeps the list intact when the id is unknown', () => {
	const list = [component('a'), component('b'), component('c')];

	assert.deepEqual(
		moveById(list, 'a', 2).map((item) => item.id),
		['b', 'c', 'a'],
	);
	assert.deepEqual(
		moveById(list, 'c', 0).map((item) => item.id),
		['c', 'a', 'b'],
	);
	assert.deepEqual(
		moveById(list, 'missing', 1).map((item) => item.id),
		['a', 'b', 'c'],
	);
	assert.deepEqual(
		list.map((item) => item.id),
		['a', 'b', 'c'],
	);
});

test('stepSize walks to the registry bounds and stops there', () => {
	assert.deepEqual(stepSize(3, 2, 'w', 1), { w: 4, h: 2 });
	assert.deepEqual(stepSize(MAX_COMPONENT_W, 2, 'w', 1), {
		w: MAX_COMPONENT_W,
		h: 2,
	});
	assert.deepEqual(stepSize(MIN_COMPONENT_W, 2, 'w', -1), {
		w: MIN_COMPONENT_W,
		h: 2,
	});
	assert.deepEqual(stepSize(3, MAX_COMPONENT_H, 'h', 1), {
		w: 3,
		h: MAX_COMPONENT_H,
	});
	assert.deepEqual(stepSize(3, MIN_COMPONENT_H, 'h', -1), {
		w: 3,
		h: MIN_COMPONENT_H,
	});
	assert.deepEqual(stepSize(undefined, undefined, 'h', 1), { w: 3, h: 3 });
});

test('resizeByDelta rounds to whole steps and clamps to bounds', () => {
	const metrics = gridMetrics(1200, 12, 12, 72); // stepX ≈ 111, stepY = 84

	const positive = resizeByDelta(3, 2, metrics.stepX * 2, metrics.stepY, metrics);
	assert.equal(positive.dw, 2);
	assert.equal(positive.dh, 1);
	assert.deepEqual({ w: positive.w, h: positive.h }, { w: 5, h: 3 });

	const negative = resizeByDelta(5, 3, -metrics.stepX, -metrics.stepY * 2, metrics);
	assert.deepEqual({ w: negative.w, h: negative.h }, { w: 4, h: 1 });

	const halfStep = resizeByDelta(3, 2, metrics.stepX * 0.4, metrics.stepY * 0.4, metrics);
	assert.deepEqual({ w: halfStep.w, h: halfStep.h, dw: halfStep.dw, dh: halfStep.dh }, {
		w: 3,
		h: 2,
		dw: 0,
		dh: 0,
	});

	const clamped = resizeByDelta(MAX_COMPONENT_W, MAX_COMPONENT_H, 1e6, 1e6, metrics);
	assert.deepEqual({ w: clamped.w, h: clamped.h }, {
		w: MAX_COMPONENT_W,
		h: MAX_COMPONENT_H,
	});
});

test('gridMetrics keeps a usable step for degenerate input', () => {
	const zero = gridMetrics(0, 12, 12, 72);
	assert.ok(zero.columnWidth >= 1);
	assert.ok(zero.stepX > 0);
	assert.ok(zero.stepY > 0);

	const negativeGap = gridMetrics(600, 12, -5, 72);
	assert.equal(negativeGap.stepX, negativeGap.columnWidth);
	assert.ok(negativeGap.stepX > 0);

	const garbage = gridMetrics(Number.NaN, 0, Number.NaN, Number.NaN);
	assert.ok(garbage.stepX > 0);
	assert.ok(garbage.stepY > 0);
});

test('dropIndex maps the pointer to a reading-order insertion point', () => {
	const rects = [
		rect('a', 0, 0),
		rect('b', 0, 112),
		rect('c', 84, 0),
	];

	assert.equal(dropIndex([], 0, 0, 'a'), 0);
	assert.equal(dropIndex(rects, 10, 10, 'dragged'), 0);
	assert.equal(dropIndex(rects, 90, 10, 'dragged'), 1);
	assert.equal(dropIndex(rects, 300, 10, 'dragged'), 2);
	assert.equal(dropIndex(rects, 10, 90, 'dragged'), 2);
	assert.equal(dropIndex(rects, 10, 300, 'dragged'), 3);
});

test('dropIndex ignores the dragged rect and returns an index in the filtered list', () => {
	const rects = [
		rect('a', 0, 0),
		rect('dragged', 0, 112),
		rect('c', 0, 224),
	];

	assert.equal(dropIndex(rects, 0, 10, 'dragged'), 0);
	assert.equal(dropIndex(rects, 200, 10, 'dragged'), 1);
	assert.equal(dropIndex(rects, 400, 10, 'dragged'), 2);
});
