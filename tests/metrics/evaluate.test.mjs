import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	evaluateMetric,
	evaluateMetrics,
	bucketOf,
	buildPendingSnapshot,
	PENDING_LIST_LIMIT,
} = await load('../../src/metrics/evaluate.ts');
const { createDefaultFilterState } = await load(
	'../../src/data/saved-query-adapter.ts',
);
const { DEFAULT_SCOPE_SECTIONS } = await load('../../src/data/types.ts');

const NOW = Date.parse('2026-11-08T12:00:00Z');

function note(overrides = {}) {
	return {
		path: '3-任务/Alpha/n.md',
		basename: 'n',
		folder: '3-任务/Alpha',
		ioType: 'Task',
		project: 'Alpha',
		ctime: NOW,
		mtime: NOW,
		size: 10,
		fileTaskCount: 0,
		fileCompletedCount: 0,
		sectionTaskCount: 0,
		sectionCompletedCount: 0,
		frontmatter: {},
		...overrides,
	};
}

function task(overrides = {}) {
	return {
		path: '3-任务/Alpha/n.md',
		line: 1,
		marker: 'open',
		isCompleted: false,
		text: 't',
		indent: 0,
		ioType: 'Task',
		sectionRole: 'task',
		sectionHeading: '任务',
		project: 'Alpha',
		noteCtime: NOW,
		noteMtime: NOW,
		noteBasename: 'n',
		noteSize: 10,
		...overrides,
	};
}

function query(overrides = {}) {
	return {
		id: 'user:q',
		name: 'q',
		target: 'task',
		scope: { folders: [], includeSubfolders: true },
		filters: createDefaultFilterState(),
		...overrides,
	};
}

function context(snapshot, queries = [query()]) {
	return {
		snapshot,
		taskFolder: '3-任务',
		getQuery: (id) => queries.find((item) => item.id === id),
		now: () => NOW,
	};
}

function snapshot(tasks, notes = [note()]) {
	return { notes, tasks, projects: [] };
}

test('empty project keeps ratio null, never 0', () => {
	const ctx = context(
		snapshot([], [note({ path: '3-任务/Empty/x.md', folder: '3-任务/Empty', project: 'Empty' })]),
	);
	const result = evaluateMetric(
		{ kind: 'project-progress', queryId: 'user:q', basis: 'section' },
		ctx,
	);
	const empty = result.groups.find((group) => group.key === 'Empty');
	assert.ok(empty);
	assert.equal(empty.bucket.total, 0);
	assert.equal(empty.bucket.ratio, null);
});

test('cancelled and in-progress are neither completed nor open', () => {
	const bucket = bucketOf([
		task(),
		task({ marker: 'done', isCompleted: true }),
		task({ marker: 'cancelled' }),
		task({ marker: 'in-progress' }),
		task({ marker: 'forwarded' }),
	]);
	assert.deepEqual(
		{ total: bucket.total, completed: bucket.completed, open: bucket.open, cancelled: bucket.cancelled, other: bucket.other },
		{ total: 5, completed: 1, open: 1, cancelled: 1, other: 2 },
	);
	assert.equal(bucket.ratio, 1 / 5);
});

test('task-completion counts only marker semantics', () => {
	const ctx = context(snapshot([task(), task({ marker: 'done', isCompleted: true })]));
	const result = evaluateMetric(
		{ kind: 'task-completion', queryId: 'user:q' },
		ctx,
	);
	assert.equal(result.bucket.total, 2);
	assert.equal(result.bucket.completed, 1);
	assert.equal(result.bucket.ratio, 0.5);
});

test('basis=file widens sections while section keeps the query scope', () => {
	const tasks = [
		task(),
		task({ marker: 'done', isCompleted: true, sectionRole: 'goal', text: 'goal done' }),
	];
	const sectionQuery = query({ scope: { folders: [], includeSubfolders: true, sections: DEFAULT_SCOPE_SECTIONS } });
	const ctx = context(snapshot(tasks), [sectionQuery]);
	const section = evaluateMetric(
		{ kind: 'task-count', queryId: 'user:q', basis: 'section' },
		ctx,
	);
	const file = evaluateMetric(
		{ kind: 'task-count', queryId: 'user:q', basis: 'file' },
		ctx,
	);
	assert.equal(section.scalar, 1);
	assert.equal(file.scalar, 2);
});

test('unfinished list is open-only, newest first, limited, placeholder-free', () => {
	const tasks = [
		task({ line: 1, text: 'old', noteMtime: NOW - 1000 }),
		task({ line: 2, text: 'new', noteMtime: NOW }),
		task({ line: 3, text: '', marker: 'open' }),
		task({ line: 4, text: 'done', marker: 'done', isCompleted: true }),
		task({ line: 5, text: 'doing', marker: 'in-progress' }),
	];
	const ctx = context(snapshot(tasks));
	const result = evaluateMetric(
		{ kind: 'unfinished-tasks', queryId: 'user:q', limit: 1 },
		ctx,
	);
	assert.deepEqual(result.items.map((item) => item.text), ['new']);
});

test('project group totals equal the scalar task count in the same scope', () => {
	const tasks = [
		task({ line: 1 }),
		task({ line: 2, project: 'Beta', path: '3-任务/Beta/b.md', noteBasename: 'b' }),
		task({ line: 3, project: undefined, path: '3-任务/loose.md' }),
	];
	const ctx = context(
		snapshot(tasks, [
			note(),
			note({ path: '3-任务/Beta/b.md', folder: '3-任务/Beta', basename: 'b', project: 'Beta' }),
		]),
	);
	const groups = evaluateMetric(
		{ kind: 'project-progress', queryId: 'user:q' },
		ctx,
	).groups;
	const scalar = evaluateMetric(
		{ kind: 'task-count', queryId: 'user:q' },
		ctx,
	).scalar;
	assert.equal(
		groups.reduce((sum, group) => sum + group.bucket.total, 0),
		scalar,
	);
});

test('date presets use the injected clock', () => {
	const recent = task({ noteCtime: NOW, noteMtime: NOW });
	const old = task({ line: 2, noteCtime: NOW - 10 * 86400000, noteMtime: NOW - 10 * 86400000 });
	const filtered = query({
		filters: createDefaultFilterState({ dateType: 'created', datePreset: 'last7days' }),
	});
	const ctx = context(snapshot([recent, old]), [filtered]);
	assert.equal(
		evaluateMetric({ kind: 'task-count', queryId: 'user:q' }, ctx).scalar,
		1,
	);
});

test('metric results are deduplicated by key', () => {
	const ctx = context(snapshot([task()]));
	const request = { kind: 'task-count', queryId: 'user:q' };
	const results = evaluateMetrics([request, request], ctx);
	assert.equal(results.size, 1);
});

test('missing query yields no scalar (config error handled by the view)', () => {
	const ctx = context(snapshot([task()]), []);
	const result = evaluateMetric({ kind: 'task-count', queryId: 'user:none' }, ctx);
	assert.equal(result.scalar, undefined);
});

// ---- project drill-down pending snapshot ----

test('buildPendingSnapshot classifies markers and drops done/cancelled', () => {
	const snap = buildPendingSnapshot([
		task({ marker: 'open' }),
		task({ marker: 'in-progress' }),
		task({ marker: 'forwarded' }),
		task({ marker: 'other' }),
		task({ marker: 'done', isCompleted: true }),
		task({ marker: 'cancelled' }),
	]);
	assert.deepEqual(snap.counts, { open: 1, inProgress: 1, forwarded: 1, other: 1 });
	assert.equal(snap.total, 4);
	assert.deepEqual(
		snap.items.map((item) => item.marker).sort(),
		['forwarded', 'in-progress', 'open', 'other'],
	);
	assert.equal(PENDING_LIST_LIMIT, 200);
});

test('pending counts stay invariant with the row bucket', () => {
	const tasks = [
		task({ line: 1 }),
		task({ line: 2 }),
		task({ line: 3, marker: 'done', isCompleted: true }),
		task({ line: 4, marker: 'cancelled' }),
		task({ line: 5, marker: 'in-progress' }),
		task({ line: 6, marker: 'forwarded' }),
		task({ line: 7, marker: 'other' }),
	];
	const ctx = context(snapshot(tasks));
	const group = evaluateMetric(
		{ kind: 'project-progress', queryId: 'user:q' },
		ctx,
	).groups.find((item) => item.key === 'Alpha');
	assert.ok(group);
	assert.equal(group.pendingTotal, group.bucket.open + group.bucket.other);
	assert.equal(
		group.pendingCounts.open +
			group.pendingCounts.inProgress +
			group.pendingCounts.forwarded +
			group.pendingCounts.other,
		group.pendingTotal,
	);
});

test('buildPendingSnapshot keeps empty task text so numbers match the list', () => {
	const snap = buildPendingSnapshot([
		task({ text: '', marker: 'open' }),
		task({ line: 2, text: 'named', marker: 'open' }),
	]);
	assert.equal(snap.total, 2);
	assert.equal(snap.items.length, 2);
	assert.ok(snap.items.some((item) => item.text === ''));
});

test('buildPendingSnapshot truncates items but not counts', () => {
	const snap = buildPendingSnapshot(
		[task({ line: 1 }), task({ line: 2 }), task({ line: 3 })],
		2,
	);
	assert.equal(snap.items.length, 2);
	assert.equal(snap.total, 3);
	assert.equal(snap.counts.open, 3);
});

test('buildPendingSnapshot sorts by note recency, path then line', () => {
	const snap = buildPendingSnapshot([
		task({ path: '3-任务/Alpha/b.md', line: 2, noteMtime: NOW }),
		task({ path: '3-任务/Alpha/a.md', line: 9, noteMtime: NOW }),
		task({ path: '3-任务/Alpha/b.md', line: 1, noteMtime: NOW }),
		task({ path: '3-任务/Alpha/old.md', line: 4, noteMtime: NOW - 1000 }),
	]);
	assert.deepEqual(
		snap.items.map((item) => `${item.path}#${item.line}`),
		[
			'3-任务/Alpha/a.md#9',
			'3-任务/Alpha/b.md#1',
			'3-任务/Alpha/b.md#2',
			'3-任务/Alpha/old.md#4',
		],
	);
});

test('project pending lists stay isolated per project', () => {
	const tasks = [
		task({ line: 1, project: 'Alpha' }),
		task({
			line: 2,
			project: 'Beta',
			path: '3-任务/Beta/b.md',
			noteBasename: 'b',
		}),
		task({ line: 3, project: undefined, path: '3-任务/loose.md' }),
	];
	const ctx = context(
		snapshot(tasks, [
			note(),
			note({
				path: '3-任务/Beta/b.md',
				folder: '3-任务/Beta',
				basename: 'b',
				project: 'Beta',
			}),
		]),
	);
	const groups = evaluateMetric(
		{ kind: 'project-progress', queryId: 'user:q' },
		ctx,
	).groups;
	const alpha = groups.find((item) => item.key === 'Alpha');
	const beta = groups.find((item) => item.key === 'Beta');
	const loose = groups.find((item) => item.key === '');
	assert.ok(alpha && beta && loose);
	assert.deepEqual(alpha.pending.map((item) => item.path), ['3-任务/Alpha/n.md']);
	assert.deepEqual(beta.pending.map((item) => item.path), ['3-任务/Beta/b.md']);
	assert.deepEqual(loose.pending.map((item) => item.path), ['3-任务/loose.md']);
});

test('project groups carry status and due date from _project.md records', () => {
	const tasks = [task()];
	const notes = [note()];
	const ctx = context({
		notes,
		tasks,
		projects: [
			{
				path: '3-任务/Alpha/_project.md',
				folder: '3-任务/Alpha',
				name: 'Alpha',
				status: '进行中',
				dueDate: '2026-12-01',
			},
		],
	});
	const group = evaluateMetric(
		{ kind: 'project-progress', queryId: 'user:q' },
		ctx,
	).groups.find((item) => item.key === 'Alpha');
	assert.ok(group);
	assert.equal(group.status, '进行中');
	assert.equal(group.dueDate, '2026-12-01');
});

test('empty project exposes an empty pending snapshot', () => {
	const ctx = context(
		snapshot(
			[],
			[
				note({
					path: '3-任务/Empty/x.md',
					folder: '3-任务/Empty',
					project: 'Empty',
				}),
			],
		),
	);
	const group = evaluateMetric(
		{ kind: 'project-progress', queryId: 'user:q' },
		ctx,
	).groups.find((item) => item.key === 'Empty');
	assert.ok(group);
	assert.deepEqual(group.pending, []);
	assert.equal(group.pendingTotal, 0);
	assert.deepEqual(group.pendingCounts, {
		open: 0,
		inProgress: 0,
		forwarded: 0,
		other: 0,
	});
	assert.equal(group.bucket.ratio, null);
});
