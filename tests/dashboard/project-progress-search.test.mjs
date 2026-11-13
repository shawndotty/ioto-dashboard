import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { matchesProjectGroup } = await load(
	'../../src/dashboard/components/project-progress.ts',
);

test('an empty or blank query matches every group', () => {
	assert.equal(matchesProjectGroup('Alpha', ''), true);
	assert.equal(matchesProjectGroup('Alpha', '   '), true);
});

test('group names match case-insensitively', () => {
	assert.equal(matchesProjectGroup('IOTO Dashboard', 'dashboard'), true);
	assert.equal(matchesProjectGroup('IOTO Dashboard', 'DASHBOARD'), true);
	assert.equal(matchesProjectGroup('IOTO Dashboard', 'totally'), false);
});

test('substrings match without tokenization', () => {
	assert.equal(matchesProjectGroup('IOTO Dashboard', 'oto'), true);
	assert.equal(matchesProjectGroup('IOTO Dashboard', 'shbo'), true);
});

test('chinese names match by substring', () => {
	assert.equal(matchesProjectGroup('未分类', '分类'), true);
	assert.equal(matchesProjectGroup('未分類', '分類'), true);
	assert.equal(matchesProjectGroup('未分类', '專案'), false);
});

test('the query is trimmed before matching', () => {
	assert.equal(matchesProjectGroup('Alpha', '  ph  '), true);
});

test('an empty name only matches an empty query', () => {
	assert.equal(matchesProjectGroup('', ''), true);
	assert.equal(matchesProjectGroup('', 'a'), false);
});
