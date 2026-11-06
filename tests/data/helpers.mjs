import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(here, '../..');
export const fixtureDir = path.join(pluginRoot, 'tests/fixtures/data');

export const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: path.join(pluginRoot, 'tests/stubs/obsidian.mjs'),
	},
});

export function fixture(name) {
	return fs.readFileSync(path.join(fixtureDir, name), 'utf8');
}

export const HEADINGS = {
	task: ['任务'],
	input: ['输入 LEARN'],
	output: ['输出 THINK'],
	outcome: ['成果 DO'],
	goal: ['目标'],
	review: ['复盘'],
};

export async function load(modulePath) {
	return jiti.import(modulePath);
}
