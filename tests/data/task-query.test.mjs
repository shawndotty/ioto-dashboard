import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './helpers.mjs';

const { queryTasks } = await load('../../src/data/task-query.ts');
const { DEFAULT_TASK_SCOPE } = await load('../../src/data/types.ts');
const { createDefaultFilterState } = await load(
	'../../src/data/saved-query-adapter.ts',
);

function task(overrides = {}) {
	return {
		path: '3-任务/note.md',
		line: 1,
		marker: 'open',
		isCompleted: false,
		text: 'task text',
		indent: 0,
		ioType: 'Task',
		sectionRole: 'task',
		sectionHeading: '任务',
		project: 'IOTO',
		noteCtime: Date.parse('2026-01-01T00:00:00Z'),
		noteMtime: Date.parse('2026-01-01T00:00:00Z'),
		noteBasename: 'note',
		noteSize: 10,
		...overrides,
	};
}

const ALL = { ...DEFAULT_TASK_SCOPE, folders: 'all' };

test('default scope is task folder + task/input/output/outcome sections', () => {
	assert.deepEqual(DEFAULT_TASK_SCOPE.sections, [
		'task',
		'input',
		'output',
		'outcome',
	]);
	assert.equal(DEFAULT_TASK_SCOPE.folders, 'task');
});

test('folder scope separates task / ioo / all', () => {
	const tasks = [
		task(),
		task({ path: '1-输入/n.md', ioType: 'Input', sectionRole: 'input' }),
		task({ path: '4-成果/n.md', ioType: 'Outcome', sectionRole: 'outcome' }),
	];
	const defaults = createDefaultFilterState();
	assert.equal(queryTasks(tasks, defaults, DEFAULT_TASK_SCOPE).length, 1);
	assert.equal(
		queryTasks(tasks, defaults, { ...DEFAULT_TASK_SCOPE, folders: 'ioo' }).length,
		2,
	);
	assert.equal(queryTasks(tasks, defaults, ALL).length, 3);
});

test('section scope excludes goal/review/other', () => {
	const tasks = [
		task(),
		task({ sectionRole: 'goal', text: 'goal' }),
		task({ sectionRole: 'review', text: 'review' }),
		task({ sectionRole: 'other', text: 'other' }),
	];
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState(), ALL).map((item) => item.text),
		['task text'],
	);
	assert.equal(
		queryTasks(tasks, createDefaultFilterState(), {
			...ALL,
			sections: ['task', 'goal', 'review', 'other'],
		}).length,
		4,
	);
});

test('status: completed means done only, incomplete means open only', () => {
	const tasks = [
		task({ text: 'open' }),
		task({ text: 'done', marker: 'done', isCompleted: true }),
		task({ text: 'cancelled', marker: 'cancelled' }),
		task({ text: 'doing', marker: 'in-progress' }),
		task({ text: 'forwarded', marker: 'forwarded' }),
	];
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState({ status: 'completed' }), ALL).map(
			(item) => item.text,
		),
		['done'],
	);
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState({ status: 'incomplete' }), ALL).map(
			(item) => item.text,
		),
		['open'],
	);
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState({ status: 'all' }), ALL).map(
			(item) => item.text,
		),
		['open', 'done', 'cancelled', 'doing', 'forwarded'],
	);
});

test('taskType maps section roles and keeps untagged tasks', () => {
	const tasks = [
		task({ text: 'input', path: '1-输入/n.md', ioType: 'Input', sectionRole: 'input' }),
		task({ text: 'output', path: '2-输出/n.md', ioType: 'Output', sectionRole: 'output' }),
		task({ text: 'untagged' }),
	];
	assert.deepEqual(
		queryTasks(
			tasks,
			createDefaultFilterState({ taskType: ['Input'] }),
			ALL,
		).map((item) => item.text),
		['input', 'untagged'],
	);
});

test('name, project and custom filters apply to task text/frontmatter', () => {
	const tasks = [
		task({ text: 'Write report' }),
		task({ text: 'Read book', path: '3-任务/b.md' }),
	];
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState({ name: 'report' }), ALL).map(
			(item) => item.text,
		),
		['Write report'],
	);
	const defs = [{ name: 'Score', type: 'number', target: 'task' }];
	const withMeta = [
		task({ text: 'a', noteFrontmatter: { Score: 2 } }),
		task({ text: 'b', noteFrontmatter: { Score: 3 } }),
	];
	assert.deepEqual(
		queryTasks(
			withMeta,
			createDefaultFilterState({ custom: { Score: '3' } }),
			ALL,
			defs,
		).map((item) => item.text),
		['b'],
	);
});

test('paths scope intersects the folders enum', () => {
	const tasks = [
		task({ text: 'root task' }),
		task({ text: 'alpha', path: '3-任务/Alpha/n.md' }),
		task({ text: 'beta', path: '3-任务/Beta/n.md' }),
		task({
			text: 'input note',
			path: '1-输入/n.md',
			ioType: 'Input',
			sectionRole: 'input',
		}),
	];
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState(), {
			...ALL,
			paths: ['3-任务/Alpha'],
		}).map((item) => item.text),
		['alpha'],
	);
	// `folders` still applies: an input note inside the path is excluded by
	// the default task-folder scope.
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState(), {
			...DEFAULT_TASK_SCOPE,
			paths: ['1-输入'],
		}).map((item) => item.text),
		[],
	);
});

test('includeSubfolders=false only matches the exact folder', () => {
	const tasks = [
		task({ text: 'direct', path: '3-任务/Alpha/n.md' }),
		task({ text: 'nested', path: '3-任务/Alpha/sub/n.md' }),
	];
	const scope = { ...ALL, paths: ['3-任务/Alpha'] };
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState(), scope).map(
			(item) => item.text,
		),
		['direct', 'nested'],
	);
	assert.deepEqual(
		queryTasks(tasks, createDefaultFilterState(), {
			...scope,
			includeSubfolders: false,
		}).map((item) => item.text),
		['direct'],
	);
});

