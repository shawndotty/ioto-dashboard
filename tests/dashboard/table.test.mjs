import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	matchesTableRow,
	compareTableValues,
	sortTableRows,
	groupTableRows,
	resolveTableGroup,
	resolveGroupFor,
	groupsForObject,
	groupLabelKey,
} = await load('../../src/dashboard/dataset/views/table.ts');
const { parseColumnSelection } = await load(
	'../../src/dashboard/dataset/columns.ts',
);
const { clampPage, nextPagingState, pageCountOf } = await load(
	'../../src/dashboard/ui/pager.ts',
);

function row(id, cells) {
	const mapped = {};
	for (const [key, value] of Object.entries(cells)) {
		mapped[key] =
			typeof value === 'object' ? value : { text: String(value) };
	}
	return { id, cells: mapped };
}

const ROWS = [
	row('a', { note: '第2章', project: 'Alpha', status: 'open', mtime: { text: '2026-01-02', sortValue: 2 } }),
	row('b', { note: '第10章', project: 'Beta', status: 'done', mtime: { text: '2026-01-10', sortValue: 10 } }),
	row('c', { note: 'chapter one', project: 'Alpha', status: 'open', mtime: { text: '2026-01-01', sortValue: 1 } }),
];

test('row search spans every column and ignores case', () => {
	assert.equal(matchesTableRow(ROWS[0], ''), true);
	assert.equal(matchesTableRow(ROWS[0], '   '), true);
	assert.equal(matchesTableRow(ROWS[0], 'alpha'), true);
	assert.equal(matchesTableRow(ROWS[0], 'DONE'), false);
	assert.equal(matchesTableRow(ROWS[1], 'DONE'), true);
	assert.equal(matchesTableRow(ROWS[1], '第1'), true);
	assert.equal(matchesTableRow(ROWS[2], 'CHAPTER'), true);
	assert.equal(matchesTableRow(ROWS[2], 'missing'), false);
});

test('values compare numerically and with numeric-aware locale order', () => {
	assert.ok(compareTableValues(2, 10, 1) < 0);
	assert.ok(compareTableValues(2, 10, -1) > 0);
	// 「第2章」必须排在「第10章」之前，纯字符串比较做不到。
	assert.ok(compareTableValues('第2章', '第10章', 1) < 0);
	assert.ok(compareTableValues('alpha', 'Beta', 1) < 0);
});

test('sorting uses sortValue and can be reversed', () => {
	const asc = sortTableRows(ROWS, 'mtime', 1);
	assert.deepEqual(
		asc.map((item) => item.id),
		['c', 'a', 'b'],
	);
	const desc = sortTableRows(ROWS, 'mtime', -1);
	assert.deepEqual(
		desc.map((item) => item.id),
		['b', 'a', 'c'],
	);
});

test('grouping keeps sorted order and hides empty groups', () => {
	const groups = groupTableRows(ROWS, 'project');
	assert.deepEqual(
		groups.map((group) => group.label),
		['Alpha', 'Beta'],
	);
	assert.deepEqual(
		groups.map((group) => group.rows.length),
		[2, 1],
	);
	assert.deepEqual(groupTableRows([], 'project'), []);
	assert.deepEqual(
		groupTableRows(ROWS, 'none').map((group) => group.rows.length),
		[3],
	);
});

test('group keys fall back to the first valid dimension', () => {
	assert.equal(resolveTableGroup('status'), 'status');
	assert.equal(resolveTableGroup('status,'), 'none');
	assert.equal(resolveTableGroup(undefined), 'none');
	assert.equal(resolveTableGroup(42), 'none');
	assert.deepEqual(groupsForObject('task'), [
		'none',
		'project',
		'section',
		'status',
	]);
	assert.deepEqual(groupsForObject('folder'), ['none']);
	assert.equal(groupLabelKey('project'), 'TABLE_GROUP_PROJECT');
	assert.equal(groupLabelKey('none'), 'TABLE_GROUP_NONE');
});

test('a stored group from another object falls back to no grouping', () => {
	assert.equal(resolveGroupFor('task', 'project'), 'project');
	assert.equal(resolveGroupFor('note', 'project'), 'none');
	assert.equal(resolveGroupFor('folder', 'folder'), 'none');
	assert.equal(resolveGroupFor('file', 'extension'), 'extension');
});

test('pagination slices the sorted full row set and clamps pages', () => {
	const sorted = sortTableRows(ROWS, 'mtime', 1);
	const pageCount = pageCountOf(sorted.length, 2);
	assert.equal(pageCount, 2);
	// 排序先于分页：第 2 页拿到的仍是全局排序后的末尾行。
	const secondPage = sorted.slice(2, 4).map((item) => item.id);
	assert.deepEqual(secondPage, ['b']);

	assert.equal(pageCountOf(0, 20), 1);
	assert.equal(clampPage(5, 2), 2);
	assert.equal(clampPage(0, 2), 1);
	assert.deepEqual(nextPagingState(9, 5, 3, false), {
		page: 2,
		pageCount: 2,
	});
	assert.deepEqual(nextPagingState(9, 5, 2, true), {
		page: 1,
		pageCount: 2,
	});
});

test('column selection is stored as a trimmed comma-separated list', () => {
	assert.deepEqual(parseColumnSelection('note, folder'), ['note', 'folder']);
	assert.deepEqual(parseColumnSelection(' note ,, folder '), [
		'note',
		'folder',
	]);
	assert.equal(parseColumnSelection(''), undefined);
	assert.equal(parseColumnSelection('   '), undefined);
	assert.equal(parseColumnSelection(undefined), undefined);
	assert.equal(parseColumnSelection(['note']), undefined);
});
