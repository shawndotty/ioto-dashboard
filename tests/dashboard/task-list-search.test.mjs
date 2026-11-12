import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { matchesTaskRow } = await load(
	'../../src/dashboard/components/task-list.ts',
);

const row = (cells) => ({ id: 'r1', cells });

test('an empty or blank query matches every row', () => {
	assert.equal(matchesTaskRow(row({}), ''), true);
	assert.equal(matchesTaskRow(row({ text: { text: 'anything' } }), '   '), true);
});

test('task text matches case-insensitively', () => {
	const value = row({ text: { text: 'Write the Release Notes' } });
	assert.equal(matchesTaskRow(value, 'release'), true);
	assert.equal(matchesTaskRow(value, 'RELEASE NOTES'), true);
	assert.equal(matchesTaskRow(value, 'changelog'), false);
});

test('note name and project name are also searched', () => {
	const value = row({
		text: { text: 'do the thing' },
		note: { text: 'Weekly Review' },
		project: { text: 'IOTO Dashboard' },
	});
	assert.equal(matchesTaskRow(value, 'weekly'), true);
	assert.equal(matchesTaskRow(value, 'dashboard'), true);
	assert.equal(matchesTaskRow(value, 'thing'), true);
	assert.equal(matchesTaskRow(value, 'missing'), false);
});

test('missing cells are treated as empty text', () => {
	assert.equal(matchesTaskRow(row({}), 'search'), false);
	assert.equal(matchesTaskRow(row({ text: {} }), 'search'), false);
});

test('the query is trimmed before matching', () => {
	const value = row({ text: { text: 'Plan the sprint' } });
	assert.equal(matchesTaskRow(value, '  sprint  '), true);
});

test('chinese substrings match without tokenization', () => {
	const value = row({ text: { text: '优化自定义组件的搜索体验' } });
	assert.equal(matchesTaskRow(value, '搜索'), true);
	assert.equal(matchesTaskRow(value, '组件'), true);
	assert.equal(matchesTaskRow(value, '分页'), false);
});
