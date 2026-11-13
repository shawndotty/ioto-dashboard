import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { createComponentRegistry } = await load('../../src/dashboard/components/index.ts');

test('every component declares a picker icon', () => {
	for (const definition of createComponentRegistry().list()) {
		assert.ok(definition.icon, `${definition.type} is missing icon`);
	}
});

test('picker icons are unique across components', () => {
	const icons = createComponentRegistry().list().map((definition) => definition.icon);
	assert.equal(new Set(icons).size, icons.length, `duplicate icons: ${icons.join(', ')}`);
});

test('pie and donut use distinct icons', () => {
	const registry = createComponentRegistry();
	assert.equal(registry.get('pie-chart').icon, 'pie-chart');
	assert.equal(registry.get('donut-chart').icon, 'circle-dot');
});
