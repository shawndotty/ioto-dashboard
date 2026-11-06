import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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

const localeDir = fileURLToPath(
	new URL('../src/lang/locale/', import.meta.url),
);

// 自动发现词典文件，将来新增语言无需改本测试。`en` 作为键集合的基准。
const localeFiles = readdirSync(localeDir).filter(
	(file) => file.endsWith('.ts') && !file.startsWith('index'),
);

const REFERENCE = 'en';
const CANONICAL_KEY_COUNT = 133;

const locales = {};
for (const file of localeFiles) {
	const name = file.replace(/\.ts$/, '');
	locales[name] = (await jiti.import(`../src/lang/locale/${file}`)).default;
}

const referenceKeys = Object.keys(locales[REFERENCE]).sort();

test('locale directory is discovered with the reference language', () => {
	assert.ok(
		localeFiles.length >= 2,
		`expected at least 2 locale files, found ${localeFiles.length}`,
	);
	assert.ok(
		REFERENCE in locales,
		`"${REFERENCE}" locale must exist and act as the key reference`,
	);
});

test(`each dictionary declares exactly ${CANONICAL_KEY_COUNT} keys`, () => {
	for (const [name, dict] of Object.entries(locales)) {
		assert.equal(
			Object.keys(dict).length,
			CANONICAL_KEY_COUNT,
			`"${name}" should declare ${CANONICAL_KEY_COUNT} keys (update this constant when keys are intentionally added/removed)`,
		);
	}
});

// 核心不变量：每个词典必须与 en 声明完全相同的键集合。
// 缺键/多键会破坏运行时 fallback，导致未翻译或重复字符串。
for (const name of Object.keys(locales)) {
	if (name === REFERENCE) continue;

	test(`locale "${name}" has exactly the same keys as "${REFERENCE}"`, () => {
		const keys = Object.keys(locales[name]).sort();
		const missing = referenceKeys.filter((key) => !keys.includes(key));
		const extra = keys.filter((key) => !referenceKeys.includes(key));

		assert.deepEqual(
			keys,
			referenceKeys,
			[
				`Key mismatch between "${name}" and "${REFERENCE}".`,
				missing.length ? `Missing in "${name}": ${missing.join(', ')}` : null,
				extra.length ? `Extra in "${name}": ${extra.join(', ')}` : null,
			]
				.filter(Boolean)
				.join('\n'),
		);
	});
}

// 值体检：每个翻译值都必须是非空字符串，UI 才不会渲染出空/非字符串标签。
test('every translation value is a non-empty string', () => {
	for (const [name, dict] of Object.entries(locales)) {
		for (const [key, value] of Object.entries(dict)) {
			assert.equal(
				typeof value,
				'string',
				`${name}.${key} should be a string, got ${typeof value}`,
			);
			assert.ok(
				value.trim().length > 0,
				`${name}.${key} should not be empty`,
			);
		}
	}
});

// dashboard 的词典是「UPPER_SNAKE 键 + 人类可读值」，不是 text-popup 那种「键=值」。
// 这条断言防止误把 en 改成键值一致（会让 t() 回退判断失效）。
test('en uses human-readable values, not key===value', () => {
	const equal = Object.entries(locales[REFERENCE]).filter(
		([key, value]) => key === value,
	);
	assert.equal(equal.length, 0, `en should not use key===value, got: ${equal.map(([k]) => k).join(', ')}`);
});

// 中文词典必须是真翻译，而不是 en 的副本。
test('zh-cn / zh-tw differ from en on many keys', () => {
	for (const name of ['zh-cn', 'zh-tw']) {
		const differing = referenceKeys.filter(
			(key) => locales[name][key] !== locales[REFERENCE][key],
		);
		assert.ok(
			differing.length >= 10,
			`"${name}" should translate many keys, only ${differing.length} differ`,
		);
	}
});
