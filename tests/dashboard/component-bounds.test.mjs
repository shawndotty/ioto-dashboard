import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { createComponentRegistry } = await load('../../src/dashboard/components/index.ts');
const { boundsForType, DEFAULT_SIZE_BOUNDS } = await load('../../src/dashboard/registry.ts');

test('every component default size fits its own bounds', () => {
	const registry = createComponentRegistry();

	for (const definition of registry.list()) {
		const bounds = boundsForType(registry, definition.type);
		const defaults = definition.createConfig(definition.defaultQueryId);
		const label = `${definition.type} default ${defaults.w}x${defaults.h} vs ${JSON.stringify(bounds)}`;

		assert.ok(defaults.w >= bounds.minW, label);
		assert.ok(defaults.w <= bounds.maxW, label);
		assert.ok(defaults.h >= bounds.minH, label);
		assert.ok(defaults.h <= bounds.maxH, label);
	}
});

test('declared component caps never exceed the global hard cap', () => {
	const registry = createComponentRegistry();

	for (const definition of registry.list()) {
		const bounds = boundsForType(registry, definition.type);

		assert.ok(bounds.maxH <= DEFAULT_SIZE_BOUNDS.maxH, definition.type);
		assert.ok(bounds.maxW <= DEFAULT_SIZE_BOUNDS.maxW, definition.type);
	}
});

test('unknown component types fall back to the global bounds', () => {
	const registry = createComponentRegistry();

	assert.deepEqual(boundsForType(registry, 'missing-type'), DEFAULT_SIZE_BOUNDS);
});

test('built-in components resolve the expected height caps', () => {
	const registry = createComponentRegistry();

	assert.equal(boundsForType(registry, 'kpi').maxH, 6);
	assert.equal(boundsForType(registry, 'project-progress').maxH, DEFAULT_SIZE_BOUNDS.maxH);
	assert.equal(boundsForType(registry, 'task-list').maxH, 24);
	assert.equal(boundsForType(registry, 'note-list').maxH, 24);
});
