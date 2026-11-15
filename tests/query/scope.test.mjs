import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	addScopeFolder,
	findCoveringFolder,
	findRedundantFolders,
	normalizeScopeFolders,
	removeScopeFolderAt,
	replaceScopeFolderAt,
} = await load('../../src/query/scope.ts');

test('normalizeScopeFolders normalizes separators, trims and de-duplicates', () => {
	assert.deepEqual(
		normalizeScopeFolders([
			' 3-任务\\项目A\\ ',
			'1-输入/',
			'3-任务/项目A',
			'',
			'   ',
		]),
		['3-任务/项目A', '1-输入'],
	);
});

test('normalizeScopeFolders drops the vault root', () => {
	assert.deepEqual(normalizeScopeFolders(['/', '2-输出']), ['2-输出']);
});

test('addScopeFolder appends and keeps the first occurrence of duplicates', () => {
	const base = ['1-输入', '2-输出'];
	assert.deepEqual(addScopeFolder(base, '3-任务'), [
		'1-输入',
		'2-输出',
		'3-任务',
	]);
	assert.deepEqual(addScopeFolder(base, '1-输入/'), ['1-输入', '2-输出']);
	assert.deepEqual(base, ['1-输入', '2-输出']);
});

test('removeScopeFolderAt removes one row and tolerates bad indexes', () => {
	const folders = ['1-输入', '2-输出', '3-任务'];
	assert.deepEqual(removeScopeFolderAt(folders, 1), ['1-输入', '3-任务']);
	assert.deepEqual(removeScopeFolderAt(folders, 5), folders);
	assert.deepEqual(removeScopeFolderAt(folders, -1), folders);
	assert.deepEqual(removeScopeFolderAt(['1-输入'], 0), []);
});

test('replaceScopeFolderAt replaces, normalizes and removes on empty input', () => {
	const folders = ['1-输入', '2-输出'];
	assert.deepEqual(replaceScopeFolderAt(folders, 1, ' 3-任务\\ '), [
		'1-输入',
		'3-任务',
	]);
	assert.deepEqual(replaceScopeFolderAt(folders, 0, '   '), ['2-输出']);
	assert.deepEqual(replaceScopeFolderAt(folders, 0, '/'), ['2-输出']);
});

test('replaceScopeFolderAt editing into a duplicate drops that row', () => {
	const folders = ['1-输入', '2-输出'];
	assert.deepEqual(replaceScopeFolderAt(folders, 1, '1-输入/'), ['1-输入']);
	assert.deepEqual(replaceScopeFolderAt(folders, 0, '2-输出'), ['2-输出']);
});

test('replaceScopeFolderAt appends when the index is out of bounds', () => {
	assert.deepEqual(replaceScopeFolderAt(['1-输入'], 4, '2-输出'), [
		'1-输入',
		'2-输出',
	]);
});

test('findRedundantFolders flags covered children in either order', () => {
	const expected = ['3-任务/项目A'];
	assert.deepEqual(
		findRedundantFolders(['3-任务', '3-任务/项目A'], true),
		expected,
	);
	assert.deepEqual(
		findRedundantFolders(['3-任务/项目A', '3-任务'], true),
		expected,
	);
	assert.deepEqual(
		findRedundantFolders(['3-任务', '3-任务/项目A'], false),
		[],
	);
	assert.deepEqual(findRedundantFolders(['3-任务', '1-输入'], true), []);
});

test('findCoveringFolder returns the covering ancestor', () => {
	assert.equal(
		findCoveringFolder(['3-任务', '1-输入'], '3-任务/项目A'),
		'3-任务',
	);
	assert.equal(findCoveringFolder(['1-输入'], '3-任务/项目A'), undefined);
	assert.equal(findCoveringFolder(['3-任务/项目A'], '3-任务/项目A'), undefined);
});
