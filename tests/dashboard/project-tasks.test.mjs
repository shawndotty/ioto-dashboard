import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { markerChar, markerBadgeKey, visibleChips, groupPendingByNote } =
	await load('../../src/dashboard/components/project-tasks.ts');

function item(overrides = {}) {
	return {
		path: '3-任务/Alpha/a.md',
		line: 1,
		text: 't',
		marker: 'open',
		noteBasename: 'a',
		noteMtime: 100,
		...overrides,
	};
}

test('markerChar maps every marker to its data-task character', () => {
	assert.equal(markerChar('open'), ' ');
	assert.equal(markerChar('in-progress'), '/');
	assert.equal(markerChar('forwarded'), '>');
	assert.equal(markerChar('other'), '?');
	assert.equal(markerChar('done'), '?');
	assert.equal(markerChar('cancelled'), '?');
});

test('markerBadgeKey only labels non-open markers', () => {
	assert.equal(markerBadgeKey('open'), null);
	assert.equal(markerBadgeKey('in-progress'), 'PROJECT_TASKS_BADGE_IN_PROGRESS');
	assert.equal(markerBadgeKey('forwarded'), 'PROJECT_TASKS_BADGE_FORWARDED');
	assert.equal(markerBadgeKey('other'), 'PROJECT_TASKS_BADGE_OTHER');
});

test('visibleChips hides zero counts and keeps a stable order', () => {
	assert.deepEqual(
		visibleChips({ open: 0, inProgress: 0, forwarded: 0, other: 0 }),
		[],
	);
	assert.deepEqual(
		visibleChips({ open: 2, inProgress: 0, forwarded: 1, other: 0 }),
		[
			{ key: 'PROJECT_TASKS_OPEN', count: 2 },
			{ key: 'PROJECT_TASKS_FORWARDED', count: 1 },
		],
	);
	assert.deepEqual(
		visibleChips({ open: 1, inProgress: 2, forwarded: 3, other: 4 }).map(
			(chip) => chip.key,
		),
		[
			'PROJECT_TASKS_OPEN',
			'PROJECT_TASKS_IN_PROGRESS',
			'PROJECT_TASKS_FORWARDED',
			'PROJECT_TASKS_OTHER',
		],
	);
});

test('visibleChips never reports cancelled tasks', () => {
	const keys = visibleChips({
		open: 1,
		inProgress: 0,
		forwarded: 0,
		other: 0,
		cancelled: 5,
	}).map((chip) => chip.key);
	assert.deepEqual(keys, ['PROJECT_TASKS_OPEN']);
});

test('groupPendingByNote aggregates per path and keeps order', () => {
	const grouped = groupPendingByNote([
		item({ path: 'a.md', line: 3, noteBasename: 'a' }),
		item({ path: 'b.md', line: 1, noteBasename: 'b' }),
		item({ path: 'a.md', line: 7, noteBasename: 'a' }),
	]);
	assert.deepEqual(
		grouped.map((group) => group.path),
		['a.md', 'b.md'],
	);
	assert.deepEqual(
		grouped[0].items.map((task) => task.line),
		[3, 7],
	);
	assert.equal(grouped[0].basename, 'a');
	assert.equal(grouped[1].items.length, 1);
});

test('groupPendingByNote returns an empty list for no items', () => {
	assert.deepEqual(groupPendingByNote([]), []);
});
