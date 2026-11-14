import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	BUNDLE_FORMAT_VERSION,
	buildPageBundle,
	buildDashboardBundle,
	buildQueryBundle,
	buildBackupBundle,
	serializeBundle,
	parseBundle,
	planImport,
	hasImportErrors,
	mergeCustomFilters,
} = await load('../../src/dashboard/bundle.ts');

const ROOTS = {
	inputFolder: '1-输入',
	outputFolder: '2-输出',
	taskFolder: '3-任务',
	outcomeFolder: '4-成果',
};

function component(overrides = {}) {
	return {
		id: 'component:1',
		type: 'task-list',
		queryId: 'builtin:tasks-all',
		basis: 'file',
		w: 6,
		h: 4,
		...overrides,
	};
}

function page(overrides = {}) {
	return { id: 'page:1', name: 'Page 1', components: [], ...overrides };
}

function store(overrides = {}) {
	return {
		schemaVersion: 7,
		dashboards: [
			{
				id: 'dashboard:1',
				name: 'Main',
				pages: [page({ components: [component()] })],
			},
		],
		queries: [],
		activeDashboardId: 'dashboard:1',
		activePageId: 'page:1',
		...overrides,
	};
}

function context(overrides = {}) {
	return {
		store: store(),
		settings: {
			roots: { ...ROOTS },
			customFilters: [{ name: 'status', type: 'text', target: 'all' }],
			savedQueries: [
				{
					id: 'sq1',
					name: 'Saved notes',
					category: 'Input',
					tab: 'Notes',
					filters: {},
				},
			],
		},
		pluginVersion: '9.9.9',
		now: 1000,
		...overrides,
	};
}

function userQuery(overrides = {}) {
	return {
		id: 'user:1',
		name: 'My task query',
		target: 'task',
		scope: { folders: ['3-任务/x'], includeSubfolders: true },
		filters: {},
		...overrides,
	};
}

function roundtrip(result) {
	const parsed = parseBundle(result.json);
	assert.equal(parsed.ok, true);
	return parsed.envelope;
}

test('buildPageBundle returns null for unknown page', () => {
	assert.equal(buildPageBundle(context(), 'dashboard:1', 'page:missing'), null);
});

test('buildPageBundle includes descendants and stamps the envelope', () => {
	const child = page({
		id: 'page:2',
		name: 'Child',
		parentId: 'page:1',
		components: [component({ id: 'component:2' })],
	});
	const ctx = context();
	ctx.store.dashboards[0].pages.push(child);

	const result = buildPageBundle(ctx, 'dashboard:1', 'page:1');
	assert.ok(result);
	const envelope = result.envelope;
	assert.equal(envelope.kind, 'ioto-dashboard-page');
	assert.equal(envelope.formatVersion, BUNDLE_FORMAT_VERSION);
	assert.equal(envelope.pluginVersion, '9.9.9');
	assert.deepEqual(
		envelope.payload.pages.map((item) => item.id),
		['page:1', 'page:2'],
	);
	assert.deepEqual(envelope.source.roots, ROOTS);
	assert.equal(envelope.exportedAt, new Date(1000).toISOString());
});

test('buildPageBundle materialises a saved query as a user snapshot', () => {
	const ctx = context();
	ctx.store.dashboards[0].pages[0].components = [
		component({ queryId: 'saved:sq1' }),
	];

	const envelope = buildPageBundle(ctx, 'dashboard:1', 'page:1').envelope;
	assert.equal(envelope.payload.queries.length, 1);
	const snapshot = envelope.payload.queries[0];
	assert.equal(snapshot.id, 'user:sq1');
	assert.ok(snapshot.name.includes('Saved notes'));
	assert.deepEqual(snapshot.scope.folders, ['1-输入']);
});

test('buildPageBundle collects custom filters used by its queries', () => {
	const ctx = context();
	ctx.store.queries = [
		userQuery({ filters: { custom: { status: 'done' } } }),
	];
	ctx.store.dashboards[0].pages[0].components = [
		component({ queryId: 'user:1' }),
	];

	const envelope = buildPageBundle(ctx, 'dashboard:1', 'page:1').envelope;
	assert.deepEqual(envelope.payload.customFilters, [
		{ name: 'status', type: 'text', target: 'all' },
	]);
});

test('buildDashboardBundle / buildQueryBundle / buildBackupBundle kinds', () => {
	const ctx = context();
	ctx.store.queries = [userQuery()];

	assert.equal(
		buildDashboardBundle(ctx, 'dashboard:1').envelope.kind,
		'ioto-dashboard',
	);
	assert.equal(
		buildDashboardBundle(ctx, 'dashboard:missing'),
		null,
	);
	assert.equal(
		buildQueryBundle(ctx, 'user:1').envelope.kind,
		'ioto-dashboard-query',
	);
	assert.equal(buildQueryBundle(ctx, 'user:missing'), null);
	const backup = buildBackupBundle(ctx).envelope;
	assert.equal(backup.kind, 'ioto-dashboard-backup');
	assert.equal(backup.payload.dashboards.length, 1);
	assert.equal(backup.payload.queries.length, 1);
});

test('parseBundle rejects malformed input with stable codes', () => {
	assert.equal(parseBundle('not json').error.code, 'invalid-json');
	assert.equal(parseBundle('[]').error.code, 'invalid-json');
	assert.equal(
		parseBundle(JSON.stringify({ kind: 'nope', formatVersion: 1 })).error
			.code,
		'unknown-kind',
	);
	assert.equal(
		parseBundle(
			JSON.stringify({ kind: 'ioto-dashboard-page', formatVersion: 2 }),
		).error.code,
		'unsupported-version',
	);
	assert.equal(
		parseBundle(
			JSON.stringify({
				kind: 'ioto-dashboard-page',
				formatVersion: 1,
				payload: null,
			}),
		).error.code,
		'invalid-payload',
	);
});

test('serializeBundle round-trips through parseBundle', () => {
	const ctx = context();
	const parsed = parseBundle(serializeBundle(buildBackupBundle(ctx).envelope));
	assert.equal(parsed.ok, true);
	assert.equal(parsed.envelope.kind, 'ioto-dashboard-backup');
});

test('planImport appends a page with fresh ids and deduped names', () => {
	const ctx = context();
	ctx.store.queries = [userQuery()];
	ctx.store.dashboards[0].pages[0].components = [
		component({ queryId: 'user:1' }),
	];
	const envelope = roundtrip(buildPageBundle(ctx, 'dashboard:1', 'page:1'));

	const plan = planImport(envelope, {
		store: ctx.store,
		settings: ctx.settings,
		now: 5000,
	});
	assert.equal(plan.mode, 'append');
	assert.equal(plan.targetDashboardId, 'dashboard:1');
	assert.equal(plan.pages.length, 1);
	const imported = plan.pages[0];
	assert.notEqual(imported.id, 'page:1');
	assert.equal(imported.name, 'Page 1 (import)');
	assert.notEqual(imported.components[0].id, 'component:1');

	assert.equal(plan.queries.length, 1);
	const newQueryId = plan.queries[0].id;
	assert.ok(newQueryId.startsWith('user:import-5000-'));
	assert.equal(imported.components[0].queryId, newQueryId);
	assert.equal(plan.queryIdMap['user:1'], newQueryId);
	assert.deepEqual(plan.createdPageIds, [imported.id]);
	assert.equal(hasImportErrors(plan), false);
});

test('planImport rewrites folders between source and target roots', () => {
	const ctx = context();
	ctx.store.queries = [userQuery()];
	ctx.store.dashboards[0].pages[0].components = [
		component({ queryId: 'user:1' }),
	];
	const envelope = roundtrip(buildPageBundle(ctx, 'dashboard:1', 'page:1'));

	const plan = planImport(envelope, {
		store: ctx.store,
		settings: {
			...ctx.settings,
			roots: { ...ROOTS, taskFolder: 'X-Tasks' },
		},
		now: 5000,
	});
	assert.deepEqual(plan.queries[0].scope.folders, ['X-Tasks/x']);
	assert.ok(
		plan.warnings.some((item) => item.code === 'path.rewritten'),
	);
});

test('planImport rewrites button targets and reparents orphan pages', () => {
	const ctx = context();
	const root = page({
		id: 'page:1',
		name: 'Root',
		components: [
			component({
				id: 'component:1',
				type: 'button',
				queryId: '',
				options: { actionType: 'page', pageId: 'page:2' },
			}),
		],
	});
	const child = page({
		id: 'page:2',
		name: 'Child',
		parentId: 'page:1',
	});
	const orphan = page({ id: 'page:3', name: 'Orphan', parentId: 'page:outside' });
	const envelope = parseBundle(
		serializeBundle({
			kind: 'ioto-dashboard-page',
			formatVersion: 1,
			pluginVersion: '',
			storeSchemaVersion: 7,
			exportedAt: new Date(0).toISOString(),
			payload: { pages: [root, child, orphan], queries: [] },
			warnings: [],
		}),
	).envelope;

	const plan = planImport(envelope, {
		store: store({
			dashboards: [
				{
					id: 'dashboard:1',
					name: 'Dest',
					pages: [{ id: 'page:dest', name: 'Dest page', components: [] }],
				},
			],
		}),
		settings: ctx.settings,
		now: 5000,
	});
	const byName = Object.fromEntries(plan.pages.map((item) => [item.name, item]));
	assert.equal(
		byName.Root.components[0].options.pageId,
		byName.Child.id,
	);
	assert.equal(byName.Child.parentId, byName.Root.id);
	assert.equal(byName.Orphan.parentId, undefined);
	assert.ok(
		plan.warnings.some((item) => item.code === 'page.parent-outside'),
	);
});

test('planImport reports an error when the target dashboard is gone', () => {
	const envelope = roundtrip(
		buildPageBundle(context(), 'dashboard:1', 'page:1'),
	);
	const plan = planImport(envelope, {
		store: store(),
		settings: context().settings,
		targetDashboardId: 'dashboard:missing',
	});
	assert.equal(plan.pages.length, 0);
	assert.equal(hasImportErrors(plan), true);
	assert.equal(
		plan.warnings.find((item) => item.level === 'error').code,
		'page.target-missing',
	);
});

test('planImport adds a dashboard copy with its own id', () => {
	const envelope = roundtrip(
		buildDashboardBundle(context(), 'dashboard:1'),
	);
	const plan = planImport(envelope, {
		store: store(),
		settings: context().settings,
		now: 5000,
	});
	assert.equal(plan.dashboards.length, 1);
	assert.notEqual(plan.dashboards[0].id, 'dashboard:1');
	assert.equal(plan.dashboards[0].name, 'Main (import)');
	assert.equal(plan.dashboards[0].pages.length, 1);
});

test('planImport turns a backup into a replace plan that keeps ids', () => {
	const ctx = context();
	ctx.store.queries = [userQuery()];
	const envelope = roundtrip(buildBackupBundle(ctx));

	const plan = planImport(envelope, {
		store: store({ dashboards: [] }),
		settings: ctx.settings,
	});
	assert.equal(plan.kind, 'ioto-dashboard-backup');
	assert.equal(plan.mode, 'replace');
	assert.equal(plan.dashboards[0].id, 'dashboard:1');
	assert.equal(plan.queries[0].id, 'user:1');
	assert.equal(plan.customFilters.length, 0);
});

test('mergeCustomFilters keeps existing definitions', () => {
	const plan = {
		customFilters: [
			{ name: 'status', type: 'number', target: 'all' },
			{ name: 'owner', type: 'text', target: 'note' },
		],
	};
	const merged = mergeCustomFilters(plan, [
		{ name: 'status', type: 'text', target: 'all' },
	]);
	assert.deepEqual(merged, [
		{ name: 'status', type: 'text', target: 'all' },
		{ name: 'owner', type: 'text', target: 'note' },
	]);
});
