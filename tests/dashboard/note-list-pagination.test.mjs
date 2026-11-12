import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { noteListComponent } = await load(
	'../../src/dashboard/components/note-list.ts',
);

test('the note list requests notes without truncating the dataset', () => {
	const request = noteListComponent.toDatasetRequest({
		id: 'c1',
		type: 'note-list',
		queryId: 'builtin:notes-all',
	});
	assert.equal(request.object, 'note');
	assert.equal(request.queryId, 'builtin:notes-all');
	assert.equal(Object.hasOwn(request, 'limit'), false);
});

test('the limit setting is relabelled as items per page', () => {
	const setting = noteListComponent.settings.find(
		(entry) => entry.key === 'limit',
	);
	assert.ok(setting, 'note list must expose a limit setting');
	assert.equal(setting.kind, 'number');
	assert.equal(setting.labelKey, 'COMPONENT_NOTE_LIST_PAGE_SIZE');
	assert.equal(setting.min, 1);
	assert.equal(setting.max, 100);
	assert.equal(setting.fallback, 20);
});

test('createConfig seeds the defaults and page size', () => {
	const created = noteListComponent.createConfig('builtin:notes-all');
	assert.equal(created.queryId, 'builtin:notes-all');
	assert.equal(created.limit, 20);
	assert.equal(created.w, 6);
	assert.equal(created.h, 3);
});
