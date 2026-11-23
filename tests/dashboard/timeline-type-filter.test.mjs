import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	ALL_TYPES,
	allState,
	matchesTimelineTypes,
	stateOf,
	timelineTypeFilterActive,
	timelineTypeFilterEnabled,
} = await load('../../src/dashboard/ui/timeline-type-filter.ts');

const full = () => new Set(ALL_TYPES);
const ref = (overrides = {}) => ({
	path: '1-输入/Note.md',
	label: 'Note',
	ioType: 'Input',
	...overrides,
});

// ---- matchesTimelineTypes ----

test('an empty enabled set matches nothing, including Unknown', () => {
	const none = new Set();
	for (const type of ALL_TYPES) {
		assert.equal(matchesTimelineTypes(ref({ ioType: type }), none), false);
	}
	assert.equal(matchesTimelineTypes(ref({ ioType: 'Unknown' }), none), false);
	assert.equal(matchesTimelineTypes(ref({ ioType: undefined }), none), false);
});

test('a full enabled set matches every known type and Unknown', () => {
	const all = full();
	for (const type of ALL_TYPES) {
		assert.equal(matchesTimelineTypes(ref({ ioType: type }), all), true);
	}
	assert.equal(matchesTimelineTypes(ref({ ioType: 'Unknown' }), all), true);
	assert.equal(matchesTimelineTypes(ref({ ioType: undefined }), all), true);
});

test('a single-type set matches only that type and hides Unknown', () => {
	const onlyInput = new Set(['Input']);
	assert.equal(matchesTimelineTypes(ref({ ioType: 'Input' }), onlyInput), true);
	for (const type of ['Output', 'Outcome', 'Task', 'Unknown']) {
		assert.equal(matchesTimelineTypes(ref({ ioType: type }), onlyInput), false);
	}
});

test('Unknown is visible only while all four types are enabled', () => {
	const unknown = ref({ ioType: 'Unknown' });
	const all = full();
	assert.equal(matchesTimelineTypes(unknown, all), true);
	for (const disabled of ALL_TYPES) {
		const partial = full();
		partial.delete(disabled);
		assert.equal(
			matchesTimelineTypes(unknown, partial),
			false,
			`Unknown must hide when ${disabled} is disabled`,
		);
	}
});

test('a missing ioType is treated as Unknown', () => {
	assert.equal(matchesTimelineTypes({ label: 'No type' }, full()), true);
	assert.equal(matchesTimelineTypes({ label: 'No type' }, new Set(['Input'])), false);
});

// ---- allState ----

test('allState reports on / off / partial', () => {
	assert.equal(allState(full()), 'on');
	assert.equal(allState(new Set()), 'off');
});

test('allState is partial when one type is off or only one is left', () => {
	const oneOff = full();
	oneOff.delete('Task');
	assert.equal(allState(oneOff), 'partial');
	assert.equal(allState(new Set(['Outcome'])), 'partial');
});

// ---- state reset ----

test('stateOf resets to all-on / closed when the query changes', () => {
	const config = { queryId: 'builtin:notes-all' };
	const first = stateOf(config);
	first.enabled.delete('Input');
	first.open = true;
	assert.equal(timelineTypeFilterActive(config), true);
	assert.deepEqual([...timelineTypeFilterEnabled(config)], ['Output', 'Outcome', 'Task']);

	const next = stateOf({ queryId: 'builtin:notes-task' });
	assert.equal(next.open, false);
	assert.equal(next.enabled.size, 4);
	assert.deepEqual([...next.enabled], [...ALL_TYPES]);
	assert.equal(timelineTypeFilterActive({ queryId: 'builtin:notes-task' }), false);
});

test('stateOf reuses the same state while the query id is unchanged', () => {
	const config = { queryId: 'stable-query' };
	const first = stateOf(config);
	first.enabled.delete('Output');
	assert.equal(stateOf(config), first);
	assert.equal(timelineTypeFilterEnabled(config).has('Output'), false);
});
