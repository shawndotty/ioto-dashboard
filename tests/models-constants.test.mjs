import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const {
	DASHBOARD_VIEW_TYPE,
	TASK_VIEW_TYPE,
	NOTE_VIEW_TYPE,
	CUSTOM_INSPECTOR_VIEW_TYPE,
} = await jiti.import('../src/models/constants.ts');

// 视图 type 是 Obsidian registerView / setViewState 使用的稳定 ID，
// 改动会破坏已保存的 workspace 布局。
test('view type constants keep their registered values', () => {
	assert.equal(DASHBOARD_VIEW_TYPE, 'ioto-dashboard-view');
	assert.equal(TASK_VIEW_TYPE, 'ioto-task-view');
	assert.equal(NOTE_VIEW_TYPE, 'ioto-note-view');
	assert.equal(CUSTOM_INSPECTOR_VIEW_TYPE, 'ioto-custom-inspector-view');
});

test('view type constants are distinct and share the ioto-*-view shape', () => {
	const all = [
		DASHBOARD_VIEW_TYPE,
		TASK_VIEW_TYPE,
		NOTE_VIEW_TYPE,
		CUSTOM_INSPECTOR_VIEW_TYPE,
	];
	assert.equal(new Set(all).size, 4, 'view types must be distinct');
	for (const value of all) {
		assert.match(value, /^ioto-[a-z-]+-view$/);
	}
});

// main.ts 必须用这些常量去注册视图（而不是硬编码字符串）。
test('main.ts registers views by these constants', () => {
	const src = readFileSync(
		fileURLToPath(new URL('../src/main.ts', import.meta.url)),
		'utf8',
	);
	assert.match(
		src,
		/import\s*\{[^}]*DASHBOARD_VIEW_TYPE[^}]*\}\s*from\s*["']\.\/models\/constants["']/,
		'main.ts should import the view constants from ./models/constants',
	);
	for (const name of [
		'DASHBOARD_VIEW_TYPE',
		'TASK_VIEW_TYPE',
		'NOTE_VIEW_TYPE',
		'CUSTOM_INSPECTOR_VIEW_TYPE',
	]) {
		assert.ok(
			new RegExp(`registerView\\(\\s*${name}\\b`).test(src),
			`main.ts should call registerView(${name}, ...)`,
		);
	}
});
