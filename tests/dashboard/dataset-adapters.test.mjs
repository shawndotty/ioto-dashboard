import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { taskAdapter } = await load('../../src/dashboard/dataset/adapters/task.ts');
const { noteAdapter } = await load('../../src/dashboard/dataset/adapters/note.ts');
const { fileAdapter } = await load('../../src/dashboard/dataset/adapters/file.ts');
const { folderAdapter } = await load('../../src/dashboard/dataset/adapters/folder.ts');
const { projectAdapter } = await load('../../src/dashboard/dataset/adapters/project.ts');
const { createDefaultFilterState } = await load('../../src/data/saved-query-adapter.ts');

function query(target, overrides = {}) {
	return {
		id: `builtin:${target}`,
		name: `${target} query`,
		target,
		scope: { folders: [], includeSubfolders: true },
		filters: createDefaultFilterState(),
		...overrides,
	};
}

function note(overrides = {}) {
	return {
		path: '3-任务/P1/a.md',
		basename: 'a',
		folder: '3-任务/P1',
		ioType: 'Task',
		ctime: 1,
		mtime: 10,
		size: 100,
		fileTaskCount: 2,
		fileCompletedCount: 1,
		sectionTaskCount: 2,
		sectionCompletedCount: 1,
		...overrides,
	};
}

function task(overrides = {}) {
	return {
		path: '3-任务/P1/a.md',
		line: 3,
		marker: 'open',
		isCompleted: false,
		text: 'do it',
		indent: 0,
		ioType: 'Task',
		sectionRole: 'task',
		sectionHeading: '任务',
		project: 'P1',
		noteCtime: 1,
		noteMtime: 10,
		noteBasename: 'a',
		noteSize: 100,
		...overrides,
	};
}

const SNAPSHOT = {
	notes: [note(), note({ path: '1-输入/n.md', basename: 'n', folder: '1-输入', ioType: 'Input' })],
	tasks: [
		task(),
		task({ line: 4, marker: 'done', isCompleted: true, text: 'done it' }),
	],
	files: [
		{
			path: '3-任务/P1/a.md',
			basename: 'a',
			extension: 'md',
			folder: '3-任务/P1',
			size: 100,
			ctime: 1,
			mtime: 10,
		},
		{
			path: '0-辅助/i.png',
			basename: 'i',
			extension: 'png',
			folder: '0-辅助',
			size: 2048,
			ctime: 2,
			mtime: 20,
		},
	],
	folders: [
		{
			path: '3-任务/P1',
			name: 'P1',
			depth: 2,
			directFiles: 1,
			directFolders: 0,
			fileCount: 1,
			noteCount: 1,
			totalSize: 100,
			latestMtime: 10,
		},
	],
};

const EMPTY = { notes: [], tasks: [], files: [], folders: [] };

function adapterInput(adapterRequest, overrides = {}) {
	return {
		request: adapterRequest,
		query: query(adapterRequest.object === 'file' || adapterRequest.object === 'folder' ? adapterRequest.object : adapterRequest.object === 'project' ? 'task' : adapterRequest.object),
		snapshot: SNAPSHOT,
		dailySeries: () => [],
		...overrides,
	};
}

test('task adapter lists tasks and honours the measure', () => {
	const count = taskAdapter(
		adapterInput({ object: 'task', measure: 'count', queryId: 'q' }),
	);
	assert.equal(count.total, 2);
	assert.equal(count.columns.length, 5);
	assert.equal(count.rows[0].cells.text.text, 'do it');

	const completed = taskAdapter(
		adapterInput({ object: 'task', measure: 'completed', queryId: 'q' }),
	);
	assert.equal(completed.total, 1);
	assert.equal(completed.scalarText, '1');

	const open = taskAdapter(
		adapterInput({ object: 'task', measure: 'open', queryId: 'q' }),
	);
	assert.equal(open.total, 1);
	assert.equal(open.rows[0].cells.status.text, 'open');
});

test('task adapter truncates while keeping the pre-truncation total', () => {
	const dataset = taskAdapter(
		adapterInput({ object: 'task', measure: 'count', queryId: 'q', limit: 1 }),
	);
	assert.equal(dataset.rows.length, 1);
	assert.equal(dataset.total, 2);
	assert.equal(dataset.truncated, true);
});

test('task adapter renders a daily series without a snapshot', () => {
	const points = [
		{ date: '2026-11-08', total: 3, completed: 1, open: 2, cancelled: 0, other: 0 },
		{ date: '2026-11-09', total: 4, completed: 2, open: 2, cancelled: 0, other: 0 },
	];
	const dataset = taskAdapter(
		adapterInput(
			{ object: 'task', measure: 'series', queryId: 'q', range: 30 },
			{ snapshot: undefined, metric: { points } },
		),
	);
	assert.equal(dataset.rows.length, 2);
	assert.equal(dataset.rows[1].cells.total.text, '4');
});

test('note adapter lists notes with formatted cells', () => {
	const dataset = noteAdapter(
		adapterInput({ object: 'note', measure: 'count', queryId: 'q' }),
	);
	assert.equal(dataset.total, 2);
	assert.equal(dataset.scalarText, '2');
	assert.equal(dataset.rows[0].cells.tasks.text, '2');
	assert.match(dataset.rows[0].cells.size.text, /B$/);
});

test('file and folder adapters read the on-demand tree records', () => {
	const files = fileAdapter(
		adapterInput({ object: 'file', measure: 'count', queryId: 'q' }),
	);
	assert.equal(files.total, 2);
	assert.equal(files.rows[1].cells.extension.text, 'png');

	const folders = folderAdapter(
		adapterInput({ object: 'folder', measure: 'count', queryId: 'q' }),
	);
	assert.equal(folders.total, 1);
	assert.equal(folders.rows[0].cells.files.text, '1');
});

test('project adapter maps metric groups and survives a missing metric', () => {
	const groups = [
		{
			key: 'P1',
			name: 'P1',
			folder: '3-任务/P1',
			fileCount: 1,
			bucket: { total: 2, completed: 1, open: 1, cancelled: 0, other: 0, ratio: 0.5 },
		},
	];
	const dataset = projectAdapter(
		adapterInput(
			{ object: 'project', measure: 'ratio', queryId: 'q' },
			{ metric: { groups } },
		),
	);
	assert.equal(dataset.total, 1);
	assert.equal(dataset.rows[0].cells.ratio.text, '50%');

	const empty = projectAdapter(
		adapterInput({ object: 'project', measure: 'count', queryId: 'q' }),
	);
	assert.equal(empty.total, 0);
});

test('every adapter returns an empty dataset without a snapshot', () => {
	const pairs = [
		[taskAdapter, 'task'],
		[noteAdapter, 'note'],
		[fileAdapter, 'file'],
		[folderAdapter, 'folder'],
	];
	for (const [adapter, object] of pairs) {
		const dataset = adapter(
			adapterInput(
				{ object, measure: 'count', queryId: 'q' },
				{ snapshot: EMPTY },
			),
		);
		assert.equal(dataset.total, 0);
		assert.deepEqual(dataset.rows, []);
		assert.equal(dataset.truncated, false);
	}
});
