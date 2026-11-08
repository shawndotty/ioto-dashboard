import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { folderProjectName } = await load('../../src/data/note-source.ts');
const { listProjectUniverse, resolveProjectName } = await load(
	'../../src/metrics/project.ts',
);

test('folderProjectName reads only the first task-root segment', () => {
	assert.equal(folderProjectName('3-任务/Alpha/n.md', '3-任务'), 'Alpha');
	assert.equal(folderProjectName('3-任务/Alpha/sub/n.md', '3-任务'), 'Alpha');
	assert.equal(folderProjectName('3-任务/loose.md', '3-任务'), undefined);
	assert.equal(folderProjectName('1-输入/Alpha/n.md', '3-任务'), undefined);
	assert.equal(folderProjectName('3-任务', '3-任务'), undefined);
});

test('universe is task-root sub-folders with _project display names', () => {
	const snapshot = {
		notes: [
			{ path: '3-任务/Alpha/a.md', folder: '3-任务/Alpha' },
			{ path: '3-任务/Beta/sub/b.md', folder: '3-任务/Beta/sub' },
			{ path: '3-任务/loose.md', folder: '3-任務' },
			{ path: '1-输入/x.md', folder: '1-输入' },
		],
		tasks: [],
		projects: [
			{ path: '3-任务/Beta/_project.md', folder: '3-任务/Beta', name: 'Beta', project: 'Beta 计划' },
		],
	};
	const universe = listProjectUniverse(snapshot, '3-任务');
	assert.deepEqual(universe.map((item) => item.key), ['Alpha', 'Beta']);
	assert.equal(universe.find((item) => item.key === 'Beta').name, 'Beta 计划');
	assert.equal(universe.find((item) => item.key === 'Beta').folder, '3-任务/Beta');
});

test('resolveProjectName prefers frontmatter and falls back to folder', () => {
	assert.equal(
		resolveProjectName({ path: '3-任务/Alpha/n.md', project: undefined }, '3-任务'),
		'Alpha',
	);
	assert.equal(
		resolveProjectName({ path: '3-任务/Alpha/n.md', project: 'Given' }, '3-任务'),
		'Given',
	);
});
