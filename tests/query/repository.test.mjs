import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { QueryRepository, savedQueryToDefinition } = await load(
	'../../src/query/repository.ts',
);

const roots = {
	inputFolder: '1-输入',
	outputFolder: '2-输出',
	taskFolder: '3-任务',
	outcomeFolder: '4-成果',
};

const saved = {
	id: '42',
	name: 'Alpha open',
	category: 'Tasks',
	tab: 'Tasks',
	type: 'all',
	filters: { name: 'Alpha', status: 'incomplete' },
};

test('saved queries map category/tab to target and folder root', () => {
	const definition = savedQueryToDefinition(saved, roots);
	assert.equal(definition.id, 'saved:42');
	assert.equal(definition.target, 'task');
	assert.deepEqual(definition.scope.folders, ['3-任务']);
	assert.equal(definition.scope.includeSubfolders, true);
	assert.equal(definition.filters.name, 'Alpha');
	assert.equal(definition.filters.status, 'incomplete');
});

test('Notes category does not restrict folders', () => {
	const definition = savedQueryToDefinition(
		{ ...saved, category: 'Notes', tab: 'Notes' },
		roots,
	);
	assert.equal(definition.target, 'note');
	assert.deepEqual(definition.scope.folders, []);
});

test('repository exposes builtins + saved + user queries and lookups', () => {
	const user = {
		id: 'user:1',
		name: 'Mine',
		target: 'note',
		scope: { folders: ['2-输出'], includeSubfolders: true },
		filters: { name: '', project: '', subject: '', dateType: 'created', dateStart: '', dateEnd: '', datePreset: 'all', status: 'all', fileStatus: '' },
	};
	const repository = new QueryRepository([saved], [user], roots);
	const ids = repository.list().map((item) => item.id);
	assert.ok(ids.includes('builtin:tasks-all'));
	assert.ok(ids.includes('saved:42'));
	assert.ok(ids.includes('user:1'));
	assert.equal(repository.get('saved:42').name, 'Alpha open');
	assert.equal(repository.get('missing'), undefined);
	assert.ok(repository.byTarget('note').every((item) => item.target === 'note'));
});
