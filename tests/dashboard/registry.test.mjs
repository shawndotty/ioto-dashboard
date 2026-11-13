import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	ComponentRegistry,
	clampSize,
	DEFAULT_SIZE_BOUNDS,
	boundsForSizeOverride,
	MIN_COMPONENT_W,
	MIN_COMPONENT_H,
	MAX_COMPONENT_W,
	MAX_COMPONENT_H,
} = await load('../../src/dashboard/registry.ts');

const { markdownComponent } = await load(
	'../../src/dashboard/components/markdown.ts',
);
const { containerComponent } = await load(
	'../../src/dashboard/components/container.ts',
);
const { buttonComponent } = await load(
	'../../src/dashboard/components/button.ts',
);

function definition(type) {
	return {
		type,
		labelKey: `${type}:name`,
		descriptionKey: `${type}:desc`,
		defaultQueryId: 'builtin:tasks-all',
		createConfig: () => ({ w: 3, h: 2 }),
		toMetricRequest: (config) => ({ kind: 'task-count', queryId: config.queryId }),
		isEmpty: () => false,
		render: () => {},
	};
}

test('clampSize applies defaults and clamps both dimensions', () => {
	assert.deepEqual(clampSize(undefined, undefined), { w: 3, h: 2 });
	assert.deepEqual(clampSize(1, 0), { w: MIN_COMPONENT_W, h: MIN_COMPONENT_H });
	assert.deepEqual(clampSize(99, 99), { w: MAX_COMPONENT_W, h: MAX_COMPONENT_H });
	assert.deepEqual(clampSize(6, 3), { w: 6, h: 3 });
});

test('clampSize honours custom bounds', () => {
	const kpiBounds = { ...DEFAULT_SIZE_BOUNDS, maxH: 6 };

	assert.deepEqual(clampSize(99, 99, kpiBounds), { w: MAX_COMPONENT_W, h: 6 });
	assert.deepEqual(clampSize(undefined, undefined, kpiBounds), { w: 3, h: 2 });
	assert.deepEqual(clampSize(4, 3, kpiBounds), { w: 4, h: 3 });
});

test('boundsForSizeOverride layers partial overrides on the defaults', () => {
	assert.deepEqual(boundsForSizeOverride(undefined), DEFAULT_SIZE_BOUNDS);
	assert.deepEqual(boundsForSizeOverride({ maxH: 8 }), {
		...DEFAULT_SIZE_BOUNDS,
		maxH: 8,
	});
});

test('queryless components share the utility category', () => {
	for (const component of [
		markdownComponent,
		containerComponent,
		buttonComponent,
	]) {
		assert.equal(component.category, 'utility');
	}
});

test('register / get / list keep insertion order', () => {
	const registry = new ComponentRegistry();
	registry.register(definition('kpi'));
	registry.register(definition('project-progress'));

	assert.deepEqual(
		registry.list().map((item) => item.type),
		['kpi', 'project-progress'],
	);
	assert.equal(registry.get('kpi').type, 'kpi');
	assert.equal(registry.get('missing'), undefined);
});

test('unknown component types render a placeholder instead of throwing', () => {
	const registry = new ComponentRegistry();
	const created = [];
	const el = {
		createDiv: (options) => {
			created.push(options);
			return options;
		},
	};

	registry.placeholder(el, 'mystery');

	assert.equal(created.length, 1);
	assert.equal(created[0].cls, 'ioto-dashboard-card-placeholder');
	assert.match(created[0].text, /mystery/);
});
