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
		// settings.ts 以 `import { TabbedSettings } from "ui/tabbed-settings"` 裸导入，
		// jiti 默认不认 tsconfig 的 baseUrl，需补 'ui/' alias。
		'ui/': path.join(here, '../src/ui') + path.sep,
	},
});

const { moment } = await jiti.import('obsidian');

// DEFAULT_SETTINGS 的 4 个文件夹默认值在模块加载时经 t() 生成，
// 故每次切换语言后要重新 import 才能拿到新快照（moduleCache:false 保证重算）。
async function loadDefaultSettings(lang) {
	moment.locale(lang);
	return (await jiti.import('../src/settings.ts')).DEFAULT_SETTINGS;
}

// 本用例若能成功 import settings.ts，即证明 'ui/' alias 已生效。
test("settings.ts imports under the 'ui/' alias", async () => {
	const settings = await loadDefaultSettings('en');
	assert.ok(settings && typeof settings === 'object');
});

test('DEFAULT_SETTINGS has exactly the 8 expected keys', async () => {
	const settings = await loadDefaultSettings('en');
	assert.deepEqual(Object.keys(settings).sort(), [
		'customFilters',
		'inputFolder',
		'modalLayout',
		'outcomeFolder',
		'outputFolder',
		'pageSize',
		'savedQueries',
		'taskFolder',
	]);
	assert.equal(settings.modalLayout, 'list');
});

test('pageSize is 100 and the two collections are empty arrays', async () => {
	const settings = await loadDefaultSettings('en');
	assert.equal(settings.pageSize, 100);
	assert.deepEqual(settings.savedQueries, []);
	assert.deepEqual(settings.customFilters, []);
});

test('the four folder defaults are non-empty strings', async () => {
	const settings = await loadDefaultSettings('en');
	for (const key of [
		'inputFolder',
		'outputFolder',
		'taskFolder',
		'outcomeFolder',
	]) {
		assert.equal(typeof settings[key], 'string', `${key} should be a string`);
		assert.ok(settings[key].trim().length > 0, `${key} should not be empty`);
	}
});

test('folder defaults follow the active language (t() at module load)', async () => {
	const en = await loadDefaultSettings('en');
	const zhCN = await loadDefaultSettings('zh-cn');
	const zhTW = await loadDefaultSettings('zh-tw');

	assert.equal(en.inputFolder, '1-Inputs');
	assert.equal(zhCN.inputFolder, '1-输入');
	assert.equal(zhTW.inputFolder, '1-輸入');
	assert.notEqual(en.inputFolder, zhCN.inputFolder);
	// 只有文件夹随语言变，其余键保持稳定。
	assert.equal(en.pageSize, zhCN.pageSize);
	assert.deepEqual(en.savedQueries, zhCN.savedQueries);
});
