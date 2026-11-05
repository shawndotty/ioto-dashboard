import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: path.join(here, 'stubs/obsidian.mjs'),
		'ui/': path.join(here, '../src/ui') + path.sep,
	},
});

const { IotoSettingsService } = await jiti.import(
	'../src/services/ioto-settings-services.ts',
);

test('no app.plugins -> not available, null settings', () => {
	const svc = new IotoSettingsService({});
	assert.equal(svc.isAvailable(), false);
	assert.equal(svc.getSettings(), null);
});

test('app.plugins without a .plugins map -> not available, null settings', () => {
	const svc = new IotoSettingsService({ plugins: {} });
	assert.equal(svc.isAvailable(), false);
	assert.equal(svc.getSettings(), null);
});

test('plugins map present but ioto-settings absent -> not available, null settings', () => {
	const svc = new IotoSettingsService({ plugins: { plugins: {} } });
	assert.equal(svc.isAvailable(), false);
	assert.equal(svc.getSettings(), null);
});

test('ioto-settings present -> available and returns its settings', () => {
	const settings = { inputFolder: '1-Input', extraFolder: '0-辅助' };
	const svc = new IotoSettingsService({
		plugins: { plugins: { 'ioto-settings': { settings } } },
	});
	assert.equal(svc.isAvailable(), true);
	assert.deepEqual(svc.getSettings(), settings);
	assert.equal(svc.getSettings().inputFolder, '1-Input');
});

test('ioto-settings present but settings empty -> {}', () => {
	// getSettings() 返回 `plugin.settings || {}`，空值降级为空对象。
	for (const empty of [undefined, null, {}]) {
		const svc = new IotoSettingsService({
			plugins: { plugins: { 'ioto-settings': { settings: empty } } },
		});
		assert.equal(svc.isAvailable(), true);
		assert.deepEqual(svc.getSettings(), {});
	}
});
