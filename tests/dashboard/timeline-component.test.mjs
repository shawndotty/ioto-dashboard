import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	timelineComponent,
	sortTimelineRefs,
	cardSortOf,
	maxPerDayOf,
	moreCountOf,
} = await load('../../src/dashboard/components/timeline.ts');
const { datasetKey } = await load('../../src/dashboard/dataset/types.ts');
const { buildTimelineRows, TIMELINE_COLUMNS } = await load(
	'../../src/dashboard/dataset/timeline.ts',
);

const NOW = new Date(2026, 10, 11, 15, 30, 0).getTime();

function ref(path, label, ctime, mtime) {
	return { path, label, ctime, mtime, kind: 'note' };
}

function requestOf(options = {}) {
	return timelineComponent.toDatasetRequest({
		queryId: 'builtin:notes-all',
		options: { range: '30', dateField: 'modified', ...options },
	});
}

test('sortTimelineRefs orders by ctime ascending for the default created sort', () => {
	const refs = [
		ref('c.md', 'c', 300, 30),
		ref('a.md', 'a', 100, 10),
		ref('b.md', 'b', 200, 20),
	];
	const sorted = sortTimelineRefs(refs, 'created');
	assert.deepEqual(
		sorted.map((item) => item.path),
		['a.md', 'b.md', 'c.md'],
	);
	assert.deepEqual(
		refs.map((item) => item.path),
		['c.md', 'a.md', 'b.md'],
	);
	assert.notEqual(sorted, refs);
});

test('modified and title sorts are ascending and do not mutate the input', () => {
	const refs = [
		ref('b.md', 'zeta', 100, 300),
		ref('a.md', 'alpha', 300, 100),
		ref('c.md', 'mid', 200, 200),
	];
	const byModified = sortTimelineRefs(refs, 'modified');
	assert.deepEqual(
		byModified.map((item) => item.path),
		['a.md', 'c.md', 'b.md'],
	);
	const byTitle = sortTimelineRefs(refs, 'title');
	assert.deepEqual(
		byTitle.map((item) => item.label),
		['alpha', 'mid', 'zeta'],
	);
	assert.deepEqual(
		refs.map((item) => item.path),
		['b.md', 'a.md', 'c.md'],
	);
});

test('equal timestamps fall back to ascending path order', () => {
	const refs = [
		ref('z.md', 'z', 100, 100),
		ref('a.md', 'a', 100, 100),
		ref('m.md', 'm', 100, 100),
	];
	assert.deepEqual(
		sortTimelineRefs(refs, 'created').map((item) => item.path),
		['a.md', 'm.md', 'z.md'],
	);
});

test('cardSortOf, maxPerDayOf and moreCountOf clamp unknown values', () => {
	assert.equal(cardSortOf('created'), 'created');
	assert.equal(cardSortOf('modified'), 'modified');
	assert.equal(cardSortOf('title'), 'title');
	assert.equal(cardSortOf('bogus'), 'created');
	assert.equal(maxPerDayOf(8), 8);
	assert.equal(maxPerDayOf('12'), 12);
	assert.equal(maxPerDayOf(0), 1);
	assert.equal(maxPerDayOf(500), 100);
	assert.equal(maxPerDayOf('nope'), 8);
	assert.equal(moreCountOf(20, 8), 12);
	assert.equal(moreCountOf(8, 8), 0);
	assert.equal(moreCountOf(3, 8), 0);
});

test('default request buckets by day over 30 days using modified time, without limit', () => {
	const created = timelineComponent.createConfig('builtin:notes-all');
	assert.deepEqual(created.options, {
		range: '30',
		dateField: 'modified',
		cardSort: 'created',
		maxPerDay: 8,
	});
	const request = requestOf();
	assert.equal(request.object, 'note');
	assert.equal(request.measure, 'timeline');
	assert.equal(request.queryId, 'builtin:notes-all');
	assert.equal(request.range, 30);
	assert.deepEqual(request.timeline, { bucket: 'day', dateField: 'modified' });
	assert.equal(request.limit, undefined);
});

test('all six range presets reach the request and produce distinct dataset keys', () => {
	const keys = new Set();
	for (const range of [7, 14, 30, 90, 180, 365]) {
		const request = requestOf({ range: String(range) });
		assert.equal(request.range, range, `range ${range}`);
		keys.add(datasetKey(request));
	}
	assert.equal(keys.size, 6);

	const setting = timelineComponent.settings.find((item) => item.key === 'range');
	assert.deepEqual(
		setting.options.map((option) => option.value),
		['7', '14', '30', '90', '180', '365'],
	);
	assert.equal(setting.fallback, '30');
});

test('unknown range and dateField values fall back to the declared defaults', () => {
	assert.equal(requestOf({ range: '42' }).range, 30);
	assert.equal(requestOf({ dateField: 'bogus' }).timeline.dateField, 'modified');
	const keys = new Set(
		['modified', 'created', 'filename', 'auto'].map(
			(dateField) => datasetKey(requestOf({ dateField })),
		),
	);
	assert.equal(keys.size, 4);
});

test('a modified-time timeline buckets records by mtime', () => {
	const stamp = (day) => new Date(2026, 10, day).getTime();
	const result = buildTimelineRows(
		[
			{
				basename: 'old-created',
				ctime: stamp(1),
				mtime: stamp(10),
				ioType: 'Input',
			},
			{
				basename: 'recent-created',
				ctime: stamp(9),
				mtime: stamp(5),
				ioType: 'Output',
			},
		],
		{ bucket: 'day', dateField: 'modified', range: 7, now: () => NOW },
		TIMELINE_COLUMNS.note,
	);
	const late = result.rows.find((row) => row.id === '2026-11-10');
	const early = result.rows.find((row) => row.id === '2026-11-05');
	assert.equal(late.related.length, 1);
	assert.equal(late.related[0].ioType, 'Input');
	assert.equal(early.related.length, 1);
	assert.equal(early.related[0].ioType, 'Output');
	assert.equal(result.sourceTotal, 2);
});
