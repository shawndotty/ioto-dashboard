import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './helpers.mjs';

const { queryNotes, matchesSubject, matchesDate } = await load(
	'../../src/data/note-query.ts',
);
const { createDefaultFilterState } = await load(
	'../../src/data/saved-query-adapter.ts',
);

function note(overrides = {}) {
	return {
		path: '1-输入/a.md',
		basename: 'a',
		folder: '1-输入',
		ioType: 'Input',
		ctime: Date.parse('2026-01-01T00:00:00Z'),
		mtime: Date.parse('2026-01-02T00:00:00Z'),
		size: 10,
		fileTaskCount: 0,
		fileCompletedCount: 0,
		sectionTaskCount: 0,
		sectionCompletedCount: 0,
		...overrides,
	};
}

const NOTES = [
	note({ basename: 'Alpha', project: 'IOTO', status: 'Doing', subject: ['AI', 'PKM'] }),
	note({
		path: '2-输出/b.md',
		basename: 'Beta',
		folder: '2-输出',
		ioType: 'Output',
		project: 'Other',
		subject: 'Dashboard',
	}),
	note({
		path: '1-输入/c.md',
		basename: 'Gamma',
		project: 'IOTO',
		status: 'Done',
		subject: ['PKM'],
	}),
];

test('empty noteType means all categories, a value filters them', () => {
	assert.equal(queryNotes(NOTES, createDefaultFilterState()).length, 3);
	assert.equal(
		queryNotes(NOTES, createDefaultFilterState({ noteType: ['Input'] })).length,
		2,
	);
	assert.equal(
		queryNotes(NOTES, createDefaultFilterState({ noteType: ['Output'] })).length,
		1,
	);
});

test('name, project and fileStatus are case-insensitive substring matches', () => {
	assert.deepEqual(
		queryNotes(NOTES, createDefaultFilterState({ name: 'alp' })).map(
			(item) => item.basename,
		),
		['Alpha'],
	);
	assert.equal(
		queryNotes(NOTES, createDefaultFilterState({ project: 'ioto' })).length,
		2,
	);
	assert.deepEqual(
		queryNotes(NOTES, createDefaultFilterState({ fileStatus: 'do' })).map(
			(item) => item.basename,
		),
		['Alpha', 'Gamma'],
	);
	assert.equal(
		queryNotes(NOTES, createDefaultFilterState({ project: 'Missing' })).length,
		0,
	);
});

test('subject matches arrays and strings', () => {
	assert.equal(matchesSubject(['AI', 'PKM'], 'pk'), true);
	assert.equal(matchesSubject('Dashboard', 'board'), true);
	assert.equal(matchesSubject(undefined, 'x'), false);
	assert.equal(matchesSubject(undefined, ''), true);
	assert.equal(
		queryNotes(NOTES, createDefaultFilterState({ subject: 'pkm' })).length,
		2,
	);
});

test('custom filters honour target note/task and value types', () => {
	const defs = [
		{ name: 'Score', type: 'number', target: 'note' },
		{ name: 'Flag', type: 'boolean', target: 'note' },
		{ name: 'TaskOnly', type: 'text', target: 'task' },
	];
	const withMeta = [
		note({ basename: 'Num', frontmatter: { Score: 5, Flag: true } }),
		note({ path: '1-输入/d.md', basename: 'Num2', frontmatter: { Score: '5' } }),
	];
	const filters = createDefaultFilterState({
		custom: { Score: '5', TaskOnly: 'x' },
	});
	assert.deepEqual(
		queryNotes(withMeta, filters, defs).map((item) => item.basename),
		['Num', 'Num2'],
	);

	const flagFilters = createDefaultFilterState({ custom: { Flag: 'true' } });
	assert.deepEqual(
		queryNotes(withMeta, flagFilters, defs).map((item) => item.basename),
		['Num'],
	);

	const missingNumber = createDefaultFilterState({ custom: { Score: '6' } });
	assert.equal(queryNotes(withMeta, missingNumber, defs).length, 0);
});

test('date presets and custom ranges read the chosen timestamp', () => {
	const recent = note({ ctime: Date.now() });
	const old = note({
		path: '1-输入/old.md',
		ctime: Date.parse('2020-01-01T00:00:00Z'),
		mtime: Date.parse('2020-01-01T00:00:00Z'),
	});
	assert.equal(
		queryNotes(
			[recent, old],
			createDefaultFilterState({ datePreset: 'last7days', dateType: 'created' }),
		).length,
		1,
	);
	assert.equal(
		queryNotes(
			[recent, old],
			createDefaultFilterState({
				datePreset: 'custom',
				dateType: 'created',
				dateStart: '2019-01-01',
				dateEnd: '2021-01-01',
			}),
		).length,
		1,
	);
	assert.equal(
		matchesDate(Date.parse('2026-01-01T12:00:00Z'), 0, {
			dateType: 'created',
			datePreset: 'custom',
			dateStart: '2026-01-01',
			dateEnd: '2026-01-01',
		}),
		true,
	);
});

test('paths scope restricts folders and honours includeSubfolders', () => {
	const nested = note({
		path: '1-输入/sub/n.md',
		basename: 'Nested',
		folder: '1-输入/sub',
	});
	const notes = [...NOTES, nested];
	const names = (items) => items.map((item) => item.basename);

	assert.deepEqual(
		names(queryNotes(notes, createDefaultFilterState(), [], { paths: ['1-输入'] })),
		['Alpha', 'Gamma', 'Nested'],
	);
	assert.deepEqual(
		names(
			queryNotes(notes, createDefaultFilterState(), [], {
				paths: ['1-输入'],
				includeSubfolders: false,
			}),
		),
		['Alpha', 'Gamma'],
	);
	assert.equal(
		queryNotes(notes, createDefaultFilterState(), [], { paths: ['2-输出'] }).length,
		1,
	);
	assert.equal(
		queryNotes(notes, createDefaultFilterState(), [], { paths: [] }).length,
		4,
	);
});

test('ioTypes scope narrows results before filters apply', () => {
	assert.deepEqual(
		queryNotes(NOTES, createDefaultFilterState(), [], {
			ioTypes: ['Input'],
		}).map((item) => item.basename),
		['Alpha', 'Gamma'],
	);
});

