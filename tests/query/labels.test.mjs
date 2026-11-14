import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { queryFilterSummary } = await load('../../src/ui/query-labels.ts');
const { createDefaultFilterState } = await load(
	'../../src/data/saved-query-adapter.ts',
);

function definition(overrides = {}) {
	return {
		id: 'user:test',
		name: 'Test',
		target: 'task',
		scope: { folders: [], includeSubfolders: true },
		filters: createDefaultFilterState(),
		...overrides,
	};
}

test('task queries always show the status segment', () => {
	assert.equal(
		queryFilterSummary(
			definition({ filters: createDefaultFilterState({ status: 'all' }) }),
		),
		'Status: All',
	);
	assert.equal(
		queryFilterSummary(
			definition({
				filters: createDefaultFilterState({ status: 'completed' }),
			}),
		),
		'Status: Completed',
	);
	assert.equal(
		queryFilterSummary(
			definition({
				filters: createDefaultFilterState({ status: 'incomplete' }),
			}),
		),
		'Status: Incomplete',
	);
});

test('name, project and subject are appended when present', () => {
	assert.equal(
		queryFilterSummary(
			definition({
				filters: createDefaultFilterState({
					status: 'incomplete',
					name: 'report',
					project: 'AI',
					subject: 'Docs',
				}),
			}),
		),
		'Status: Incomplete · Name: report · Project: AI · Subject: Docs',
	);
});

test('note queries omit the status segment', () => {
	assert.equal(
		queryFilterSummary(
			definition({
				target: 'note',
				filters: createDefaultFilterState({
					status: 'incomplete',
					name: 'report',
				}),
			}),
		),
		'Name: report',
	);
});

test('empty conditions return an empty string', () => {
	assert.equal(
		queryFilterSummary(
			definition({
				target: 'note',
				filters: createDefaultFilterState(),
			}),
		),
		'',
	);
	assert.equal(
		queryFilterSummary(
			definition({
				target: 'file',
				filters: createDefaultFilterState(),
			}),
		),
		'',
	);
});
