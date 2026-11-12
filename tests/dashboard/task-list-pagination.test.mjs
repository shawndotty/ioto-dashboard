import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { taskListComponent } = await load(
	'../../src/dashboard/components/task-list.ts',
);

test('task list requests the full dataset (no limit truncation)', () => {
	const request = taskListComponent.toDatasetRequest({
		id: 'c1',
		type: 'task-list',
		queryId: 'builtin:tasks-all',
	});
	assert.equal(request.object, 'task');
	assert.equal(request.queryId, 'builtin:tasks-all');
	assert.equal(Object.hasOwn(request, 'limit'), false);
});

test('the limit setting is relabelled as items per page', () => {
	const setting = taskListComponent.settings.find(
		(entry) => entry.key === 'limit',
	);
	assert.ok(setting, 'task list must expose a limit setting');
	assert.equal(setting.kind, 'number');
	assert.equal(setting.labelKey, 'COMPONENT_TASK_LIST_PAGE_SIZE');
	assert.equal(setting.min, 1);
	assert.equal(setting.max, 100);
	assert.equal(setting.fallback, 20);
});

test('the task list declares exactly one limit setting', () => {
	const limits = taskListComponent.settings.filter(
		(entry) => entry.key === 'limit',
	);
	assert.equal(limits.length, 1);
});
