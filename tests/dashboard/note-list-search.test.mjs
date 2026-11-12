import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { matchesNoteRow } = await load(
	'../../src/dashboard/components/note-list.ts',
);

const row = (cells) => ({ id: 'r1', cells });

test('an empty or blank query matches every row', () => {
	assert.equal(matchesNoteRow(row({}), ''), true);
	assert.equal(
		matchesNoteRow(row({ note: { text: 'anything' } }), '   '),
		true,
	);
});

test('the note title matches case-insensitively', () => {
	const value = row({ note: { text: 'Report 20261112' } });
	assert.equal(matchesNoteRow(value, 'report'), true);
	assert.equal(matchesNoteRow(value, 'REPORT 20261112'), true);
	assert.equal(matchesNoteRow(value, 'missing'), false);
});

test('folder and io type are also searched', () => {
	const value = row({
		note: { text: 'Weekly Review' },
		folder: { text: '4-成果/IOTO Dashboard/Report' },
		ioType: { text: 'Outcome' },
	});
	assert.equal(matchesNoteRow(value, 'dashboard'), true);
	assert.equal(matchesNoteRow(value, 'outcome'), true);
	assert.equal(matchesNoteRow(value, 'weekly'), true);
});

test('missing cells are treated as empty text', () => {
	assert.equal(matchesNoteRow(row({}), 'search'), false);
	assert.equal(matchesNoteRow(row({ note: {} }), 'search'), false);
});

test('the query is trimmed and chinese substrings match', () => {
	const value = row({ note: { text: '优化自定义组件的搜索体验' } });
	assert.equal(matchesNoteRow(value, '  搜索  '), true);
	assert.equal(matchesNoteRow(value, '组件'), true);
	assert.equal(matchesNoteRow(value, '分页'), false);
});
