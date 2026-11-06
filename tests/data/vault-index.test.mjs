import assert from 'node:assert/strict';
import test from 'node:test';
import { HEADINGS, load } from './helpers.mjs';

const { TFile } = await load('obsidian');
const { VaultIndex } = await load('../../src/data/vault-index.ts');

function makeFolder(path, children = []) {
	return { path, children };
}

function makeFile(path, content, { mtime = 1, frontmatter } = {}) {
	const file = new TFile();
	file.path = path;
	file.basename = path.split('/').pop().replace(/\.md$/, '');
	file.extension = 'md';
	file.stat = { ctime: 1, mtime, size: content.length };
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
	const app = {
		reads: 0,
		vault: {
			getAbstractFileByPath: (path) => nodes.get(path) ?? null,
			cachedRead: async (file) => {
				app.reads++;
				return file.content;
			},
			on: () => ({}),
			offref: () => {},
		},
		metadataCache: {
			getFileCache: (file) => ({ frontmatter: file.frontmatter }),
			on: () => ({}),
		},
		nodes,
	};
	return app;
}

function makeConfig(overrides = {}) {
	return {
		inputFolder: '1-输入',
		outputFolder: '2-输出',
		taskFolder: '3-任务',
		outcomeFolder: '4-成果',
		headings: HEADINGS,
		...overrides,
	};
}

test('builds notes, tasks and projects from all roots', async () => {
	const projectNote = makeFile(
		'3-任务/proj/_project.md',
		'---\nIOTOProject:\n  category: IOTO\n  startDate: 2026-01-01\n---\n',
		{
			frontmatter: {
				IOTOProject: { category: 'IOTO', startDate: '2026-01-01' },
			},
		},
	);
	const taskNote = makeFile(
		'3-任务/proj/list.md',
		'# 任务\n\n- [ ] open\n- [x] done\n',
	);
	const inputNote = makeFile('1-输入/a.md', '- [ ] ordinary checkbox\n');
	const ignored = makeFile('elsewhere/x.md', '# 任务\n- [ ] ignored\n');

	const tree = {
		input: makeFolder('1-输入', [inputNote]),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务', [
			makeFolder('3-任务/proj', [projectNote, taskNote]),
		]),
		outcome: makeFolder('4-成果'),
		other: makeFolder('elsewhere', [ignored]),
	};
	const app = makeApp(tree);
	let config = makeConfig();
	const index = new VaultIndex(app, () => config);

	const snapshot = await index.getSnapshot();
	assert.deepEqual(
		snapshot.notes.map((note) => note.path).sort(),
		['1-输入/a.md', '3-任务/proj/_project.md', '3-任务/proj/list.md'],
	);
	assert.deepEqual(
		snapshot.tasks.map((task) => task.text),
		['ordinary checkbox', 'open', 'done'],
	);
	assert.equal(snapshot.projects.length, 1);
	assert.equal(snapshot.projects[0].name, 'proj');
	assert.equal(snapshot.projects[0].category, 'IOTO');
	assert.equal(snapshot.notes.find((note) => note.path === '3-任务/proj/list.md').fileTaskCount, 2);

	const second = await index.getSnapshot();
	assert.equal(second.tasks.length, 3);
});

test('modify invalidates only once and refreshes the cached tasks', async () => {
	const file = makeFile('3-任务/a.md', '# 任务\n- [ ] first\n');
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务', [file]),
		outcome: makeFolder('4-成果'),
	};
	const app = makeApp(tree);
	const index = new VaultIndex(app, () => makeConfig());
	let notifications = 0;
	index.subscribe(() => notifications++);

	await index.getSnapshot();
	assert.equal(notifications, 0);

	file.content = '# 任务\n- [ ] first\n- [ ] second\n';
	file.stat = { ...file.stat, mtime: 2, size: file.content.length };
	index.invalidate(file.path);
	assert.equal(notifications, 1);

	const snapshot = await index.getSnapshot();
	assert.deepEqual(
		snapshot.tasks.map((task) => task.text),
		['first', 'second'],
	);
});

test('create, delete and rename keep the index in sync', async () => {
	const taskFolder = makeFolder('3-任务');
	const existing = makeFile('3-任务/keep.md', '# 任务\n- [ ] keep\n');
	taskFolder.children.push(existing);
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: taskFolder,
		outcome: makeFolder('4-成果'),
	};
	const app = makeApp(tree);
	const index = new VaultIndex(app, () => makeConfig());
	await index.getSnapshot();

	const created = makeFile('3-任务/new.md', '# 任务\n- [ ] new\n');
	taskFolder.children.push(created);
	app.nodes.set(created.path, created);
	index.invalidate(created.path);
	assert.deepEqual(
		(await index.getSnapshot()).notes.map((note) => note.path).sort(),
		['3-任务/keep.md', '3-任务/new.md'],
	);

	taskFolder.children.splice(taskFolder.children.indexOf(created), 1);
	app.nodes.delete(created.path);
	index.remove(created.path);
	assert.deepEqual(
		(await index.getSnapshot()).notes.map((note) => note.path),
		['3-任务/keep.md'],
	);

	existing.path = '3-任务/renamed.md';
	existing.basename = 'renamed';
	app.nodes.delete('3-任务/keep.md');
	app.nodes.set(existing.path, existing);
	index.remove('3-任务/keep.md');
	index.invalidate(existing.path);
	assert.deepEqual(
		(await index.getSnapshot()).notes.map((note) => note.path),
		['3-任务/renamed.md'],
	);
});

test('rebuild picks up new roots and settings changes', async () => {
	const newFile = makeFile('5-收集/a.md', '# 任务\n- [ ] collected\n');
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务'),
		outcome: makeFolder('4-成果'),
		collect: makeFolder('5-收集', [newFile]),
	};
	const app = makeApp(tree);
	let config = makeConfig();
	const index = new VaultIndex(app, () => config);
	assert.equal((await index.getSnapshot()).notes.length, 0);

	config = makeConfig({ inputFolder: '5-收集' });
	index.rebuild();
	const snapshot = await index.getSnapshot();
	assert.deepEqual(
		snapshot.notes.map((note) => note.path),
		['5-收集/a.md'],
	);
	assert.equal(snapshot.tasks[0].text, 'collected');
});

test('rebuild reuses untouched cache entries but re-reads changed files', async () => {
	const file = makeFile('3-任务/a.md', '# 任务\n- [ ] one\n');
	const stable = makeFile('3-任务/stable.md', '# 任务\n- [ ] stable\n');
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务', [file, stable]),
		outcome: makeFolder('4-成果'),
	};
	const app = makeApp(tree);
	const index = new VaultIndex(app, () => makeConfig());
	await index.getSnapshot();
	assert.equal(app.reads, 2);

	file.content = '# 任务\n- [ ] changed\n';
	file.stat = { ...file.stat, mtime: 9 };
	index.rebuild();
	const snapshot = await index.getSnapshot();
	assert.equal(app.reads, 3); // only the changed file is read again
	assert.deepEqual(
		snapshot.tasks.map((task) => task.text).sort(),
		['changed', 'stable'],
	);
});
