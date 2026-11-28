import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './helpers.mjs';

const { sortNotes, sortTasks } = await load('../../src/data/sort.ts');

function note(basename, frontmatter) {
	return { basename, path: `x/${basename}.md`, frontmatter, ctime: 0, mtime: 0, size: 0 };
}

function task(noteBasename, noteFrontmatter) {
	return { path: `x/${noteBasename}.md`, noteBasename, noteFrontmatter, noteCtime: 0, noteMtime: 0, noteSize: 0 };
}

test('name sort stays on filenames when no display callback is passed', () => {
	const notes = [note('b', { aliases: ['A'] }), note('a', { aliases: ['Z'] })];
	assert.deepEqual(
		sortNotes(notes, 'name', 'asc').map((item) => item.basename),
		['a', 'b'],
	);
});

test('name sort follows the visible alias label when provided', () => {
	const notes = [note('b', { aliases: ['A'] }), note('a', { aliases: ['Z'] })];
	const names = (item) => String(item.frontmatter?.aliases?.[0] ?? item.basename);
	assert.deepEqual(
		sortNotes(notes, 'name', 'asc', names).map((item) => item.basename),
		['b', 'a'],
	);
});

test('task name sort follows the note alias when provided', () => {
	const tasks = [task('b', { aliases: ['A'] }), task('a', { aliases: ['Z'] })];
	const names = (item) => String(item.noteFrontmatter?.aliases?.[0] ?? item.noteBasename);
	assert.deepEqual(
		sortTasks(tasks, 'name', 'asc', names).map((item) => item.noteBasename),
		['b', 'a'],
	);
});