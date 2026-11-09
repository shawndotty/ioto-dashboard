import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { coerceSettingValue } = await load('../../src/dashboard/registry.ts');
const { kpiComponent } = await load('../../src/dashboard/components/kpi.ts');
const { projectProgressComponent } = await load(
	'../../src/dashboard/components/project-progress.ts',
);
const { unfinishedTasksComponent } = await load(
	'../../src/dashboard/components/unfinished-tasks.ts',
);

const COMPONENTS = [kpiComponent, projectProgressComponent, unfinishedTasksComponent];
const CONFIG_KEYS = new Set(['id', 'type', 'queryId', 'basis', 'limit', 'title', 'x', 'y', 'w', 'h']);
const QUERY_IDS = new Set(['builtin:tasks-all', 'builtin:tasks-unfinished', 'user:1']);

test('every component declares settings whose keys are valid config fields', () => {
	for (const component of COMPONENTS) {
		assert.ok(Array.isArray(component.settings) && component.settings.length > 0, `${component.type} needs settings`);
		assert.equal(component.settings[0].kind, 'query', `${component.type} should lead with the query`);
		const keys = component.settings.map((setting) => setting.key);
		assert.equal(new Set(keys).size, keys.length, `${component.type} has duplicate setting keys`);
		for (const key of keys) {
			assert.ok(CONFIG_KEYS.has(key), `${component.type}.${key} is not a DashboardComponentConfig key`);
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
				assert.equal(created[setting.key], setting.fallback, `${component.type} ${setting.key} fallback`);
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
			assert.equal(setting.max, 100, `${component.type} ${setting.key} max should stay 100`);
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
