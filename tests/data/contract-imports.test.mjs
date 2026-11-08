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

const BOUNDED_DIRS = ['src/query', 'src/metrics'];
const boundedFiles = BOUNDED_DIRS.flatMap((dir) => {
	const absolute = path.join(pluginRoot, dir);
	return fs
		.readdirSync(absolute)
		.filter((name) => name.endsWith('.ts'))
		.map((name) => path.join(absolute, name));
});

const FORBIDDEN = [
	'../views',
	'../ui',
	'../settings',
	'../services',
	'../lang',
	'../models',
];

const VAULT_WRITE_APIS = [
	'vault.create',
	'vault.createFolder',
	'vault.modify',
	'vault.process',
	'vault.delete',
	'vault.trash',
	'vault.rename',
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

test('every query/metrics module is scanned', () => {
	assert.ok(
		boundedFiles.length >= 8,
		`expected query/metrics modules, found ${boundedFiles.length}`,
	);
	for (const dir of BOUNDED_DIRS) {
		assert.ok(
			boundedFiles.some((file) =>
				file.startsWith(path.join(pluginRoot, dir) + path.sep),
			),
			`no modules found under ${dir}`,
		);
	}
});

test('src/query and src/metrics never import UI, settings or lang layers', () => {
	for (const file of boundedFiles) {
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

test('query/metrics modules never write notes through the vault API', () => {
	for (const file of boundedFiles) {
		const source = fs.readFileSync(file, 'utf8');
		for (const api of VAULT_WRITE_APIS) {
			assert.ok(
				!source.includes(api),
				`${path.basename(file)} calls ${api}`,
			);
		}
	}
});

test('only the snapshot store writes its own file', () => {
	const writers = boundedFiles.filter((file) => {
		const source = fs.readFileSync(file, 'utf8');
		return source.includes('.write(') || source.includes('.rename(');
	});
	assert.deepEqual(
		writers.map((file) => path.basename(file)),
		['snapshot-store.ts'],
	);
});

