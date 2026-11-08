import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { resolveQuery } = await load('../../src/query/resolve.ts');
const { builtinQueries } = await load('../../src/query/builtins.ts');
const { createDefaultFilterState } = await load(
	'../../src/data/saved-query-adapter.ts',
);
const { DEFAULT_TASK_SCOPE } = await load('../../src/data/types.ts');
const { queryTasks } = await load('../../src/data/task-query.ts');
const { queryNotes } = await load('../../src/data/note-query.ts');

function note(overrides = {}) {
	return {
		path: '3-任务/Alpha/n.md',
		basename: 'n',
		folder: '3-任务/Alpha',
		ioType: 'Task',
		ctime: Date.parse('2026-01-01T00:00:00Z'),
		mtime: Date.parse('2026-01-01T00:00:00Z'),
		size: 10,
		fileTaskCount: 1,
		fileCompletedCount: 0,
		sectionTaskCount: 1,
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
		noteCtime: Date.parse('2026-01-01T00:00:00Z'),
		noteMtime: Date.parse('2026-01-01T00:00:00Z'),
		noteBasename: 'n',
		noteSize: 10,
		...overrides,
	};
}

const snapshot = {
	notes: [
		note(),
		note({ path: '3-任务/Alpha/sub/n2.md', basename: 'n2', folder: '3-任务/Alpha/sub' }),
		note({ path: '3-任务/Beta/n3.md', basename: 'n3', folder: '3-任务/Beta' }),
		note({ path: '1-输入/in.md', basename: 'in', folder: '1-输入', ioType: 'Input' }),
	],
	tasks: [
		task(),
		task({ path: '3-任务/Alpha/sub/n2.md', line: 2, text: 'sub' }),
		task({ path: '3-任务/Beta/n3.md', line: 3, text: 'beta' }),
		task({ path: '1-输入/in.md', line: 1, text: 'input', ioType: 'Input', sectionRole: 'input' }),
	],
	projects: [],
};

function definition(overrides = {}) {
	return {
		id: 'user:t',
		name: 't',
		target: 'task',
		scope: { folders: [], includeSubfolders: true },
		filters: createDefaultFilterState(),
		...overrides,
	};
}

test('empty folders fall back to the task folder', () => {
	const result = resolveQuery(snapshot, definition());
	assert.deepEqual(
		result.tasks.map((item) => item.text),
		['t', 'sub', 'beta'],
	);
});

test('paths restrict results and includeSubfolders=false is exact', () => {
	const nested = resolveQuery(
		snapshot,
		definition({ scope: { folders: ['3-任务/Alpha'], includeSubfolders: true } }),
	);
	assert.equal(nested.tasks.length, 2);

	const exact = resolveQuery(
		snapshot,
		definition({
			scope: { folders: ['3-任务/Alpha'], includeSubfolders: false },
		}),
	);
	assert.deepEqual(exact.tasks.map((item) => item.text), ['t']);
});

test('sections override lets file basis widen the section range', () => {
	const goals = {
		...snapshot,
		tasks: [...snapshot.tasks, task({ line: 9, text: 'goal', sectionRole: 'goal' })],
	};
	const narrow = resolveQuery(goals, definition());
	assert.ok(!narrow.tasks.some((item) => item.text === 'goal'));
	const wide = resolveQuery(goals, definition(), {
		sections: ['task', 'input', 'output', 'outcome', 'goal', 'review', 'other'],
	});
	assert.ok(wide.tasks.some((item) => item.text === 'goal'));
});

test('note target uses paths and ioTypes', () => {
	const notes = resolveQuery(
		snapshot,
		definition({
			target: 'note',
			scope: { folders: ['1-输入'], includeSubfolders: true, ioTypes: ['Input'] },
		}),
	);
	assert.deepEqual(notes.notes.map((item) => item.basename), ['in']);
	assert.equal(notes.tasks.length, 0);
});

test('saved-query adaptation matches direct data-layer calls', () => {
	const query = definition({
		target: 'task',
		scope: { folders: ['3-任务/Alpha'], includeSubfolders: true },
		filters: createDefaultFilterState({ status: 'incomplete' }),
	});
	const resolved = resolveQuery(snapshot, query);
	const direct = queryTasks(
		snapshot.tasks,
		query.filters,
		{
			...DEFAULT_TASK_SCOPE,
			folders: 'all',
			paths: ['3-任务/Alpha'],
			includeSubfolders: true,
		},
	);
	assert.deepEqual(resolved.tasks, direct);

	const noteQuery = definition({
		target: 'note',
		scope: { folders: ['1-输入'], includeSubfolders: true },
	});
	assert.deepEqual(
		resolveQuery(snapshot, noteQuery).notes,
		queryNotes(snapshot.notes, noteQuery.filters, [], {
			paths: ['1-输入'],
			includeSubfolders: true,
		}),
	);
});

test('builtins cover both targets with stable ids', () => {
	const queries = builtinQueries();
	assert.ok(queries.some((item) => item.id === 'builtin:tasks-all'));
	assert.ok(queries.some((item) => item.id === 'builtin:notes-all'));
	assert.ok(queries.some((item) => item.id === 'builtin:tasks-unfinished'));
	for (const item of queries) assert.ok(['note', 'task'].includes(item.target));
});
