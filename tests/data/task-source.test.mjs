import assert from 'node:assert/strict';
import test from 'node:test';
import { HEADINGS, fixture, load } from './helpers.mjs';

const { parseCheckboxes, taskMarker, stripComments } = await load(
	'../../src/data/task-source.ts',
);

test('taskMarker maps every supported checkbox char', () => {
	assert.equal(taskMarker(' '), 'open');
	assert.equal(taskMarker('x'), 'done');
	assert.equal(taskMarker('X'), 'done');
	assert.equal(taskMarker('-'), 'cancelled');
	assert.equal(taskMarker('/'), 'in-progress');
	assert.equal(taskMarker('>'), 'forwarded');
	assert.equal(taskMarker('?'), 'other');
});

test('stripComments removes %% and HTML comments', () => {
	assert.equal(stripComments('hello %%hidden%% world'), 'hello  world');
	assert.equal(stripComments('hello <!-- hidden --> world'), 'hello  world');
	assert.equal(stripComments('%%Cursor%%'), '');
});

test('headings resolve a section role and nested subheadings inherit it', () => {
	const tasks = parseCheckboxes(fixture('task-section.md'), HEADINGS);
	assert.equal(tasks.length, 9); // 2 checkboxes dropped: %%Cursor%% and empty text

	const byRole = (role) => tasks.filter((task) => task.sectionRole === role);
	assert.equal(byRole('goal').length, 1);
	assert.equal(byRole('task').length, 7);
	assert.equal(byRole('review').length, 1);

	const nestedDone = tasks.find((task) => task.text === 'nested done');
	assert.equal(nestedDone?.sectionRole, 'task');
	assert.equal(nestedDone?.sectionHeading, '验收');

	const nestedIndented = tasks.find((task) => task.text === 'nested indented');
	assert.equal(nestedIndented?.indent, 4);
});

test('ioo sections classify input/output/outcome', () => {
	const tasks = parseCheckboxes(fixture('ioo-sections.md'), HEADINGS);
	assert.deepEqual(
		tasks.map((task) => task.sectionRole),
		['input', 'output', 'outcome'],
	);
});

test('duplicate and suffixed headings are all collected (old findIndex bug)', () => {
	const tasks = parseCheckboxes(fixture('heading-variants.md'), HEADINGS);
	assert.equal(tasks.length, 3);
	assert.deepEqual(
		tasks.map((task) => task.sectionRole),
		['output', 'output', 'output'],
	);
});

test('marker semantics: only x/X count as completed, duplicates kept', () => {
	const tasks = parseCheckboxes(fixture('markers.md'), HEADINGS);
	assert.equal(tasks.length, 9);
	assert.equal(tasks.filter((task) => task.isCompleted).length, 2);
	assert.equal(
		tasks.find((task) => task.text === 'cancelled')?.marker,
		'cancelled',
	);
	assert.equal(
		tasks.find((task) => task.text === 'forwarded')?.marker,
		'forwarded',
	);
	assert.equal(
		tasks.filter((task) => task.text === 'duplicate text').length,
		2,
	);
});

test('placeholders, multi-line comments and fenced code are skipped', () => {
	const tasks = parseCheckboxes(fixture('placeholders.md'), HEADINGS);
	assert.deepEqual(
		tasks.map((task) => task.text),
		['real task', 'inline  kept text'],
	);
	assert.ok(tasks.every((task) => !task.text.includes('%%')));
	assert.ok(tasks.every((task) => !task.text.includes('<!--')));
});
