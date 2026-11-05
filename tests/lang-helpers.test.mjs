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

// helpers.ts 里的 `import { moment } from "obsidian"` 会解析到本桩；
// 桩重导出真实 moment，故在它上面切换语言即可被 t() 看见（同一实例）。
const { moment } = await jiti.import('obsidian');
const { t } = await jiti.import('../src/lang/helpers.ts');

// node:test 顶层用例顺序执行，但 moment.locale() 是全局状态：
// 每个用例显式设定语言，避免互相污染。
test('en is the default language', () => {
	moment.locale('en');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO Dashboard');
	assert.equal(t('NAV_INPUT'), 'Input');
});

test('zh-cn resolves the simplified-Chinese dictionary', () => {
	moment.locale('zh-cn');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO 仪表盘');
	assert.equal(t('NO_NOTES_FOUND'), '没有找到笔记。');
});

test('zh-tw resolves the traditional-Chinese dictionary', () => {
	moment.locale('zh-tw');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO 儀表板');
});

test('mixed-case zh-TW still resolves to zh-tw (lowercased)', () => {
	moment.locale('zh-TW');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO 儀表板');
});

test('unknown languages (ja/fr) fall back to English', () => {
	for (const lang of ['ja', 'fr']) {
		moment.locale(lang);
		assert.equal(
			t('DASHBOARD_TITLE'),
			'IOTO Dashboard',
			`"${lang}" is not in localeMap and should fall back to en`,
		);
	}
});

test('{0}/{1} placeholders are interpolated', () => {
	moment.locale('en');
	assert.equal(t('PAGINATION_PAGE', ['2', '5']), 'Page 2 of 5');
});

test('no args leaves placeholders untouched', () => {
	moment.locale('en');
	assert.equal(t('PAGINATION_PAGE'), 'Page {0} of {1}');
});

test('helpers uses a global regex: partial and extra args behave predictably', () => {
	moment.locale('en');
	// t() 用 new RegExp(`\\{${index}\\}`, "g") 逐个 index 全局替换。
	// 现有词典没有重复占位符，故用「少传 / 多传」覆盖替换循环的可观察行为。
	assert.equal(t('PAGINATION_PAGE', ['2']), 'Page 2 of {1}');
	assert.equal(t('PAGINATION_PAGE', ['2', '5', '999']), 'Page 2 of 5');
});

test('switching language back and forth invalidates the locale cache', () => {
	moment.locale('en');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO Dashboard');
	moment.locale('zh-cn');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO 仪表盘');
	moment.locale('en');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO Dashboard');
	moment.locale('zh-tw');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO 儀表板');
	moment.locale('en');
	assert.equal(t('DASHBOARD_TITLE'), 'IOTO Dashboard');
});
