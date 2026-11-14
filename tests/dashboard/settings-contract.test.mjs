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
const { heatmapComponent } = await load(
	'../../src/dashboard/components/heatmap.ts',
);
const { barChartComponent } = await load(
	'../../src/dashboard/components/bar-chart.ts',
);
const { markdownComponent } = await load(
	'../../src/dashboard/components/markdown.ts',
);
const { buttonComponent } = await load(
	'../../src/dashboard/components/button.ts',
);

const COMPONENTS = [
	kpiComponent,
	projectProgressComponent,
	taskListComponent,
	noteListComponent,
	tableComponent,
	lineChartComponent,
	heatmapComponent,
	barChartComponent,
	markdownComponent,
	buttonComponent,
];
const CONFIG_KEYS = new Set(['id', 'type', 'queryId', 'basis', 'limit', 'title', 'view', 'measure', 'options', 'x', 'y', 'w', 'h']);
const QUERY_IDS = new Set(['builtin:tasks-all', 'builtin:tasks-unfinished', 'user:1']);

test('every component declares settings whose keys are valid config fields', () => {
	for (const component of COMPONENTS) {
		assert.ok(Array.isArray(component.settings) && component.settings.length > 0, `${component.type} needs settings`);
		if (component.queryless) {
			assert.ok(
				!component.settings.some((setting) => setting.kind === 'query'),
				`${component.type} is queryless and must not declare a query setting`,
			);
		} else {
			assert.equal(component.settings[0].kind, 'query', `${component.type} should lead with the query`);
		}
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

test('every basis setting defaults to the file-wide scope', () => {
	const declaring = COMPONENTS.filter((component) =>
		component.settings.some((setting) => setting.kind === 'basis'),
	);
	assert.ok(declaring.length > 0, 'expected at least one component to expose a basis setting');
	for (const component of declaring) {
		const setting = component.settings.find((item) => item.kind === 'basis');
		assert.equal(
			setting.fallback,
			'file',
			`${component.type} basis fallback should match KPI/table/project-progress`,
		);
		assert.equal(
			component.createConfig(component.defaultQueryId).basis,
			'file',
			`${component.type} createConfig should write basis: file`,
		);
	}
});

test('task list requests fall back to the file-wide scope when basis is absent', () => {
	const config = taskListComponent.createConfig(taskListComponent.defaultQueryId);
	delete config.basis;
	assert.equal(taskListComponent.toDatasetRequest(config).basis, 'file');
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
				// Row-count caps are not percentages; everything else stays within 100.
				const rowCountCap = component.type === 'project-progress' && setting.key === 'limit';
				if (!rowCountCap) {
					assert.equal(setting.max, 100, `${component.type} ${setting.key} max should stay 100`);
				}
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

test('the columns setting stores a comma-separated option list', () => {
	const setting = tableComponent.settings.find((item) => item.key === 'columns');
	assert.equal(setting.kind, 'columns');
	assert.equal(setting.target, 'options');
	assert.deepEqual(
		coerceSettingValue(setting, ['note', 'folder', ' '], QUERY_IDS),
		{ options: { columns: 'note,folder' } },
	);
	assert.deepEqual(coerceSettingValue(setting, [], QUERY_IDS), {
		options: { columns: undefined },
	});
	assert.deepEqual(coerceSettingValue(setting, 'note', QUERY_IDS), {});
});

test('the textarea setting keeps newlines and deletes an all-whitespace value', () => {
	const setting = {
		key: 'markdown',
		kind: 'textarea',
		group: 'display',
		target: 'options',
	};
	assert.deepEqual(coerceSettingValue(setting, 'line 1\r\nline 2', QUERY_IDS), {
		options: { markdown: 'line 1\nline 2' },
	});
	assert.deepEqual(
		coerceSettingValue(setting, '  indented\n\ntext  ', QUERY_IDS),
		{ options: { markdown: '  indented\n\ntext  ' } },
	);
	assert.deepEqual(coerceSettingValue(setting, '   \n  ', QUERY_IDS), {
		options: { markdown: undefined },
	});
	assert.deepEqual(coerceSettingValue(setting, 7, QUERY_IDS), {});
});

test('the target setting trims values and deletes the key when cleared', () => {
	const setting = {
		key: 'notePath',
		kind: 'target',
		picker: 'note',
		group: 'display',
		target: 'options',
	};
	assert.deepEqual(coerceSettingValue(setting, '  Notes/A.md ', QUERY_IDS), {
		options: { notePath: 'Notes/A.md' },
	});
	assert.deepEqual(coerceSettingValue(setting, '   ', QUERY_IDS), {
		options: { notePath: undefined },
	});
	assert.deepEqual(coerceSettingValue(setting, 42, QUERY_IDS), {});
});

test('the table writes defaults its settings advertise', () => {
	const created = tableComponent.createConfig(tableComponent.defaultQueryId);
	assert.equal(created.basis, 'file');
	assert.equal(created.measure, 'count');
	assert.equal(created.limit, 50);
	assert.equal(created.options?.groupBy, 'none');
	assert.equal(created.options?.showRowNumber, false);
});
