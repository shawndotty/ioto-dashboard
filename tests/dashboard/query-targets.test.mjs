import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { queryTargetsFor } = await load('../../src/dashboard/registry.ts');
const { QUERY_TARGETS } = await load('../../src/query/types.ts');
const { kpiComponent } = await load('../../src/dashboard/components/kpi.ts');
const { taskListComponent } = await load(
	'../../src/dashboard/components/task-list.ts',
);
const { noteListComponent } = await load(
	'../../src/dashboard/components/note-list.ts',
);
const { lineChartComponent } = await load(
	'../../src/dashboard/components/line-chart.ts',
);
const { barChartComponent } = await load(
	'../../src/dashboard/components/bar-chart.ts',
);
const { pieChartComponent, donutChartComponent } = await load(
	'../../src/dashboard/components/pie-chart.ts',
);
const { scatterChartComponent } = await load(
	'../../src/dashboard/components/scatter-chart.ts',
);
const { projectProgressComponent } = await load(
	'../../src/dashboard/components/project-progress.ts',
);
const { tableComponent } = await load('../../src/dashboard/components/table.ts');

function definition(fields) {
	return {
		type: 'test',
		labelKey: 'TEST_NAME',
		descriptionKey: 'TEST_DESC',
		defaultQueryId: 'builtin:tasks-all',
		createConfig: () => ({}),
		isEmpty: () => false,
		render: () => {},
		...fields,
	};
}

test('registration components declare explicit query targets', () => {
	assert.deepEqual(queryTargetsFor(taskListComponent), ['task']);
	assert.deepEqual(queryTargetsFor(noteListComponent), ['note']);
	assert.deepEqual(queryTargetsFor(lineChartComponent), [
		'task',
		'note',
		'file',
	]);
	assert.deepEqual(queryTargetsFor(barChartComponent), [
		'task',
		'note',
		'file',
		'folder',
	]);
	assert.deepEqual(queryTargetsFor(pieChartComponent), [
		'task',
		'note',
		'file',
		'folder',
	]);
	assert.deepEqual(queryTargetsFor(donutChartComponent), [
		'task',
		'note',
		'file',
		'folder',
	]);
	assert.deepEqual(queryTargetsFor(scatterChartComponent), [
		'task',
		'note',
		'folder',
	]);
	assert.deepEqual(queryTargetsFor(projectProgressComponent), ['task']);
	assert.deepEqual(queryTargetsFor(kpiComponent), [
		'task',
		'note',
		'file',
		'folder',
	]);
	assert.deepEqual(queryTargetsFor(tableComponent), [
		'task',
		'note',
		'file',
		'folder',
	]);
});

test('queryTargetsFor falls back to objects when nothing explicit', () => {
	assert.deepEqual(
		queryTargetsFor(definition({ objects: ['project'] })),
		['task', 'note'],
	);
	assert.deepEqual(
		queryTargetsFor(definition({ objects: ['file'] })),
		['file'],
	);
	assert.deepEqual(queryTargetsFor(definition({})), []);
});

test('queryTargetsFor returns targets in QUERY_TARGETS order', () => {
	const targets = queryTargetsFor(
		definition({ queryTargets: ['folder', 'task', 'file'] }),
	);

	assert.deepEqual(targets, ['task', 'file', 'folder']);
	assert.deepEqual(
		targets,
		QUERY_TARGETS.filter((target) => targets.includes(target)),
	);
});

test('explicit queryTargets wins over objects', () => {
	const targets = queryTargetsFor(
		definition({ objects: ['project'], queryTargets: ['file'] }),
	);

	assert.deepEqual(targets, ['file']);
});

test('queryTargetsFor returns a copy, not the declared array', () => {
	const declared = ['task'];
	const targets = queryTargetsFor(definition({ queryTargets: declared }));

	targets.push('note');
	assert.deepEqual(declared, ['task']);
});
