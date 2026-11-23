import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { matchesTimelineRef } = await load(
	'../../src/dashboard/components/timeline.ts',
);

const ref = (overrides = {}) => ({
	path: 'a/b/Journal.md',
	label: 'Journal',
	ioType: 'Input',
	...overrides,
});

test('an empty or blank query matches every ref', () => {
	assert.equal(matchesTimelineRef(ref(), ''), true);
	assert.equal(matchesTimelineRef(ref(), '   '), true);
});

test('the label matches case-insensitively', () => {
	assert.equal(matchesTimelineRef(ref(), 'journal'), true);
	assert.equal(matchesTimelineRef(ref(), 'JOURNAL'), true);
	assert.equal(matchesTimelineRef(ref(), 'missing'), false);
});

test('only the basename of the path is searched', () => {
	const value = ref({ label: 'Something else' });
	assert.equal(matchesTimelineRef(value, 'journal'), true);
	assert.equal(matchesTimelineRef(value, 'a/b'), false);
});

test('ioType is searched', () => {
	assert.equal(matchesTimelineRef(ref(), 'input'), true);
	const output = ref({ label: 'Plain title', path: 'notes/Plain.md', ioType: 'Output' });
	assert.equal(matchesTimelineRef(output, 'output'), true);
	assert.equal(matchesTimelineRef(output, 'input'), false);
});

test('missing fields are treated as empty text without throwing', () => {
	assert.equal(matchesTimelineRef({ label: 'Only label' }, 'only'), true);
	assert.equal(matchesTimelineRef({ label: 'Only label' }, 'input'), false);
	assert.equal(matchesTimelineRef({ path: 'a/b.md' }, 'b'), true);
	assert.equal(matchesTimelineRef({}, 'search'), false);
});
