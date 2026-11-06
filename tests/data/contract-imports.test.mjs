import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pluginRoot } from './helpers.mjs';

const dataDir = path.join(pluginRoot, 'src/data');
const files = fs
	.readdirSync(dataDir)
	.filter((name) => name.endsWith('.ts'))
	.map((name) => path.join(dataDir, name));

const FORBIDDEN = [
	'../views',
	'../ui',
	'../settings',
	'../services',
	'../lang',
	'../models',
];

test('every data module is scanned', () => {
	assert.ok(files.length >= 8, `expected data modules, found ${files.length}`);
});

test('src/data never imports UI or settings layers', () => {
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		for (const specifier of FORBIDDEN) {
			assert.ok(
				!source.includes(`"${specifier}`) &&
					!source.includes(`'${specifier}`),
				`${path.basename(file)} imports ${specifier}`,
			);
		}
	}
});

test('obsidian imports are type-only except TFile in vault-index', () => {
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		const statements =
			source.match(/^import\b[^;]*?from\s+["']obsidian["']/gm) ?? [];
		for (const statement of statements) {
			const normalized = statement.replace(/\s+/g, ' ').trim();
			assert.ok(
				normalized.startsWith('import type') ||
					normalized === 'import { TFile } from "obsidian"',
				`${path.basename(file)} has a value import: ${normalized}`,
			);
		}
	}
});

test('the frozen contract keeps its required fields', () => {
	const contract = fs.readFileSync(path.join(dataDir, 'types.ts'), 'utf8');
	for (const field of [
		'ioType',
		'sectionRole',
		'marker',
		'isCompleted',
		'fileTaskCount',
		'fileCompletedCount',
		'sectionTaskCount',
		'sectionCompletedCount',
		'noteCtime',
		'noteFrontmatter',
	]) {
		assert.ok(contract.includes(field), `missing contract field: ${field}`);
	}
	for (const scope of ['DEFAULT_SCOPE_SECTIONS', 'DEFAULT_TASK_SCOPE']) {
		assert.ok(contract.includes(scope), `missing contract export: ${scope}`);
	}
});
