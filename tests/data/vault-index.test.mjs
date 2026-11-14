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

test('a transient read failure is retried within the same load', async () => {
	const file = makeFile('3-任务/a.md', '# 任务\n- [ ] one\n');
	file.failuresLeft = 1;
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务', [file]),
		outcome: makeFolder('4-成果'),
	};
	const app = makeApp(tree);
	const read = app.vault.cachedRead;
	app.vault.cachedRead = async (target) => {
		if (target.failuresLeft > 0) {
			target.failuresLeft -= 1;
			throw new Error('read failed');
		}
		return read(target);
	};
	const index = new VaultIndex(app, () => makeConfig());

	const snapshot = await index.getSnapshot();
	assert.deepEqual(
		snapshot.notes.map((note) => note.path),
		['3-任务/a.md'],
	);
});

test('a persistent read failure skips the file and retries next snapshot', async () => {
	const bad = makeFile('3-任务/bad.md', '# 任务\n- [ ] bad\n');
	bad.failuresLeft = Number.POSITIVE_INFINITY;
	const good = makeFile('3-任务/good.md', '# 任务\n- [ ] good\n');
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务', [bad, good]),
		outcome: makeFolder('4-成果'),
	};
	const app = makeApp(tree);
	const read = app.vault.cachedRead;
	app.vault.cachedRead = async (target) => {
		if (target.failuresLeft > 0) {
			target.failuresLeft -= 1;
			throw new Error('read failed');
		}
		return read(target);
	};
	const index = new VaultIndex(app, () => makeConfig());

	const first = await index.getSnapshot();
	assert.deepEqual(
		first.notes.map((note) => note.path),
		['3-任务/good.md'],
	);

	bad.failuresLeft = 0;
	const second = await index.getSnapshot();
	assert.deepEqual(
		second.notes.map((note) => note.path).sort(),
		['3-任务/bad.md', '3-任务/good.md'],
	);
});

function makeExtraTree() {
	const person = makeFile('5-人物/Johnny.md', '# 任务\n- [ ] 联系 Johnny\n');
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务'),
		outcome: makeFolder('4-成果'),
		people: makeFolder('5-人物', [person]),
	};
	return { person, tree, app: makeApp(tree) };
}

test('extraRoots indexes folders outside the four roots', async () => {
	const { app } = makeExtraTree();
	const index = new VaultIndex(app, () => makeConfig());

	const base = await index.getSnapshot();
	assert.deepEqual(base.notes, []);
	assert.equal(base.extraPaths, undefined);

	const scoped = await index.getSnapshot({ extraRoots: ['5-人物'] });
	assert.deepEqual(
		scoped.notes.map((note) => note.path),
		['5-人物/Johnny.md'],
	);
	assert.deepEqual(
		scoped.tasks.map((task) => task.text),
		['联系 Johnny'],
	);
	assert.deepEqual(scoped.extraPaths, ['5-人物']);
});

test('extra records never leak into later snapshots without extraRoots', async () => {
	const { app } = makeExtraTree();
	const index = new VaultIndex(app, () => makeConfig());

	await index.getSnapshot({ extraRoots: ['5-人物'] });
	const plain = await index.getSnapshot();
	assert.deepEqual(plain.notes, []);
	assert.equal(plain.extraPaths, undefined);
	assert.deepEqual(
		(await index.getSnapshot({ extraRoots: [] })).notes,
		[],
	);
});

test('a base snapshot keeps the extra cache warm', async () => {
	const { app } = makeExtraTree();
	const index = new VaultIndex(app, () => makeConfig());

	const scoped = await index.getSnapshot({ extraRoots: ['5-人物'] });
	assert.equal(scoped.notes.length, 1);
	assert.equal(app.reads, 1);

	await index.getSnapshot({ withTree: false });
	const again = await index.getSnapshot({ extraRoots: ['5-人物'] });
	assert.equal(again.notes.length, 1);
	assert.equal(app.reads, 1); // cached, not re-read
});

test('modify invalidation refreshes extra records', async () => {
	const { person, app } = makeExtraTree();
	const index = new VaultIndex(app, () => makeConfig());
	await index.getSnapshot({ extraRoots: ['5-人物'] });

	person.content = '# 任务\n- [ ] 更新后\n';
	person.stat = { ...person.stat, mtime: 5, size: person.content.length };
	index.invalidate(person.path);

	const snapshot = await index.getSnapshot({ extraRoots: ['5-人物'] });
	assert.deepEqual(
		snapshot.tasks.map((task) => task.text),
		['更新后'],
	);
});

test('remove drops extra records', async () => {
	const { person, tree, app } = makeExtraTree();
	const index = new VaultIndex(app, () => makeConfig());
	await index.getSnapshot({ extraRoots: ['5-人物'] });

	tree.people.children = [];
	app.nodes.delete(person.path);
	index.remove(person.path);

	const snapshot = await index.getSnapshot({ extraRoots: ['5-人物'] });
	assert.deepEqual(snapshot.notes, []);
});

test('withTree merges extra files and folders', async () => {
	const { app } = makeExtraTree();
	const index = new VaultIndex(app, () => makeConfig());

	const snapshot = await index.getSnapshot({
		withTree: true,
		extraRoots: ['5-人物'],
	});
	assert.deepEqual(
		snapshot.files.map((file) => file.path),
		['5-人物/Johnny.md'],
	);
	const people = snapshot.folders.find((folder) => folder.path === '5-人物');
	assert.ok(people);
	assert.equal(people.fileCount, 1);
});

test('multi-level extra roots do not add ancestor folder records', async () => {
	const deep = makeFile('5-人物/sub/deep.md', '# 任务\n- [ ] deep\n');
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务'),
		outcome: makeFolder('4-成果'),
		people: makeFolder('5-人物', [makeFolder('5-人物/sub', [deep])]),
	};
	const index = new VaultIndex(makeApp(tree), () => makeConfig());

	const snapshot = await index.getSnapshot({
		withTree: true,
		extraRoots: ['5-人物/sub'],
	});
	assert.deepEqual(
		snapshot.folders
			.map((folder) => folder.path)
			.filter((path) => path.startsWith('5-人物')),
		['5-人物/sub'],
	);
	assert.deepEqual(snapshot.extraPaths, ['5-人物/sub']);
});

test('extra roots inside the four roots are ignored', async () => {
	const note = makeFile('3-任务/proj/n.md', '# 任务\n- [ ] n\n');
	const tree = {
		input: makeFolder('1-输入'),
		output: makeFolder('2-输出'),
		task: makeFolder('3-任务', [makeFolder('3-任务/proj', [note])]),
		outcome: makeFolder('4-成果'),
	};
	const index = new VaultIndex(makeApp(tree), () => makeConfig());

	const snapshot = await index.getSnapshot({
		extraRoots: ['3-任务/proj'],
	});
	assert.deepEqual(
		snapshot.notes.map((item) => item.path),
		['3-任务/proj/n.md'],
	);
	assert.equal(snapshot.extraPaths, undefined);
});
