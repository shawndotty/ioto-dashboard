import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { coerceSettingValue } = await load('../../src/dashboard/registry.ts');
const {
	STYLE_SETTINGS,
	STYLE_SETTING_KEYS,
	DISPLAY_SETTINGS,
	cardSurfaceOf,
	cardStyleVars,
	settingsOf,
} = await load('../../src/dashboard/style-settings.ts');
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
const { tableComponent } = await load(
	'../../src/dashboard/components/table.ts',
);
const { lineChartComponent } = await load(
	'../../src/dashboard/components/line-chart.ts',
);
const { barChartComponent } = await load(
	'../../src/dashboard/components/bar-chart.ts',
);
const { pieChartComponent, donutChartComponent } = await load(
	'../../src/dashboard/components/pie-chart.ts',
);
const { scatterChartComponent } = await load(
	'../../src/dashboard/components/scatter-chart.ts',
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
	barChartComponent,
	pieChartComponent,
	donutChartComponent,
	scatterChartComponent,
	markdownComponent,
	buttonComponent,
];

function styleSetting(key) {
	const setting = STYLE_SETTINGS.find((item) => item.key === key);
	assert.ok(setting, `missing style setting ${key}`);
	return setting;
}

test('style settings are unique options keys in the style group', () => {
	const keys = STYLE_SETTINGS.map((setting) => setting.key);
	assert.equal(new Set(keys).size, keys.length);
	assert.deepEqual(keys, [...STYLE_SETTING_KEYS]);
	for (const setting of STYLE_SETTINGS) {
		assert.equal(setting.group, 'style', setting.key);
		assert.equal(setting.target, 'options', setting.key);
	}
	for (const component of COMPONENTS) {
		const componentKeys = (component.settings ?? []).map(
			(setting) => setting.key,
		);
		for (const key of STYLE_SETTING_KEYS) {
			assert.ok(
				!componentKeys.includes(key),
				`${component.type} must not declare ${key}`,
			);
		}
	}
});

test('createConfig writes only the default plain surface, never other style options', () => {
	const surfaceDefaults = new Map([
		['markdown', 'plain'],
		['button', 'plain'],
	]);
	for (const component of COMPONENTS) {
		const created = component.createConfig(component.defaultQueryId);
		assert.equal(
			created.options?.surface,
			surfaceDefaults.get(component.type),
			`${component.type} surface`,
		);
		for (const key of STYLE_SETTING_KEYS) {
			if (key === 'surface') continue;
			assert.equal(
				created.options?.[key],
				undefined,
				`${component.type} wrote ${key}`,
			);
		}
	}
});

test('coerceSettingValue accepts only alignments and hex colors', () => {
	const align = styleSetting('textAlign');
	for (const value of ['left', 'center', 'right']) {
		assert.deepEqual(coerceSettingValue(align, value, new Set()), {
			options: { textAlign: value },
		});
	}
	assert.deepEqual(coerceSettingValue(align, 'justify', new Set()), {});
	assert.deepEqual(coerceSettingValue(align, 1, new Set()), {});

	for (const key of ['textColor', 'backgroundColor']) {
		const setting = styleSetting(key);
		assert.deepEqual(
			coerceSettingValue(setting, '#a1b2c3', new Set()),
			{ options: { [key]: '#a1b2c3' } },
		);
		assert.deepEqual(coerceSettingValue(setting, 'red', new Set()), {});
		assert.deepEqual(coerceSettingValue(setting, '#abc', new Set()), {});
		assert.deepEqual(coerceSettingValue(setting, undefined, new Set()), {});
	}
});

test('cardStyleVars returns only valid values and always reports a surface', () => {
	assert.deepEqual(cardStyleVars(undefined), { surface: 'card' });
	assert.deepEqual(cardStyleVars({}), { surface: 'card' });
	assert.deepEqual(
		cardStyleVars({
			textColor: '#112233',
			backgroundColor: '#445566',
			textAlign: 'center',
		}),
		{ surface: 'card', fg: '#112233', bg: '#445566', align: 'center' },
	);
	assert.deepEqual(
		cardStyleVars({
			textColor: '12px',
			backgroundColor: '#abc',
			textAlign: 'middle',
		}),
		{ surface: 'card' },
	);
	assert.deepEqual(cardStyleVars({ surface: 'flat' }), { surface: 'flat' });
	assert.deepEqual(cardStyleVars({ surface: 'bogus' }), { surface: 'card' });
});

test('surface falls back to card for missing or invalid data', () => {
	assert.equal(cardSurfaceOf(undefined), 'card');
	assert.equal(cardSurfaceOf({}), 'card');
	assert.equal(cardSurfaceOf({ surface: 'bogus' }), 'card');
	for (const value of ['card', 'flat', 'plain']) {
		assert.equal(cardSurfaceOf({ surface: value }), value);
	}
});

test('surface is selectable only for markdown and button', () => {
	const surface = styleSetting('surface');
	assert.equal(surface.kind, 'select');
	assert.equal(surface.fallback, 'card');
	assert.deepEqual(
		surface.options.map((option) => option.value),
		['card', 'flat', 'plain'],
	);
	for (const component of COMPONENTS) {
		const visible = !surface.when || surface.when({ type: component.type });
		assert.equal(
			visible,
			component.type === 'markdown' || component.type === 'button',
			`${component.type} surface visibility`,
		);
	}
	assert.deepEqual(coerceSettingValue(surface, 'plain', new Set()), {
		options: { surface: 'plain' },
	});
	assert.deepEqual(coerceSettingValue(surface, 'bogus', new Set()), {});
});

test('markdown hides the background color control on a plain surface', () => {
	const background = styleSetting('backgroundColor');
	const visible = (type, surface) =>
		!background.when || background.when({ type, options: { surface } });
	assert.equal(visible('markdown', 'plain'), false);
	assert.equal(visible('markdown', undefined), true);
	assert.equal(visible('markdown', 'card'), true);
	assert.equal(visible('markdown', 'flat'), true);
	assert.equal(visible('button', 'plain'), true);
	assert.equal(visible('kpi', 'plain'), true);
});

test('settingsOf appends style settings and hides alignment where unsupported', () => {
	const alignmentHidden = new Set([
		'line-chart',
		'bar-chart',
		'pie-chart',
		'donut-chart',
		'scatter-chart',
		'task-list',
		'note-list',
		'table',
	]);
	for (const component of COMPONENTS) {
		const merged = settingsOf(component);
		const own = component.settings ?? [];
		assert.deepEqual(merged.slice(0, own.length), own);
		assert.deepEqual(
			merged.slice(own.length, own.length + DISPLAY_SETTINGS.length),
			DISPLAY_SETTINGS,
		);
		assert.deepEqual(
			merged.slice(own.length + DISPLAY_SETTINGS.length),
			STYLE_SETTINGS,
		);

		const align = merged.find((setting) => setting.key === 'textAlign');
		const visible = !align.when || align.when({ type: component.type });
		assert.equal(
			visible,
			!alignmentHidden.has(component.type),
			`${component.type} alignment visibility`,
		);
	}
});
