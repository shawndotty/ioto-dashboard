import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { pageCountOf, clampPage, pageBounds, nextPagingState } = await load(
	'../../src/dashboard/ui/pager.ts',
);

test('pageCountOf treats an empty list as one page', () => {
	assert.equal(pageCountOf(0, 20), 1);
	assert.equal(pageCountOf(20, 10), 2);
	assert.equal(pageCountOf(21, 10), 3);
	assert.equal(pageCountOf(5, 0), 1);
});

test('clampPage keeps pages inside [1, pageCount]', () => {
	assert.equal(clampPage(0, 5), 1);
	assert.equal(clampPage(Number.NaN, 5), 1);
	assert.equal(clampPage(99, 5), 5);
	assert.equal(clampPage(2.9, 5), 2);
});

test('pageBounds returns a 1-based inclusive item range', () => {
	assert.deepEqual(pageBounds(2, 20, 87), { from: 21, to: 40 });
	assert.deepEqual(pageBounds(5, 20, 87), { from: 81, to: 87 });
	assert.deepEqual(pageBounds(1, 20, 0), { from: 0, to: 0 });
});

test('nextPagingState treats an empty list as one page at page 1', () => {
	assert.deepEqual(nextPagingState(0, 20, 3, false), {
		page: 1,
		pageCount: 1,
	});
});

test('nextPagingState re-counts pages from the new total', () => {
	assert.deepEqual(nextPagingState(41, 20, 1, false), {
		page: 1,
		pageCount: 3,
	});
	assert.deepEqual(nextPagingState(5, 20, 1, false), {
		page: 1,
		pageCount: 1,
	});
});

test('nextPagingState clamps a page that no longer exists', () => {
	assert.deepEqual(nextPagingState(25, 20, 4, false), {
		page: 2,
		pageCount: 2,
	});
});

test('nextPagingState resets to the first page when asked', () => {
	assert.deepEqual(nextPagingState(87, 20, 3, true), {
		page: 1,
		pageCount: 5,
	});
});
