import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { containerComponent } = await load(
	'../../src/dashboard/components/container.ts',
);
const { createComponentRegistry } = await load(
	'../../src/dashboard/components/index.ts',
);
const { coerceSettingValue } = await load(
	'../../src/dashboard/registry.ts',
);

const settingOf = (key) =>
	containerComponent.settings.find((setting) => setting.key === key);

test('the container component is queryless and accepts children', () => {
	assert.equal(containerComponent.type, 'container');
	assert.equal(containerComponent.queryless, true);
	assert.equal(containerComponent.acceptsChildren, true);
	assert.equal(containerComponent.defaultQueryId, '');
	assert.equal(containerComponent.toMetricRequest, undefined);
	assert.equal(containerComponent.toDatasetRequest, undefined);
});

test('the container is registered with the built-in components', () => {
	const definition = createComponentRegistry().get('container');
	assert.equal(definition?.type, 'container');
	assert.equal(definition?.acceptsChildren, true);
});

test('container createConfig starts empty with the default frame options', () => {
	assert.deepEqual(containerComponent.createConfig(''), {
		queryId: '',
		w: 6,
		h: 4,
		children: [],
		options: {
			columns: 12,
			density: 'standard',
			rowHeight: 56,
			gap: 8,
			padding: 8,
			borderWidth: 1,
			radius: 10,
		},
	});
});

test('container declares a title plus display and style settings', () => {
	const title = settingOf('title');
	assert.equal(title?.kind, 'text');
	assert.equal(title?.group, 'display');

	const columns = settingOf('columns');
	assert.equal(columns?.kind, 'number');
	assert.equal(columns?.target, 'options');
	assert.equal(columns?.min, 4);
	assert.equal(columns?.max, 24);
	assert.equal(columns?.fallback, 12);

	const rowHeight = settingOf('rowHeight');
	assert.equal(rowHeight?.kind, 'number');
	assert.equal(rowHeight?.target, 'options');
	assert.equal(rowHeight?.min, 40);
	assert.equal(rowHeight?.max, 120);
	assert.equal(rowHeight?.fallback, 56);

	for (const key of ['gap', 'padding', 'borderWidth', 'radius']) {
		const setting = settingOf(key);
		assert.equal(setting?.kind, 'number', key);
		assert.equal(setting?.group, 'style', key);
		assert.equal(setting?.target, 'options', key);
	}

	const borderColor = settingOf('borderColor');
	assert.equal(borderColor?.kind, 'color');
	assert.equal(borderColor?.group, 'style');
	assert.equal(borderColor?.target, 'options');
});

test('container size bounds allow any depth-1 arrangement', () => {
	assert.deepEqual(containerComponent.size, {
		minW: 2,
		minH: 1,
		maxH: 24,
	});
	const defaults = containerComponent.createConfig('');
	assert.ok(defaults.w >= containerComponent.size.minW);
	assert.ok(defaults.h >= containerComponent.size.minH);
	assert.ok((defaults.h ?? 0) <= containerComponent.size.maxH);
});

test('container render only paints the empty hint in edit mode', () => {
	const created = [];
	const el = {
		createDiv: (options) => {
			created.push(options);
			return options;
		},
	};
	const base = containerComponent.createConfig('');

	containerComponent.render(el, { config: base, editMode: false });
	assert.equal(created.length, 0);

	containerComponent.render(el, {
		config: {
			...base,
			children: [{ id: 'component:a', type: 'kpi', queryId: 'q' }],
		},
		editMode: true,
	});
	assert.equal(created.length, 0);

	containerComponent.render(el, { config: base, editMode: true });
	assert.equal(created.length, 1);
	assert.equal(created[0].cls, 'ioto-container-empty');
	assert.ok(created[0].text.length > 0);
});

test('container exposes a density preset that writes the layout numbers', () => {
	const density = settingOf('density');
	assert.equal(density?.kind, 'select');
	assert.equal(density?.group, 'display');
	assert.equal(density?.target, 'options');
	assert.equal(density?.fallback, 'standard');
	assert.deepEqual(
		density.options.map((option) => option.value),
		['standard', 'compact'],
	);
	assert.deepEqual(density.preset, {
		standard: { rowHeight: 56, gap: 8, padding: 8 },
		compact: { rowHeight: 48, gap: 4, padding: 4 },
	});
});

test('selecting a density merges its preset into the options patch', () => {
	const patch = coerceSettingValue(settingOf('density'), 'compact', new Set());
	assert.deepEqual(patch, {
		options: { density: 'compact', rowHeight: 48, gap: 4, padding: 4 },
	});
});
