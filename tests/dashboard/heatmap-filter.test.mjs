import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	EMPTY_HEATMAP_FILTER,
	matchesHeatmapCount,
	heatmapFilterActive,
	clampHeatmapFilter,
} = await load('../../src/dashboard/dataset/heatmap-filter.ts');

function filter(overrides = {}) {
	return { ...EMPTY_HEATMAP_FILTER, ...overrides };
}

test('an open filter matches everything and is inactive', () => {
	assert.equal(matchesHeatmapCount(0, filter()), true);
	assert.equal(matchesHeatmapCount(99, filter()), true);
	assert.equal(heatmapFilterActive(filter()), false);
});

test('bounds are inclusive on both ends', () => {
	assert.equal(matchesHeatmapCount(3, filter({ min: 3 })), true);
	assert.equal(matchesHeatmapCount(3, filter({ max: 3 })), true);
	assert.equal(matchesHeatmapCount(2, filter({ min: 3 })), false);
	assert.equal(matchesHeatmapCount(4, filter({ max: 3 })), false);
	assert.equal(matchesHeatmapCount(3, filter({ min: 3, max: 3 })), true);
	assert.equal(matchesHeatmapCount(0, filter({ min: 1 })), false);
	assert.equal(heatmapFilterActive(filter({ min: 1 })), true);
	assert.equal(heatmapFilterActive(filter({ max: 5 })), true);
});

test('clamping truncates, floors at zero and caps at the peak', () => {
	assert.deepEqual(clampHeatmapFilter(filter({ min: -4, max: 99 }), 10), {
		min: 0,
		max: 10,
		hideMiss: false,
	});
	assert.deepEqual(clampHeatmapFilter(filter({ min: 2.9, max: null }), 10), {
		min: 2,
		max: null,
		hideMiss: false,
	});
});

test('clamping swaps inverted bounds and keeps hideMiss', () => {
	assert.deepEqual(
		clampHeatmapFilter(filter({ min: 8, max: 2, hideMiss: true }), 10),
		{ min: 2, max: 8, hideMiss: true },
	);
});

test('a zero peak clears the range but keeps hideMiss', () => {
	assert.deepEqual(clampHeatmapFilter(filter({ min: 1, max: 3, hideMiss: true }), 0), {
		min: null,
		max: null,
		hideMiss: true,
	});
});

test('non-finite input is treated as unbounded', () => {
	assert.deepEqual(clampHeatmapFilter(filter({ min: Number.NaN, max: 4 }), 10), {
		min: null,
		max: 4,
		hideMiss: false,
	});
});

test('an empty model with min 1 matches no day', () => {
	const matching = [0, 0, 0].filter((count) =>
		matchesHeatmapCount(count, filter({ min: 1 })),
	);
	assert.deepEqual(matching, []);
});
