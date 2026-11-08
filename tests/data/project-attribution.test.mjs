import assert from 'node:assert/strict';
import test from 'node:test';
import { HEADINGS, fixture, load } from './helpers.mjs';

const { TFile } = await load('obsidian');
const { VaultIndex } = await load('../../src/data/vault-index.ts');

// M0 recorded the legacy behaviour (`project === undefined` without
// frontmatter). M2 flips the contract to folder-first attribution; the legacy
// case is kept here as the regression anchor.
const CONTENT = fixture('project-without-frontmatter.md');

function makeFolder(path, children = []) {
	return { path, children };
}

function makeFile(path, content, frontmatter) {
	const file = new TFile();
	file.path = path;
	file.basename = path.split('/').pop().replace(/\.md$/, '');
	file.extension = 'md';
	file.stat = { ctime: 1, mtime: 1, size: content.length };
	file.content = content;
	file.frontmatter = frontmatter;
	return file;
}

function makeApp(tree) {
	const nodes = new Map();
	const index = (folder) => {
		nodes.set(folder.path, folder);
		for (const child of folder.children) {
			if (child.children) index(child);
			else nodes.set(child.path, child);
		}
	};
	for (const folder of Object.values(tree)) index(folder);
	return {
		vault: {
			getAbstractFileByPath: (path) => nodes.get(path) ?? null,
			cachedRead: async (file) => file.content,
			on: () => ({}),
			offref: () => {},
		},
		metadataCache: {
			getFileCache: (file) => ({ frontmatter: file.frontmatter }),
			on: () => ({}),
		},
	};
}

function makeConfig() {
	return {
		inputFolder: '1-输入',
		outputFolder: '2-输出',
		taskFolder: '3-任务',
		outcomeFolder: '4-成果',
		headings: HEADINGS,
	};
}

async function snapshotOf(files) {
	const app = makeApp({
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务', files),
		outcome: makeFolder('4-成果'),
	});
	const index = new VaultIndex(app, makeConfig);
	return index.getSnapshot();
}

test('task note without frontmatter inherits its project folder', async () => {
	const snapshot = await snapshotOf([
		makeFolder('3-任务/Alpha', [makeFile('3-任务/Alpha/note.md', CONTENT)]),
	]);
	const note = snapshot.notes.find((item) => item.path === '3-任务/Alpha/note.md');
	assert.equal(note.project, 'Alpha');
	assert.ok(snapshot.tasks.every((task) => task.project === 'Alpha'));
});

test('explicit frontmatter Project wins over the folder', async () => {
	const snapshot = await snapshotOf([
		makeFolder('3-任务/Alpha', [
			makeFile('3-任务/Alpha/note.md', CONTENT, { Project: 'Beta' }),
		]),
	]);
	assert.equal(
		snapshot.notes.find((item) => item.path === '3-任务/Alpha/note.md').project,
		'Beta',
	);
});

test('files directly under the task root stay unclassified', async () => {
	const snapshot = await snapshotOf([makeFile('3-任务/loose.md', CONTENT)]);
	assert.equal(snapshot.notes[0].project, undefined);
	assert.equal(snapshot.tasks[0].project, undefined);
});
