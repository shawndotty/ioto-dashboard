import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	applyArrange,
	arrangeColumnsFor,
	arrangeFiltersActive,
	filterColumnsForObject,
	groupsForObject,
	matchesRowFilter,
	normalizeArrange,
	operatorsForColumn,
	parseArrange,
	sameFilters,
	serializeArrange,
	sortColumnsForObject,
} = await load('../../src/dashboard/dataset/presentation.ts');

const NOTE_COLUMNS = [
	{ key: 'note', labelKey: 'DATASET_COL_NOTE', type: 'text' },
	{ key: 'folder', labelKey: 'DATASET_COL_FOLDER', type: 'path' },
	{ key: 'ioType', labelKey: 'DATASET_COL_IO_TYPE', type: 'text' },
	{ key: 'tasks', labelKey: 'DATASET_COL_TASKS', type: 'number' },
	{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
	{ key: 'size', labelKey: 'DATASET_COL_SIZE', type: 'size' },
	{ key: 'mtime', labelKey: 'DATASET_COL_MTIME', type: 'date' },
];

const TASK_COLUMNS = [
	{ key: 'text', labelKey: 'DATASET_COL_TEXT', type: 'text' },
	{ key: 'note', labelKey: 'DATASET_COL_NOTE', type: 'text' },
	{ key: 'project', labelKey: 'DATASET_COL_PROJECT', type: 'text' },
	{ key: 'section', labelKey: 'DATASET_COL_SECTION', type: 'text' },
	{ key: 'status', labelKey: 'DATASET_COL_STATUS', type: 'text' },
];

function note(id, { folder = 'X', ioType = 'Input', mtime = 0 } = {}) {
	return {
		id,
		cells: {
			note: { text: id, path: id },
			folder: { text: folder, path: folder },
			ioType: { text: ioType },
			mtime: { text: String(mtime), sortValue: mtime },
		},
	};
}

test('parseArrange tolerates bad JSON and unknown versions', () => {
	assert.deepEqual(parseArrange(undefined), { v: 1 });
	assert.deepEqual(parseArrange(''), { v: 1 });
	assert.deepEqual(parseArrange('{not json'), { v: 1 });
	assert.deepEqual(parseArrange('{"v":2,"group":"folder"}'), { v: 1 });
	assert.deepEqual(parseArrange([]), { v: 1 });
});

test('parseArrange reads a compact spec and drops malformed parts', () => {
	const spec = parseArrange(
		JSON.stringify({
			v: 1,
			group: 'none',
			sort: { key: 'mtime', dir: -1 },
			filters: [
				{ key: 'note', op: 'contains', value: 'a' },
				{ key: 'note', op: 'bogus' },
				null,
			],
		}),
	);
	assert.deepEqual(spec, {
		v: 1,
		sort: { key: 'mtime', dir: -1 },
		filters: [{ key: 'note', op: 'contains', value: 'a' }],
	});
});

test('normalizeArrange keeps valid dimensions and columns only', () => {
	const normalized = normalizeArrange(
		{
			v: 1,
			group: 'status',
			sort: { key: 'note', dir: 1 },
			filters: [
				{ key: 'note', op: 'contains', value: 'x' },
				{ key: 'missing', op: 'is', value: 'y' },
				{ key: 'note', op: 'between', value: '1', value2: '2' },
			],
		},
		NOTE_COLUMNS,
		'note',
	);
	assert.deepEqual(normalized, {
		v: 1,
		sort: { key: 'note', dir: 1 },
		filters: [{ key: 'note', op: 'contains', value: 'x' }],
	});
});

test('serializeArrange drops an empty spec and round-trips', () => {
	assert.equal(serializeArrange({ v: 1 }), undefined);
	const raw = serializeArrange({
		v: 1,
		group: 'folder',
		sort: { key: 'mtime', dir: -1 },
		filters: [{ key: 'ioType', op: 'is', value: 'Input' }],
	});
	assert.deepEqual(parseArrange(raw), {
		v: 1,
		group: 'folder',
		sort: { key: 'mtime', dir: -1 },
		filters: [{ key: 'ioType', op: 'is', value: 'Input' }],
	});
});

test('operators follow the column type', () => {
	assert.deepEqual(operatorsForColumn('text'), [
		'contains',
		'notContains',
		'is',
		'isNot',
		'empty',
		'notEmpty',
	]);
	const numeric = operatorsForColumn('number');
	assert.ok(numeric.includes('gt'));
	assert.ok(numeric.includes('between'));
	assert.ok(!operatorsForColumn('path').includes('between'));
});

test('groupsForObject exposes a fixed whitelist per object', () => {
	assert.deepEqual(groupsForObject('note'), ['none', 'ioType', 'folder']);
	assert.deepEqual(groupsForObject('task'), [
		'none',
		'project',
		'section',
		'status',
	]);
	assert.deepEqual(groupsForObject('project'), ['none']);
});

test('matchesRowFilter supports text, numeric and range operators', () => {
	const columns = NOTE_COLUMNS;
	const item = note('Alpha.md', { folder: 'X', mtime: 100 });
	assert.equal(
		matchesRowFilter(item, { key: 'note', op: 'contains', value: 'alp' }, columns),
		true,
	);
	assert.equal(
		matchesRowFilter(item, { key: 'note', op: 'is', value: 'Alpha.md' }, columns),
		true,
	);
	assert.equal(
		matchesRowFilter(item, { key: 'folder', op: 'isNot', value: 'X' }, columns),
		false,
	);
	assert.equal(
		matchesRowFilter(item, { key: 'mtime', op: 'gt', value: '50' }, columns),
		true,
	);
	assert.equal(
		matchesRowFilter(item, { key: 'mtime', op: 'lt', value: '50' }, columns),
		false,
	);
	assert.equal(
		matchesRowFilter(
			item,
			{ key: 'mtime', op: 'between', value: '50', value2: '150' },
			columns,
		),
		true,
	);
});

test('empty and notEmpty ignore the filter value', () => {
	const blank = { id: 'blank', cells: { note: { text: '  ' } } };
	const filled = note('filled.md');
	assert.equal(
		matchesRowFilter(blank, { key: 'note', op: 'empty' }, NOTE_COLUMNS),
		true,
	);
	assert.equal(
		matchesRowFilter(filled, { key: 'note', op: 'empty' }, NOTE_COLUMNS),
		false,
	);
	assert.equal(
		matchesRowFilter(filled, { key: 'note', op: 'notEmpty' }, NOTE_COLUMNS),
		true,
	);
});

test('applyArrange defaults to newest first with a path tie-break', () => {
	const rows = [
		note('b.md', { mtime: 100 }),
		note('a.md', { mtime: 100 }),
		note('new.md', { mtime: 300 }),
	];
	const result = applyArrange(rows, { v: 1 }, {
		columns: NOTE_COLUMNS,
		defaultSort: { key: 'mtime', dir: -1 },
	});
	assert.deepEqual(
		result.rows.map((item) => item.id),
		['new.md', 'a.md', 'b.md'],
	);
	assert.deepEqual(result.segments, []);
});

test('an explicit sort overrides the default and stays stable', () => {
	const rows = [
		note('c.md', { ioType: 'Output' }),
		note('a.md', { ioType: 'Input' }),
		note('b.md', { ioType: 'Input' }),
	];
	const result = applyArrange(rows, { v: 1, sort: { key: 'ioType', dir: 1 } }, {
		columns: NOTE_COLUMNS,
		defaultSort: { key: 'mtime', dir: -1 },
	});
	assert.deepEqual(
		result.rows.map((item) => item.id),
		['a.md', 'b.md', 'c.md'],
	);
});

test('filters are ANDed and grouping reports full segment counts', () => {
	const rows = [
		note('a.md', { folder: 'X', ioType: 'Input' }),
		note('b.md', { folder: 'Y', ioType: 'Input' }),
		note('c.md', { folder: 'X', ioType: 'Input' }),
		note('d.md', { folder: 'X', ioType: 'Output' }),
	];
	const result = applyArrange(
		rows,
		{
			v: 1,
			group: 'folder',
			sort: { key: 'folder', dir: 1 },
			filters: [{ key: 'ioType', op: 'is', value: 'Input' }],
		},
		{ columns: NOTE_COLUMNS },
	);
	assert.deepEqual(
		result.rows.map((item) => item.id),
		['a.md', 'c.md', 'b.md'],
	);
	assert.deepEqual(result.segments, [
		{ group: 'folder', label: 'X', count: 2, start: 0 },
		{ group: 'folder', label: 'Y', count: 1, start: 2 },
	]);
});

test('grouping without a matching sort keeps first-appearance segments', () => {
	const rows = [
		note('a.md', { folder: 'X' }),
		note('b.md', { folder: 'Y' }),
		note('c.md', { folder: 'X' }),
	];
	const result = applyArrange(
		rows,
		{ v: 1, group: 'folder', sort: { key: 'note', dir: 1 } },
		{ columns: NOTE_COLUMNS },
	);
	assert.deepEqual(result.segments, [
		{ group: 'folder', label: 'X', count: 1, start: 0 },
		{ group: 'folder', label: 'Y', count: 1, start: 1 },
		{ group: 'folder', label: 'X', count: 1, start: 2 },
	]);
});

test('filters can empty the result without grouping', () => {
	const rows = [note('a.md'), note('b.md')];
	const result = applyArrange(
		rows,
		{ v: 1, filters: [{ key: 'note', op: 'contains', value: 'zzz' }] },
		{ columns: NOTE_COLUMNS },
	);
	assert.deepEqual(result.rows, []);
	assert.deepEqual(result.segments, []);
});

test('arrangeFiltersActive and sameFilters treat undefined as empty', () => {
	assert.equal(arrangeFiltersActive({ v: 1 }), false);
	assert.equal(
		arrangeFiltersActive({ v: 1, filters: [{ key: 'note', op: 'is' }] }),
		true,
	);
	assert.equal(sameFilters(undefined, []), true);
	assert.equal(
		sameFilters([{ key: 'note', op: 'is', value: 'a' }], [
			{ key: 'note', op: 'is', value: 'a' },
		]),
		true,
	);
	assert.equal(
		sameFilters([{ key: 'note', op: 'is', value: 'a' }], [
			{ key: 'note', op: 'is', value: 'b' },
		]),
		false,
	);
});

test('arrangeColumnsFor hides note completion fields but keeps the rest in order', () => {
	const source = JSON.parse(JSON.stringify(NOTE_COLUMNS));
	const result = arrangeColumnsFor('note', source);
	const keys = result.map((column) => column.key);
	assert.deepEqual(keys, ['note', 'folder', 'ioType', 'size', 'mtime']);
	assert.ok(!keys.includes('tasks'));
	assert.ok(!keys.includes('completed'));
	// Same objects, same types, original order preserved — no cloning/renaming.
	assert.deepEqual(
		result.map((column) => [column.key, column.type]),
		[
			['note', 'text'],
			['folder', 'path'],
			['ioType', 'text'],
			['size', 'size'],
			['mtime', 'date'],
		],
	);
	// Non-destructive: the input array is untouched.
	assert.deepEqual(source, NOTE_COLUMNS);
});

test('arrangeColumnsFor keeps every task column including status', () => {
	const result = arrangeColumnsFor('task', TASK_COLUMNS);
	assert.deepEqual(result.map((column) => column.key), [
		'text',
		'note',
		'project',
		'section',
		'status',
	]);
});

test('arrangeColumnsFor handles unknown objects and empty input', () => {
	assert.deepEqual(arrangeColumnsFor('unknown', TASK_COLUMNS), TASK_COLUMNS);
	assert.deepEqual(arrangeColumnsFor('note', []), []);
});

test('sort/filter column helpers share one whitelist', () => {
	assert.deepEqual(sortColumnsForObject('note', NOTE_COLUMNS), arrangeColumnsFor('note', NOTE_COLUMNS));
	assert.deepEqual(filterColumnsForObject('note', NOTE_COLUMNS), arrangeColumnsFor('note', NOTE_COLUMNS));
	assert.deepEqual(sortColumnsForObject('task', TASK_COLUMNS), filterColumnsForObject('task', TASK_COLUMNS));
});

test('normalizeArrange trims a stored completion field that is no longer offered', () => {
	const normalized = normalizeArrange(
		{
			v: 1,
			sort: { key: 'completed', dir: -1 },
			filters: [{ key: 'tasks', op: 'gte', value: '2' }],
		},
		arrangeColumnsFor('note', NOTE_COLUMNS),
		'note',
	);
	assert.deepEqual(normalized, { v: 1 });
});