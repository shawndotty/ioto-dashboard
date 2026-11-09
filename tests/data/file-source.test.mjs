import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { fileRecords, folderRecords } = await load('../../src/data/file-source.ts');

function file(path, size, mtime, extension = 'md') {
	const base = path.slice(path.lastIndexOf('/') + 1);
	return {
		path,
		basename: base.replace(/\.[^.]+$/, ''),
		extension,
		size,
		ctime: mtime,
		mtime,
	};
}

test('file records derive the parent folder and sort by path', () => {
	const records = fileRecords([
		file('3-任务/P1/b.md', 10, 2),
		file('0-辅助/a.png', 20, 1, 'png'),
	]);
	assert.deepEqual(records.map((record) => record.path), [
		'0-辅助/a.png',
		'3-任务/P1/b.md',
	]);
	assert.equal(records[1].folder, '3-任务/P1');
});

test('folder records aggregate recursively, including non-markdown files', () => {
	const files = fileRecords([
		file('3-任务/P1/a.md', 100, 5),
		file('3-任务/P1/b.md', 50, 7),
		file('3-任务/P1/img/x.png', 200, 9, 'png'),
		file('1-输入/n.md', 30, 3),
	]);
	const folders = folderRecords(files, [
		'3-任务',
		'3-任务/P1',
		'3-任务/P1/img',
		'1-输入',
	]);
	const byPath = Object.fromEntries(folders.map((folder) => [folder.path, folder]));
	assert.equal(byPath['3-任务/P1'].directFiles, 2);
	assert.equal(byPath['3-任务/P1'].directFolders, 1);
	assert.equal(byPath['3-任务/P1'].fileCount, 3);
	assert.equal(byPath['3-任务/P1'].noteCount, 2);
	assert.equal(byPath['3-任务/P1'].totalSize, 350);
	assert.equal(byPath['3-任务/P1'].latestMtime, 9);
	assert.equal(byPath['3-任务'].fileCount, 3);
	assert.equal(byPath['3-任务'].noteCount, 2);
	assert.equal(byPath['1-输入'].fileCount, 1);
});

test('empty folder lists still produce zeroed records', () => {
	const [folder] = folderRecords([], ['4-成果/Empty']);
	assert.equal(folder.fileCount, 0);
	assert.equal(folder.noteCount, 0);
	assert.equal(folder.latestMtime, 0);
});
