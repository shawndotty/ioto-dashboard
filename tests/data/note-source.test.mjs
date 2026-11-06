import assert from 'node:assert/strict';
import test from 'node:test';
import { HEADINGS, fixture, load } from './helpers.mjs';

const {
	buildNoteRecord,
	collectFacets,
	folderOf,
	isInsideFolder,
	normalizeFolder,
	resolveIoType,
	toText,
} = await load('../../src/data/note-source.ts');
const { parseCheckboxes } = await load('../../src/data/task-source.ts');

const ROOTS = {
	inputFolder: '1-输入',
	outputFolder: '2-输出',
	taskFolder: '3-任务',
	outcomeFolder: '4-成果',
};

test('folder containment is boundary-aware', () => {
	assert.equal(isInsideFolder('1-输入/a.md', '1-输入'), true);
	assert.equal(isInsideFolder('1-输入/a.md', '1-输入/'), true);
	assert.equal(isInsideFolder('1-输入x/a.md', '1-输入'), false);
	assert.equal(isInsideFolder('1-输入', '1-输入'), true);
	assert.equal(isInsideFolder('a.md', ''), false);
	assert.equal(normalizeFolder('1-输入///'), '1-输入');
});

test('resolveIoType follows root folders, never the title', () => {
	assert.equal(resolveIoType('1-输入/a.md', ROOTS), 'Input');
	assert.equal(resolveIoType('2-输出/a.md', ROOTS), 'Output');
	assert.equal(resolveIoType('3-任务/a.md', ROOTS), 'Task');
	assert.equal(resolveIoType('4-成果/a.md', ROOTS), 'Outcome');
	assert.equal(resolveIoType('3-任务/1-输入/nested.md', ROOTS), 'Task');
	assert.equal(resolveIoType('elsewhere/1-输入.md', ROOTS), 'Unknown');
	assert.equal(folderOf('3-任务/项目/a.md'), '3-任务/项目');
	assert.equal(folderOf('a.md'), '');
});

test('toText never produces [object Object]', () => {
	assert.equal(toText(undefined), undefined);
	assert.equal(toText(null), undefined);
	assert.equal(toText('  '), undefined);
	assert.equal(toText(' x '), 'x');
	assert.equal(toText(2026), '2026');
	assert.equal(toText(true), 'true');
	assert.equal(toText(new Date('2026-01-02T00:00:00Z')), '2026-01-02');
	assert.equal(toText(['a', 1, null, {}]), 'a, 1');
	assert.equal(toText({ nested: true }), undefined);
});

test('buildNoteRecord counts file and section tasks separately', () => {
	const content = fixture('ioo-sections.md');
	const tasks = parseCheckboxes(content, HEADINGS).map((task, index) => ({
		path: '3-任务/note.md',
		line: index,
		...task,
	}));
	const note = buildNoteRecord(
		{
			path: '3-任务/note.md',
			basename: 'note',
			ctime: 1,
			mtime: 2,
			size: content.length,
			ioType: 'Task',
			frontmatter: {
				Project: ['IOTO', 'Other'],
				Subject: 'Dashboard',
				Status: 'Doing',
			},
		},
		tasks,
	);
	assert.equal(note.folder, '3-任务');
	assert.equal(note.project, 'IOTO, Other');
	assert.equal(note.subject, 'Dashboard');
	assert.equal(note.status, 'Doing');
	assert.equal(note.fileTaskCount, 3);
	assert.equal(note.fileCompletedCount, 1);
	assert.equal(note.sectionTaskCount, 3);
	assert.equal(note.sectionCompletedCount, 1);

	const outsideScope = buildNoteRecord(
		{
			path: '3-任务/note.md',
			basename: 'note',
			ctime: 1,
			mtime: 2,
			size: 0,
			ioType: 'Task',
		},
		tasks,
		['task'],
	);
	assert.equal(outsideScope.fileTaskCount, 3);
	assert.equal(outsideScope.sectionTaskCount, 0);
});

test('collectFacets dedupes and sorts', () => {
	const base = {
		path: 'x',
		basename: 'x',
		folder: '',
		ioType: 'Input',
		ctime: 0,
		mtime: 0,
		size: 0,
		fileTaskCount: 0,
		fileCompletedCount: 0,
		sectionTaskCount: 0,
		sectionCompletedCount: 0,
	};
	const facets = collectFacets([
		{ ...base, project: 'B', status: 'Doing', subject: ['y', 'x'] },
		{ ...base, path: 'y', project: 'A', status: 'Doing', subject: 'z' },
		{ ...base, path: 'z', project: 'B', subject: ['x'] },
	]);
	assert.deepEqual(facets.projects, ['A', 'B']);
	assert.deepEqual(facets.statuses, ['Doing']);
	assert.deepEqual(facets.subjects, ['x', 'y', 'z']);
});
