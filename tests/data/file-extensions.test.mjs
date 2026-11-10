import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './helpers.mjs';

const {
	NOTE_EXTENSIONS,
	FILE_EXTENSION_GROUPS,
	normalizeExtensions,
	matchesFileExtension,
} = await load('../../src/data/file-extensions.ts');

test('normalizeExtensions handles empty input', () => {
	assert.deepEqual(normalizeExtensions(undefined), []);
	assert.deepEqual(normalizeExtensions([]), []);
});

test('normalizeExtensions trims dots, lowercases, dedupes and sorts', () => {
	assert.deepEqual(
		normalizeExtensions([' .PDF ', 'png', 'pdf', 'PNG']),
		['pdf', 'png'],
	);
});

test('normalizeExtensions drops empty values and path separators', () => {
	assert.deepEqual(normalizeExtensions(['', 'a/b', 'c\\d']), []);
	assert.deepEqual(normalizeExtensions(['', 'a/b', 'c\\d', 'png']), ['png']);
});

test('normalizeExtensions drops note types', () => {
	assert.deepEqual(normalizeExtensions(['md', 'canvas', 'pdf']), ['pdf']);
});

test('an empty whitelist matches every non-note file', () => {
	assert.equal(matchesFileExtension('png', []), true);
	assert.equal(matchesFileExtension('', []), true);
});

test('note types never match, even with an empty whitelist', () => {
	assert.equal(matchesFileExtension('MD', []), false);
	assert.equal(matchesFileExtension('canvas', ['md']), false);
	assert.equal(matchesFileExtension('md', ['md']), false);
});

test('a whitelist matches case-insensitively and excludes others', () => {
	assert.equal(matchesFileExtension('PNG', ['png']), true);
	assert.equal(matchesFileExtension('jpg', ['png']), false);
	assert.equal(matchesFileExtension('', ['png']), false);
});

test('extension groups are lowercase, unique and never note types', () => {
	const keys = FILE_EXTENSION_GROUPS.map((group) => group.key);
	assert.equal(new Set(keys).size, keys.length);
	for (const group of FILE_EXTENSION_GROUPS) {
		for (const ext of group.extensions) {
			assert.equal(ext, ext.toLowerCase());
			assert.ok(!NOTE_EXTENSIONS.has(ext));
		}
	}
});
