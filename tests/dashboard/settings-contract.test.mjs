import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { coerceSettingValue } = await load('../../src/dashboard/registry.ts');
const { kpiComponent } = await load('../../src/dashboard/components/kpi.ts');
const { projectProgressComponent } = await load(
	'../../src/dashboard/components/project-progress.ts',
);
const { taskListComponent } = await load(
	'../../src/dashboard/components/task-list.ts',
);
const { noteListComponent } = await load(
	'../../src/dashboard/components/note-list.ts',
);
const { tableComponent } = await load('../../src/dashboard/components/table.ts');
const { lineChartComponent } = await load(
	'../../src/dashboard/components/line-chart.ts',
);
const { barChartComponent } = await load(
	'../../src/dashboard/components/bar-chart.ts',
);

const COMPONENTS = [
	kpiComponent,
	projectProgressComponent,
	taskListComponent,
	noteListComponent,
	tableComponent,
	lineChartComponent,
	barChartComponent,
];
const CONFIG_KEYS = new Set(['id', 'type', 'queryId', 'basis', 'limit', 'title', 'view', 'measure', 'options', 'x', 'y', 'w', 'h']);
const QUERY_IDS = new Set(['builtin:tasks-all', 'builtin:tasks-unfinished', 'user:1']);

test('every component declares settings whose keys are valid config fields', () => {
	for (const component of COMPONENTS) {
		assert.ok(Array.isArray(component.settings) && component.settings.length > 0, `${component.type} needs settings`);
		assert.equal(component.settings[0].kind, 'query', `${component.type} should lead with the query`);
		const keys = component.settings.map((setting) => setting.key);
		assert.equal(new Set(keys).size, keys.length, `${component.type} has duplicate setting keys`);
		for (const setting of component.settings) {
			if (setting.target === 'options') continue;
			assert.ok(
				CONFIG_KEYS.has(setting.key),
				`${component.type}.${setting.key} is not a DashboardComponentConfig key`,
			);
		}
		assert.ok(keys.includes('title'), `${component.type} should expose the title setting`);
	}
});

test('setting fallbacks match the values createConfig writes', () => {
	for (const component of COMPONENTS) {
		const created = component.createConfig(component.defaultQueryId);
		for (const setting of component.settings) {
			if (setting.kind === 'basis') {
				assert.equal(created.basis, setting.fallback, `${component.type} basis fallback`);
			}
			if (setting.kind === 'number') {
				if (setting.target === 'options') {
					const stored = created.options?.[setting.key];
					// yMin / yMax intentionally start empty until manual scale is chosen.
					if (setting.key === 'yMin' || setting.key === 'yMax') {
						assert.equal(stored, undefined, `${component.type} ${setting.key} starts empty`);
					} else {
						assert.equal(stored, setting.fallback, `${component.type} ${setting.key} fallback`);
					}
				} else {
					assert.equal(created[setting.key], setting.fallback, `${component.type} ${setting.key} fallback`);
				}
			}
			if (setting.kind === 'select') {
				const stored =
					setting.target === 'options'
						? created.options?.[setting.key]
						: created[setting.key];
				assert.equal(stored, setting.fallback, `${component.type} ${setting.key} fallback`);
			}
			if (setting.kind === 'toggle') {
				const stored =
					setting.target === 'options'
						? created.options?.[setting.key]
						: created[setting.key];
				assert.equal(stored, setting.fallback, `${component.type} ${setting.key} fallback`);
			}
			if (setting.kind === 'field') {
				const stored =
					setting.target === 'options'
						? created.options?.[setting.key]
						: created[setting.key];
				assert.equal(stored, setting.fallback, `${component.type} ${setting.key} fallback`);
			}
		}
	}
});

test('number settings declare sane min/max/step bounds', () => {
	for (const component of COMPONENTS) {
		for (const setting of component.settings) {
			if (setting.kind !== 'number') continue;
			assert.ok(setting.min < setting.max, `${component.type} ${setting.key} needs min < max`);
			assert.ok(
				setting.fallback >= setting.min && setting.fallback <= setting.max,
				`${component.type} ${setting.key} fallback must sit inside the bounds`,
			);
			if (setting.target !== 'options') {
				assert.equal(setting.max, 100, `${component.type} ${setting.key} max should stay 100`);
			}
		}
	}
});

test('the query setting only accepts known query ids', () => {
	const setting = { key: 'queryId', kind: 'query', group: 'data' };
	assert.deepEqual(coerceSettingValue(setting, 'user:1', QUERY_IDS), { queryId: 'user:1' });
	assert.deepEqual(coerceSettingValue(setting, 'user:missing', QUERY_IDS), {});
	assert.deepEqual(coerceSettingValue(setting, 42, QUERY_IDS), {});
	assert.deepEqual(coerceSettingValue(setting, undefined, QUERY_IDS), {});
});

test('the basis setting only accepts file/section', () => {
	const setting = { key: 'basis', kind: 'basis', group: 'data', fallback: 'file' };
	assert.deepEqual(coerceSettingValue(setting, 'section', QUERY_IDS), { basis: 'section' });
	assert.deepEqual(coerceSettingValue(setting, 'file', QUERY_IDS), { basis: 'file' });
	assert.deepEqual(coerceSettingValue(setting, 'everything', QUERY_IDS), {});
	assert.deepEqual(coerceSettingValue(setting, null, QUERY_IDS), {});
});

test('the number setting parses, rounds and clamps, rejecting blanks', () => {
	const setting = { key: 'limit', kind: 'number', group: 'data', min: 1, max: 100, step: 1, fallback: 20 };
	assert.deepEqual(coerceSettingValue(setting, 12, QUERY_IDS), { limit: 12 });
	assert.deepEqual(coerceSettingValue(setting, '12.6', QUERY_IDS), { limit: 13 });
	assert.deepEqual(coerceSettingValue(setting, 0, QUERY_IDS), { limit: 1 });
	assert.deepEqual(coerceSettingValue(setting, 999, QUERY_IDS), { limit: 100 });
	assert.deepEqual(coerceSettingValue(setting, '  ', QUERY_IDS), {});
	assert.deepEqual(coerceSettingValue(setting, '', QUERY_IDS), {});
	assert.deepEqual(coerceSettingValue(setting, 'abc', QUERY_IDS), {});
	assert.deepEqual(coerceSettingValue(setting, Number.NaN, QUERY_IDS), {});
});

test('the text setting trims, and a cleared title removes the key', () => {
	const setting = { key: 'title', kind: 'text', group: 'display' };
	assert.deepEqual(coerceSettingValue(setting, '  My KPI  ', QUERY_IDS), { title: 'My KPI' });
	assert.deepEqual(coerceSettingValue(setting, '', QUERY_IDS), { title: undefined });
	assert.deepEqual(coerceSettingValue(setting, '   ', QUERY_IDS), { title: undefined });
	assert.deepEqual(coerceSettingValue(setting, 7, QUERY_IDS), {});
});

test('options-target numbers write the key and clear it with undefined', () => {
	const setting = {
		key: 'topN',
		kind: 'number',
		group: 'axes',
		min: 0,
		max: 200,
		step: 1,
		fallback: 0,
		target: 'options',
	};
	assert.deepEqual(coerceSettingValue(setting, '12.6', QUERY_IDS), {
		options: { topN: 13 },
	});
	assert.deepEqual(coerceSettingValue(setting, 999, QUERY_IDS), {
		options: { topN: 200 },
	});
	assert.deepEqual(coerceSettingValue(setting, '', QUERY_IDS), {
		options: { topN: undefined },
	});
});

test('options-target numbers keep decimals when integer is false', () => {
	const setting = {
		key: 'yMin',
		kind: 'number',
		group: 'axes',
		min: -100,
		max: 100,
		fallback: 0,
		integer: false,
		target: 'options',
	};
	assert.deepEqual(coerceSettingValue(setting, '1.5', QUERY_IDS), {
		options: { yMin: 1.5 },
	});
});

test('options-target text trims and deletes the key when cleared', () => {
	const setting = {
		key: 'xTitle',
		kind: 'text',
		group: 'axes',
		target: 'options',
	};
	assert.deepEqual(coerceSettingValue(setting, '  Days  ', QUERY_IDS), {
		options: { xTitle: 'Days' },
	});
	assert.deepEqual(coerceSettingValue(setting, '   ', QUERY_IDS), {
		options: { xTitle: undefined },
	});
});

test('the field setting accepts non-empty column keys only', () => {
	const setting = {
		key: 'yField',
		kind: 'field',
		group: 'axes',
		role: 'y',
		fallback: 'completed',
		target: 'options',
	};
	assert.deepEqual(coerceSettingValue(setting, 'ratio', QUERY_IDS), {
		options: { yField: 'ratio' },
	});
	assert.deepEqual(coerceSettingValue(setting, '', QUERY_IDS), {});
	assert.deepEqual(coerceSettingValue(setting, 3, QUERY_IDS), {});
});
