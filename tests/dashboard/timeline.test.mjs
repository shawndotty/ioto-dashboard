import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { timelineDateOf, bucketKeyOf, buildTimelineRows, TIMELINE_COLUMNS } =
	await load('../../src/dashboard/dataset/timeline.ts');

const NOW = new Date(2026, 10, 11, 15, 30, 0).getTime();

function stamp(year, month, day) {
	return new Date(year, month - 1, day).getTime();
}

function record(overrides = {}) {
	return {
		basename: 'note',
		ctime: stamp(2026, 11, 1),
		mtime: stamp(2026, 11, 2),
		...overrides,
	};
}

test('filename dates parse at local midnight and reject invalid dates', () => {
	assert.equal(
		timelineDateOf(record({ basename: '2026-11-08-journal' }), 'filename'),
		stamp(2026, 11, 8),
	);
	assert.equal(
		timelineDateOf(record({ basename: 'P1 2026-02-03' }), 'filename'),
		stamp(2026, 2, 3),
	);
	assert.equal(
		timelineDateOf(record({ basename: '2026-02-30-broken' }), 'filename'),
		null,
	);
	assert.equal(
		timelineDateOf(record({ basename: 'no-date-here' }), 'filename'),
		null,
	);
});

test('auto prefers the filename then falls back to ctime', () => {
	const fromName = record({
		basename: '2026-11-05-plan',
		ctime: stamp(2026, 10, 1),
	});
	assert.equal(timelineDateOf(fromName, 'auto'), stamp(2026, 11, 5));

	const fromCtime = record({
		basename: 'plan',
		ctime: stamp(2026, 10, 1),
		mtime: stamp(2026, 11, 9),
	});
	assert.equal(timelineDateOf(fromCtime, 'auto'), stamp(2026, 10, 1));
	assert.equal(timelineDateOf(fromCtime, 'created'), stamp(2026, 10, 1));
	assert.equal(timelineDateOf(fromCtime, 'modified'), stamp(2026, 11, 9));

	assert.equal(
		timelineDateOf(record({ basename: 'plan', ctime: 0 }), 'auto'),
		null,
	);
	assert.equal(
		timelineDateOf(record({ basename: 'plan', mtime: 0 }), 'modified'),
		null,
	);
});

test('bucket keys use local days, Monday weeks and calendar months', () => {
	assert.equal(bucketKeyOf(stamp(2026, 11, 8), 'day'), '2026-11-08');
	assert.equal(bucketKeyOf(stamp(2026, 11, 8), 'week'), '2026-11-02');
	assert.equal(bucketKeyOf(stamp(2026, 11, 1), 'week'), '2026-10-26');
	assert.equal(bucketKeyOf(stamp(2027, 1, 1), 'week'), '2026-12-28');
	assert.equal(bucketKeyOf(stamp(2026, 11, 8), 'month'), '2026-11');
});

test('a 7-day window fills every day and drops future or out-of-range rows', () => {
	const columns = TIMELINE_COLUMNS.task;
	const records = [
		record({ basename: '2026-11-11-a' }),
		record({ basename: '2026-11-11-b' }),
		record({ basename: '2026-11-09-c' }),
		record({ basename: '2026-11-04-out' }),
		record({ basename: '2026-11-20-future' }),
	];
	const result = buildTimelineRows(
		records,
		{ bucket: 'day', dateField: 'filename', range: 7, now: () => NOW },
		columns,
	);
	assert.equal(result.sourceTotal, 3);
	assert.equal(result.rows.length, 7);
	assert.equal(result.rows[0].cells.date.text, '2026-11-05');
	assert.equal(result.rows[6].cells.date.text, '2026-11-11');
	assert.equal(result.rows[0].cells.total.text, '0');
	assert.equal(result.rows[4].cells.total.text, '1');
	assert.equal(result.rows[6].cells.total.text, '2');
});

test('week buckets dedupe the padded window days', () => {
	const result = buildTimelineRows(
		[record({ basename: '2026-11-09-a' })],
		{ bucket: 'week', dateField: 'filename', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.task,
	);
	assert.deepEqual(
		result.rows.map((row) => row.cells.date.text),
		['2026-11-02', '2026-11-09'],
	);
	assert.equal(result.rows[1].cells.total.text, '1');
});

test('month buckets collapse the window into calendar months', () => {
	const result = buildTimelineRows(
		[
			record({ basename: '2026-10-15-a' }),
			record({ basename: '2026-11-02-b' }),
			record({ basename: '2026-11-10-c' }),
		],
		{ bucket: 'month', dateField: 'filename', range: 30, now: () => NOW },
		TIMELINE_COLUMNS.task,
	);
	assert.deepEqual(
		result.rows.map((row) => row.cells.date.text),
		['2026-10', '2026-11'],
	);
	assert.deepEqual(
		result.rows.map((row) => row.cells.total.text),
		['1', '2'],
	);
});

test('numeric columns sum per bucket and size stays formatted', () => {
	const records = [
		record({ basename: '2026-11-10-a', tasks: 2, completed: 1, size: 1024 }),
		record({ basename: '2026-11-10-b', tasks: 3, completed: 2, size: 2048 }),
	];
	const result = buildTimelineRows(
		records,
		{ bucket: 'day', dateField: 'filename', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.note,
	);
	const bucketRow = result.rows[5];
	assert.equal(bucketRow.cells.total.text, '2');
	assert.equal(bucketRow.cells.tasks.sortValue, 5);
	assert.equal(bucketRow.cells.completed.sortValue, 3);
	assert.equal(bucketRow.cells.size.text, '3 KB');
	assert.equal(bucketRow.cells.size.sortValue, 3072);
});

test('an empty source turns into empty rows instead of a zero line', () => {
	const result = buildTimelineRows(
		[record({ basename: '2026-10-01-old' })],
		{ bucket: 'day', dateField: 'filename', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.file,
	);
	assert.equal(result.sourceTotal, 0);
	assert.deepEqual(result.rows, []);
});

test('timeline buckets keep the original records that produced them', () => {
	const records = [
		record({
			basename: '2026-11-10-a',
			path: '3-任务/a.md',
			line: 4,
			text: 'write report',
			kind: 'task',
			marker: 'done',
		}),
		record({
			basename: '2026-11-10-b',
			path: '3-任务/b.md',
			line: 9,
			text: 'review plan',
			kind: 'task',
			marker: 'open',
		}),
		record({
			basename: '2026-11-10-c',
			path: '3-任务/c.md',
			line: 2,
			text: 'ship change',
			kind: 'task',
			marker: 'open',
		}),
	];
	const result = buildTimelineRows(
		records,
		{ bucket: 'day', dateField: 'filename', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.task,
	);
	const row = result.rows.find((entry) => entry.id === '2026-11-10');
	assert.equal(row.related.length, 3);
	assert.equal(row.relatedTotal, 3);
	assert.deepEqual(
		row.related.map((ref) => ref.label),
		['write report', 'review plan', 'ship change'],
	);
	assert.equal(row.related[0].line, 4);
	assert.equal(row.related[0].kind, 'task');
	assert.equal(row.related[0].date, '2026-11-10');
	assert.equal(row.related[0].marker, 'done');
});

test('bucket refs are capped at 500 while the total keeps counting', () => {
	const records = Array.from({ length: 501 }, (_, index) =>
		record({
			basename: `2026-11-10-${index}`,
			path: `3-任务/${index}.md`,
			line: index,
			text: `task ${index}`,
			kind: 'task',
		}),
	);
	const result = buildTimelineRows(
		records,
		{ bucket: 'day', dateField: 'filename', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.task,
	);
	const row = result.rows.find((entry) => entry.id === '2026-11-10');
	assert.equal(row.related.length, 500);
	assert.equal(row.relatedTotal, 501);
	assert.equal(row.cells.total.sortValue, 501);
});

test('note and file timelines label refs with basenames and local days', () => {
	const notes = buildTimelineRows(
		[
			record({
				basename: '2026-11-10-journal',
				path: '2-输出/2026-11-10-journal.md',
				kind: 'note',
			}),
		],
		{ bucket: 'week', dateField: 'filename', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.note,
	);
	const noteRow = notes.rows.find(
		(entry) => entry.id === '2026-11-09',
	);
	assert.equal(noteRow.related.length, 1);
	assert.equal(noteRow.related[0].kind, 'note');
	assert.equal(noteRow.related[0].label, '2026-11-10-journal');
	assert.equal(noteRow.related[0].date, '2026-11-10');

	const files = buildTimelineRows(
		[
			record({
				basename: '2026-11-10-image',
				path: '0-辅助/img.png',
				kind: 'file',
			}),
		],
		{ bucket: 'day', dateField: 'filename', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.file,
	);
	const fileRow = files.rows.find((entry) => entry.id === '2026-11-10');
	assert.equal(fileRow.related[0].kind, 'file');
	assert.equal(fileRow.related[0].label, '2026-11-10-image');
});

test('empty windows expose no bucket refs', () => {
	const result = buildTimelineRows(
		[],
		{ bucket: 'day', dateField: 'filename', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.task,
	);
	assert.deepEqual(result.rows, []);
});
