import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { DashboardInspectorService, resolveInspectorHost } = await load(
	'../../src/dashboard/inspector-service.ts',
);

function makeTarget(overrides = {}) {
	return {
		kind: 'component',
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

function makePageTarget(overrides = {}) {
	return {
		kind: 'page',
		pageId: 'page:1',
		pageName: 'Page 1',
		dashboardName: 'Dashboard 1',
		index: 0,
		total: 2,
		componentCount: 3,
		columns: 12,
		rowHeight: 72,
		canDelete: true,
		...overrides,
	};
}

function makeController(overrides = {}) {
	const controller = {
		kind: 'component',
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
		openPageSettings() {},
	};
	return Object.assign(controller, overrides);
}

function makePageController(overrides = {}) {
	const controller = {
		kind: 'page',
		leafId: 'canvas:a',
		target: makePageTarget(),
		editable: true,
		renamed: null,
		layout: null,
		removed: false,
		isEditable() {
			return controller.editable;
		},
		getTarget() {
			return controller.target;
		},
		renamePage(name) {
			controller.renamed = name;
		},
		setPageLayout(columns, rowHeight) {
			controller.layout = [columns, rowHeight];
		},
		removePage() {
			controller.removed = true;
		},
	};
	return Object.assign(controller, overrides);
}

function selection(overrides = {}) {
	return { kind: 'component', leafId: 'canvas:a', pageId: 'page:1', componentId: 'component:1', ...overrides };
}

function pageSelection(overrides = {}) {
	return { kind: 'page', leafId: 'canvas:a', pageId: 'page:1', ...overrides };
}

function makePagesTarget(overrides = {}) {
	return {
		kind: 'pages',
		dashboardId: 'dashboard:1',
		dashboardName: 'Dashboard 1',
		activePageId: 'page:1',
		pages: [
			{ id: 'page:1', name: 'Page 1', componentCount: 2, isActive: true, canDelete: true },
			{ id: 'page:2', name: 'Page 2', componentCount: 0, isActive: false, canDelete: true },
		],
		...overrides,
	};
}

function makePagesController(overrides = {}) {
	const controller = {
		kind: 'pages',
		leafId: 'canvas:a',
		target: makePagesTarget(),
		editable: true,
		moved: [],
		isEditable() {
			return controller.editable;
		},
		getTarget() {
			return controller.target;
		},
		switchPage() {},
		createPage() {},
		duplicatePage() {},
		renamePage() {},
		removePage() {},
		movePage(id, target) {
			controller.moved.push([id, target]);
		},
	};
	return Object.assign(controller, overrides);
}

function pagesSelection(overrides = {}) {
	return { kind: 'pages', leafId: 'canvas:a', dashboardId: 'dashboard:1', ...overrides };
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
		kind: 'component',
		editable: false,
		target: makeTarget(),
		queries,
		queriesVersion: 7,
	});
});

test('snapshot carries the page target without query fields', () => {
	const service = new DashboardInspectorService();
	const controller = makePageController({ editable: false });
	service.select(pageSelection(), controller);

	const snapshot = service.snapshot();
	assert.deepEqual(snapshot, {
		kind: 'page',
		editable: false,
		target: makePageTarget(),
	});
	assert.equal('queries' in snapshot, false);
	assert.equal('queriesVersion' in snapshot, false);
});

test('page selections are cleared per leaf and refresh drops stale pages', () => {
	const service = new DashboardInspectorService();
	const controller = makePageController();
	service.select(pageSelection(), controller);
	let notified = 0;
	service.subscribe(() => notified++);

	service.clear('canvas:other');
	assert.ok(service.current());

	service.clear('canvas:a');
	assert.equal(service.current(), null);

	controller.target = null;
	service.select(pageSelection(), controller, { focus: 'name' });
	assert.equal(service.consumeFocus(), 'name');
	service.refresh();
	assert.equal(service.current(), null);
});

test('the last selection wins across component and page kinds', () => {
	const service = new DashboardInspectorService();
	const component = makeController();
	const page = makePageController();

	service.select(selection(), component);
	service.select(pageSelection(), page, { focus: 'layout' });

	assert.equal(service.current().controller, page);
	assert.equal(service.current().selection.kind, 'page');
	assert.equal(service.consumeFocus(), 'layout');

	service.select(selection(), component);
	assert.equal(service.current().selection.kind, 'component');
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

test('snapshot builds the pages state and carries the editable flag', () => {
	const service = new DashboardInspectorService();
	const controller = makePagesController({ editable: false });
	service.select(pagesSelection(), controller);

	const snapshot = service.snapshot();
	assert.deepEqual(snapshot, {
		kind: 'pages',
		editable: false,
		target: makePagesTarget(),
	});
	assert.equal('queries' in snapshot, false);
	assert.equal('focus' in snapshot, false);
});

test('pages selections are cleared per leaf and dropped when the target vanishes', () => {
	const service = new DashboardInspectorService();
	const controller = makePagesController();
	service.select(pagesSelection(), controller);
	let notified = 0;
	service.subscribe(() => notified++);

	service.clear('canvas:other');
	assert.ok(service.current());

	service.clear('canvas:a');
	assert.equal(service.current(), null);
	assert.equal(notified, 1);

	controller.target = null;
	service.select(pagesSelection(), controller);
	assert.equal(service.snapshot(), null);
	service.refresh();
	assert.equal(service.current(), null);
});

test('the last selection wins across component, page and pages kinds', () => {
	const service = new DashboardInspectorService();
	const component = makeController();
	const page = makePageController();
	const pages = makePagesController();

	service.select(selection(), component);
	service.select(pageSelection(), page);
	service.select(pagesSelection(), pages, { focus: 'name' });

	assert.equal(service.current().controller, pages);
	assert.equal(service.current().selection.kind, 'pages');
	assert.equal(service.consumeFocus(), 'name');

	service.select(selection(), component);
	assert.equal(service.current().selection.kind, 'component');

	service.select(pagesSelection(), pages);
	assert.equal(service.current().selection.kind, 'pages');
});
