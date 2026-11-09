import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { DashboardInspectorService, resolveInspectorHost } = await load(
	'../../src/dashboard/inspector-service.ts',
);

function makeTarget(overrides = {}) {
	return {
		pageName: 'Page 1',
		index: 0,
		total: 1,
		config: { id: 'component:1', type: 'kpi', queryId: 'builtin:tasks-all' },
		definition: undefined,
		bounds: { minW: 2, maxW: 12, minH: 1, maxH: 6 },
		defaults: { w: 3, h: 2 },
		...overrides,
	};
}

function makeController(overrides = {}) {
	const controller = {
		leafId: 'canvas:a',
		target: makeTarget(),
		editable: true,
		queries: [],
		version: 0,
		patches: [],
		isEditable() {
			return controller.editable;
		},
		getTarget() {
			return controller.target;
		},
		listQueries() {
			return controller.queries;
		},
		queriesVersion() {
			return controller.version;
		},
		patch(patch) {
			controller.patches.push(patch);
		},
		stepSize() {},
		resetSize() {},
		move() {},
		remove() {},
	};
	return Object.assign(controller, overrides);
}

function selection(overrides = {}) {
	return { leafId: 'canvas:a', pageId: 'page:1', componentId: 'component:1', ...overrides };
}

test('select stores the selection/controller and notifies listeners', () => {
	const service = new DashboardInspectorService();
	const controller = makeController();
	let notified = 0;
	service.subscribe(() => notified++);

	service.select(selection(), controller);

	assert.equal(notified, 1);
	assert.deepEqual(service.current(), {
		selection: selection(),
		controller,
	});
});

test('the last selection wins, including its pending focus', () => {
	const service = new DashboardInspectorService();
	const first = makeController({ leafId: 'canvas:a' });
	const second = makeController({ leafId: 'canvas:b' });

	service.select(selection({ componentId: 'component:1' }), first, { focus: 'title' });
	service.select(selection({ leafId: 'canvas:b', componentId: 'component:2' }), second);

	const current = service.current();
	assert.equal(current.controller, second);
	assert.equal(current.selection.componentId, 'component:2');
	assert.equal(service.consumeFocus(), null);
});

test('consumeFocus hands out the pending focus exactly once', () => {
	const service = new DashboardInspectorService();
	service.select(selection(), makeController(), { focus: 'first' });

	assert.equal(service.consumeFocus(), 'first');
	assert.equal(service.consumeFocus(), null);
});

test('refresh re-notifies while the target exists and keeps the selection', () => {
	const service = new DashboardInspectorService();
	const controller = makeController();
	service.select(selection(), controller);
	let notified = 0;
	service.subscribe(() => notified++);

	service.refresh();

	assert.equal(notified, 1);
	assert.equal(service.current().controller, controller);
});

test('refresh drops the selection when the controller lost its target', () => {
	const service = new DashboardInspectorService();
	const controller = makeController();
	service.select(selection(), controller);
	controller.target = null;
	let notified = 0;
	service.subscribe(() => notified++);

	service.refresh();

	assert.equal(notified, 1);
	assert.equal(service.current(), null);
});

test('clear(leafId) only clears the matching canvas selection', () => {
	const service = new DashboardInspectorService();
	service.select(selection(), makeController());
	let notified = 0;
	service.subscribe(() => notified++);

	service.clear('canvas:other');
	assert.equal(notified, 0);
	assert.ok(service.current());

	service.clear('canvas:a');
	assert.equal(notified, 1);
	assert.equal(service.current(), null);
});

test('clear() without args clears everything and notifies even if already empty', () => {
	const service = new DashboardInspectorService();
	service.select(selection(), makeController());
	let notified = 0;
	service.subscribe(() => notified++);

	service.clear();
	assert.equal(notified, 1);
	assert.equal(service.current(), null);

	service.clear();
	assert.equal(notified, 2);
});

test('unsubscribe stops notifications', () => {
	const service = new DashboardInspectorService();
	let notified = 0;
	const off = service.subscribe(() => notified++);

	service.select(selection(), makeController());
	off();
	service.clear();
	service.select(selection(), makeController());

	assert.equal(notified, 1);
});

test('snapshot builds the inspector state from the controller', () => {
	const service = new DashboardInspectorService();
	const queries = [{ id: 'user:1', name: 'Mine' }];
	const controller = makeController({
		editable: false,
		queries,
		version: 7,
	});

	assert.equal(service.snapshot(), null);

	service.select(selection(), controller);
	assert.deepEqual(service.snapshot(), {
		editable: false,
		target: makeTarget(),
		queries,
		queriesVersion: 7,
	});
});

test('snapshot is null when the controller no longer resolves a target', () => {
	const service = new DashboardInspectorService();
	const controller = makeController();
	service.select(selection(), controller);

	controller.target = null;

	assert.equal(service.snapshot(), null);
});

test('resolveInspectorHost: auto follows the platform, explicit values win', () => {
	assert.equal(resolveInspectorHost('auto', false), 'sidebar');
	assert.equal(resolveInspectorHost('auto', true), 'inline');
	assert.equal(resolveInspectorHost('sidebar', true), 'sidebar');
	assert.equal(resolveInspectorHost('inline', false), 'inline');
});
