import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { MAX_EXTRA_ROOTS, baseRoots, collectExtraRoots, normalizeExtraRoots } =
	await load('../../src/query/extra-roots.ts');
const { createDefaultFilterState } = await load(
	'../../src/data/saved-query-adapter.ts',
);

const CONFIG = {
	inputFolder: '1-输入',
	outputFolder: '2-输出/',
	taskFolder: '3-任务',
	outcomeFolder: '4-成果',
	headings: {},
};

function definition(target = 'note', folders = []) {
	return {
		id: `user:${target}`,
		name: target,
		target,
		scope: { folders, includeSubfolders: true },
		filters: createDefaultFilterState(),
	};
}

function captureWarnings(run) {
	const original = console.warn;
	const messages = [];
	console.warn = (...args) => messages.push(args.join(' '));
	try {
		return { result: run(), messages };
	} finally {
		console.warn = original;
	}
}

test('baseRoots normalizes and drops empty folder settings', () => {
	assert.deepEqual(baseRoots(CONFIG), ['1-输入', '2-输出', '3-任务', '4-成果']);
	assert.deepEqual(baseRoots({ ...CONFIG, outputFolder: '' }), [
		'1-输入',
		'3-任务',
		'4-成果',
	]);
});

test('normalizeExtraRoots trims, normalizes and de-duplicates', () => {
	assert.deepEqual(
		normalizeExtraRoots(
			['5-人物/', ' 5-人物 ', '6-项目\\子', '', '/'],
			CONFIG,
		),
		['5-人物', '6-项目/子'],
	);
});

test('normalizeExtraRoots drops paths already inside a framework root', () => {
	assert.deepEqual(
		normalizeExtraRoots(
			['3-任务/proj', '1-输入', '2-输出/日记', '5-人物'],
			CONFIG,
		),
		['5-人物'],
	);
});

test('normalizeExtraRoots collapses nested paths into their ancestor', () => {
	assert.deepEqual(
		normalizeExtraRoots(
			['5-人物/Johnny/日记', '5-人物', '5-人物/sub/deep'],
			CONFIG,
		),
		['5-人物'],
	);
});

test('normalizeExtraRoots caps the list at MAX_EXTRA_ROOTS', () => {
	const roots = Array.from({ length: 25 }, (_, index) => `extra-${index}`);
	const { result, messages } = captureWarnings(() =>
		normalizeExtraRoots(roots, CONFIG),
	);
	assert.equal(result.length, MAX_EXTRA_ROOTS);
	assert.ok(result.every((root) => roots.includes(root)));
	assert.ok(
		messages.some((message) => message.includes('capped at 20')),
	);
});

test('collectExtraRoots merges every target and skips empty folders', () => {
	const roots = collectExtraRoots(
		[
			definition('note', ['5-人物']),
			definition('task', ['5-人物', '6-项目']),
			definition('file', []),
			definition('folder', ['6-项目/sub']),
		],
		CONFIG,
	);
	assert.deepEqual(roots, ['5-人物', '6-项目']);
});

test('collectExtraRoots ignores framework-root folders from builtin queries', () => {
	const roots = collectExtraRoots([definition('note', []), definition('task', [])], CONFIG);
	assert.deepEqual(roots, []);
});
