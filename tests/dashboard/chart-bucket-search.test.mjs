import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	bucketTaskChar,
	isCancelledTask,
	isDoneTask,
	isOpenTask,
	matchBucketRef,
	normalizeQuery,
	splitHighlight,
} = await load('../../src/ui/chart-bucket-search.ts');

const ref = (overrides = {}) => ({
	path: '1-输入/2026 Weekly/Note 2026-04-02.md',
	label: 'Write the report',
	kind: 'task',
	marker: 'open',
	...overrides,
});

test('bucketTaskChar maps every task state to its Obsidian checkbox char', () => {
	assert.equal(bucketTaskChar(undefined), ' ');
	assert.equal(bucketTaskChar('open'), ' ');
	assert.equal(bucketTaskChar('done'), 'x');
	assert.equal(bucketTaskChar('cancelled'), '-');
	assert.equal(bucketTaskChar('in-progress'), '/');
	assert.equal(bucketTaskChar('forwarded'), '>');
	assert.equal(bucketTaskChar('other'), '?');
});

test('done must not reuse the project modal markerChar mapping', () => {
	// project-tasks markerChar maps done/cancelled to "?" on purpose; the bucket
	// modal shows real completion state, so it needs its own mapping.
	assert.equal(bucketTaskChar('done'), 'x');
	assert.equal(bucketTaskChar('cancelled'), '-');
});

test('isOpenTask excludes done and cancelled only', () => {
	for (const marker of ['open', 'in-progress', 'forwarded', 'other', undefined]) {
		assert.equal(isOpenTask(marker), true, `expected ${marker} to be open`);
	}
	assert.equal(isOpenTask('done'), false);
	assert.equal(isOpenTask('cancelled'), false);
});

test('isDoneTask and isCancelledTask only match their own state', () => {
	assert.equal(isDoneTask('done'), true);
	assert.equal(isDoneTask('cancelled'), false);
	assert.equal(isDoneTask('open'), false);
	assert.equal(isDoneTask(undefined), false);
	assert.equal(isCancelledTask('cancelled'), true);
	assert.equal(isCancelledTask('done'), false);
	assert.equal(isCancelledTask(undefined), false);
});

test('normalizeQuery trims and lowercases', () => {
	assert.equal(normalizeQuery('  Report  '), 'report');
	assert.equal(normalizeQuery(''), '');
	assert.equal(normalizeQuery('   '), '');
});

test('an empty query matches every ref', () => {
	assert.equal(matchBucketRef(ref(), ''), true);
	assert.equal(matchBucketRef(ref({ path: '' }), '   '), true);
	assert.equal(matchBucketRef(ref({ label: '' }), ''), true);
});

test('the label matches case-insensitively', () => {
	assert.equal(matchBucketRef(ref(), 'report'), true);
	assert.equal(matchBucketRef(ref(), 'WRITE THE REPORT'), true);
	assert.equal(matchBucketRef(ref(), 'missing'), false);
});

test('the file name with extension matches', () => {
	assert.equal(matchBucketRef(ref(), 'note 2026-04-02.md'), true);
	assert.equal(matchBucketRef(ref(), '.md'), true);
});

test('a folder segment in the full path matches', () => {
	assert.equal(matchBucketRef(ref(), '1-输入'), true);
	assert.equal(matchBucketRef(ref(), '2026 weekly'), true);
});

test('chinese substrings match without tokenization', () => {
	assert.equal(matchBucketRef(ref({ label: '优化自定义组件的搜索体验' }), '搜索'), true);
	assert.equal(matchBucketRef(ref({ label: '优化自定义组件的搜索体验' }), '分页'), false);
});

test('an empty path only matches through the label', () => {
	assert.equal(matchBucketRef(ref({ path: '' }), 'report'), true);
	assert.equal(matchBucketRef(ref({ path: '' }), '1-输入'), false);
});

test('splitHighlight keeps original casing and marks hits', () => {
	assert.deepEqual(splitHighlight('Write the Report', 'report'), [
		{ text: 'Write the ', hit: false },
		{ text: 'Report', hit: true },
	]);
	assert.deepEqual(splitHighlight('Write the Report', ''), [
		{ text: 'Write the Report', hit: false },
	]);
	assert.deepEqual(splitHighlight('', 'x'), []);
});

test('splitHighlight marks every occurrence', () => {
	assert.deepEqual(splitHighlight('aXbXc', 'x'), [
		{ text: 'a', hit: false },
		{ text: 'X', hit: true },
		{ text: 'b', hit: false },
		{ text: 'X', hit: true },
		{ text: 'c', hit: false },
	]);
});
