import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { sortNoteRows } = await load(
	'../../src/dashboard/components/note-list.ts',
);

function row(path, mtime) {
	return {
		id: path,
		cells: {
			note: { text: path, path },
			mtime: mtime === undefined ? {} : { text: String(mtime), sortValue: mtime },
		},
	};
}

test('rows sort by modification time, newest first', () => {
	const sorted = sortNoteRows([
		row('a.md', 100),
		row('b.md', 300),
		row('c.md', 200),
	]);
	assert.deepEqual(
		sorted.map((item) => item.id),
		['b.md', 'c.md', 'a.md'],
	);
});

test('equal timestamps fall back to ascending path order', () => {
	const sorted = sortNoteRows([
		row('z.md', 100),
		row('a.md', 100),
		row('m.md', 100),
	]);
	assert.deepEqual(
		sorted.map((item) => item.id),
		['a.md', 'm.md', 'z.md'],
	);
});

test('a missing sortValue is treated as zero', () => {
	const sorted = sortNoteRows([row('old.md', 0), row('new.md', 50), row('none.md')]);
	assert.deepEqual(
		sorted.map((item) => item.id),
		['new.md', 'none.md', 'old.md'],
	);
});

test('sorting does not mutate the input array', () => {
	const rows = [row('a.md', 1), row('b.md', 2)];
	const sorted = sortNoteRows(rows);
	assert.deepEqual(
		rows.map((item) => item.id),
		['a.md', 'b.md'],
	);
	assert.notEqual(sorted, rows);
});
