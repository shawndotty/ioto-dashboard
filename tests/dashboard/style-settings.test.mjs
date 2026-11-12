import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { coerceSettingValue } = await load('../../src/dashboard/registry.ts');
const {
	STYLE_SETTINGS,
	STYLE_SETTING_KEYS,
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

const COMPONENTS = [
	kpiComponent,
	projectProgressComponent,
	taskListComponent,
	noteListComponent,
	tableComponent,
	lineChartComponent,
	barChartComponent,
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

test('createConfig never writes style options', () => {
	for (const component of COMPONENTS) {
		const created = component.createConfig(component.defaultQueryId);
		for (const key of STYLE_SETTING_KEYS) {
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

test('cardStyleVars returns only valid values', () => {
	assert.deepEqual(cardStyleVars(undefined), {});
	assert.deepEqual(cardStyleVars({}), {});
	assert.deepEqual(
		cardStyleVars({
			textColor: '#112233',
			backgroundColor: '#445566',
			textAlign: 'center',
		}),
		{ fg: '#112233', bg: '#445566', align: 'center' },
	);
	assert.deepEqual(
		cardStyleVars({
			textColor: '12px',
			backgroundColor: '#abc',
			textAlign: 'middle',
		}),
		{},
	);
});

test('settingsOf appends style settings and hides alignment where unsupported', () => {
	const alignmentHidden = new Set([
		'line-chart',
		'bar-chart',
		'task-list',
		'note-list',
		'table',
	]);
	for (const component of COMPONENTS) {
		const merged = settingsOf(component);
		const own = component.settings ?? [];
		assert.deepEqual(merged.slice(0, own.length), own);
		assert.deepEqual(merged.slice(own.length), STYLE_SETTINGS);

		const align = merged.find((setting) => setting.key === 'textAlign');
		const visible = !align.when || align.when({ type: component.type });
		assert.equal(
			visible,
			!alignmentHidden.has(component.type),
			`${component.type} alignment visibility`,
		);
	}
});
