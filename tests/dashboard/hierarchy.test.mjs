import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	MAX_CONTAINER_DEPTH,
	walkComponents,
	findComponentLocation,
	collectComponentIds,
	cloneWithFreshIds,
	containsComponent,
} = await load('../../src/dashboard/hierarchy.ts');

function kpi(id, overrides = {}) {
	return { id, type: 'kpi', queryId: 'builtin:tasks-all', ...overrides };
}

function container(id, children = []) {
	return { id, type: 'container', queryId: '', children };
}

test('walkComponents lists parents before children and stops at the depth cap', () => {
	const nestedTooDeep = container('component:deep', [kpi('component:grandchild')]);
	const tree = [
		container('component:box', [kpi('component:a'), kpi('component:b')]),
		kpi('component:c'),
		container('component:other', [nestedTooDeep]),
	];

	const locations = walkComponents(tree);

	assert.equal(MAX_CONTAINER_DEPTH, 1);
	assert.deepEqual(
		locations.map((location) => `${location.depth}:${location.config.id}`),
		[
			'0:component:box',
			'1:component:a',
			'1:component:b',
			'0:component:c',
			'0:component:other',
			// `nestedTooDeep` is a child (depth 1); its own children are not walked.
			'1:component:deep',
		],
	);
});

test('findComponentLocation reports parent, siblings, index and depth', () => {
	const first = kpi('component:a');
	const second = kpi('component:b');
	const box = container('component:box', [first, second]);
	const tree = [box, kpi('component:c')];

	const child = findComponentLocation(tree, 'component:b');
	assert.ok(child);
	assert.equal(child.config, second);
	assert.equal(child.parent, box);
	assert.equal(child.depth, 1);
	assert.equal(child.index, 1);
	assert.deepEqual(child.siblings, [first, second]);

	const top = findComponentLocation(tree, 'component:c');
	assert.ok(top);
	assert.equal(top.parent, null);
	assert.equal(top.depth, 0);
	assert.equal(top.index, 1);
	assert.equal(findComponentLocation(tree, 'missing'), null);
});

test('collectComponentIds returns unique ids across the tree', () => {
	const tree = [
		container('component:box', [kpi('component:dup'), kpi('component:a')]),
		kpi('component:dup'),
	];

	assert.deepEqual(collectComponentIds(tree), [
		'component:box',
		'component:dup',
		'component:a',
	]);
});

test('cloneWithFreshIds replaces every descendant id and keeps structure', () => {
	const source = container('component:box', [
		kpi('component:a', { options: { showRowNumber: true } }),
		container('component:inner', [kpi('component:c')]),
	]);
	let counter = 0;
	const copy = cloneWithFreshIds(source, () => `fresh:${++counter}`);

	assert.equal(copy.id, 'fresh:1');
	assert.equal(copy.type, 'container');
	assert.deepEqual(
		copy.children.map((child) => child.id),
		['fresh:2', 'fresh:3'],
	);
	assert.equal(copy.children[0].options.showRowNumber, true);
	// The inner container is at depth 1, so its own children are dropped.
	assert.equal(copy.children[1].children, undefined);
	assert.equal(copy.children[0].id, 'fresh:2');
	assert.notEqual(copy.children[0], source.children[0]);
});

test('containsComponent detects self, children and unrelated ids', () => {
	const child = kpi('component:a');
	const box = container('component:box', [child]);
	const other = container('component:other', [kpi('component:z')]);

	assert.equal(containsComponent(box, 'component:box'), true);
	assert.equal(containsComponent(box, 'component:a'), true);
	assert.equal(containsComponent(box, 'component:other'), false);
	assert.equal(containsComponent(box, 'component:z'), false);
	assert.equal(containsComponent(child, 'component:a'), true);
	assert.equal(containsComponent(other, 'component:a'), false);
});
