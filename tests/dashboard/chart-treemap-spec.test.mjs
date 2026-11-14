import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buildTreemapSpec, squarify, TREEMAP_HEADER_H } = await load(
	'../../src/dashboard/dataset/charts/treemap-spec.ts',
);

function cell(text, sortValue, path) {
	const result = sortValue === undefined ? { text } : { text, sortValue };
	return path === undefined ? result : { ...result, path };
}

const SIZE = { w: 480, h: 320 };

const NOTE_COLUMNS = [
	{ key: 'note', labelKey: 'DATASET_COL_NAME', type: 'text' },
	{ key: 'folder', labelKey: 'DATASET_COL_FOLDER', type: 'text' },
	{ key: 'tasks', labelKey: 'DATASET_COL_TASKS', type: 'number' },
	{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
];

function noteDataset(rows, extra = {}) {
	return {
		object: 'note',
		measure: 'count',
		columns: NOTE_COLUMNS,
		rows: rows.map(([name, folder, tasks], index) => ({
			id: `note:${index}`,
			cells: {
				note: cell(name),
				folder: cell(folder),
				tasks: cell(String(tasks), tasks),
				completed: cell('0', 0),
			},
		})),
		total: rows.length,
		truncated: false,
		...extra,
	};
}

function folderDataset(rows) {
	return {
		object: 'folder',
		measure: 'count',
		columns: [
			{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
			{ key: 'path', labelKey: 'DATASET_COL_PATH', type: 'path' },
			{ key: 'files', labelKey: 'DATASET_COL_FILES', type: 'number' },
		],
		rows: rows.map(([path, files], index) => ({
			id: path,
			cells: {
				name: cell(path.split('/').pop(), undefined, path),
				path: cell(path, undefined, path),
				files: cell(String(files), files),
			},
		})),
		total: rows.length,
		truncated: false,
	};
}

function projectDataset(rows) {
	return {
		object: 'project',
		measure: 'count',
		columns: [
			{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
			{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
		],
		rows: rows.map(([name, completed], index) => ({
			id: `project:${index}`,
			cells: {
				name: cell(name),
				completed: cell(String(completed), completed),
			},
			related: [{ path: `${name}.md`, label: name, kind: 'task' }],
			relatedTotal: completed,
		})),
		total: rows.length,
		truncated: false,
	};
}

function inside(rect, outer, epsilon = 0.001) {
	return (
		rect.x >= outer.x - epsilon &&
		rect.y >= outer.y - epsilon &&
		rect.x + rect.w <= outer.x + outer.w + epsilon &&
		rect.y + rect.h <= outer.y + outer.h + epsilon
	);
}

function overlaps(left, right) {
	const horizontal =
		Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x);
	const vertical =
		Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y);
	return horizontal > 0.5 && vertical > 0.5;
}

test('squarify keeps one rect per input, inside the bounds and non-overlapping', () => {
	const values = [40, 25, 15, 10, 6, 4];
	const rect = { x: 10, y: 20, w: 300, h: 200 };
	const rects = squarify(values, rect, 2);

	assert.equal(rects.length, values.length);
	for (const item of rects) {
		assert.ok(inside(item, rect), JSON.stringify(item));
		assert.ok(item.w >= 0 && item.h >= 0);
	}
	for (let left = 0; left < rects.length; left += 1) {
		for (let right = left + 1; right < rects.length; right += 1) {
			assert.equal(
				overlaps(rects[left], rects[right]),
				false,
				`rects ${left} and ${right} overlap`,
			);
		}
	}
	// Bigger values keep bigger areas.
	const area = (item) => item.w * item.h;
	assert.ok(area(rects[0]) > area(rects[1]));
	assert.ok(area(rects[1]) > area(rects[2]));
});

test('squarify gives zero-sized rects to non-positive values', () => {
	const rects = squarify([10, 0, -5], { x: 0, y: 0, w: 100, h: 100 }, 2);
	assert.equal(rects.length, 3);
	assert.equal(rects[1].w * rects[1].h, 0);
	assert.equal(rects[2].w * rects[2].h, 0);
	assert.ok(rects[0].w * rects[0].h > 0);
});

test('squarify packs several tiles into shared bands instead of one per row', () => {
	const values = [30, 25, 20, 15, 10, 8, 5, 3, 2, 1];
	const rect = { x: 0, y: 0, w: 900, h: 300 };
	const rects = squarify(values, rect, 2);

	const bands = new Map();
	for (const item of rects) {
		const key = Math.round(item.y);
		bands.set(key, (bands.get(key) ?? 0) + 1);
	}
	const counts = [...bands.values()];
	assert.ok(
		counts.some((count) => count >= 2),
		`expected a band with multiple tiles, got ${JSON.stringify([...bands])}`,
	);
	assert.ok(bands.size <= 5, `expected <= 5 bands, got ${bands.size}`);
});

test('squarify areas follow value shares', () => {
	const values = [30, 25, 20, 15, 10, 8, 5, 3, 2, 1];
	const rect = { x: 0, y: 0, w: 900, h: 300 };
	const rects = squarify(values, rect, 2);

	const sum = values.reduce((total, value) => total + value, 0);
	const totalArea = rects.reduce((total, item) => total + item.w * item.h, 0);
	assert.ok(totalArea > 0);
	for (let index = 0; index < 3; index += 1) {
		const share = values[index] / sum;
		const actual = (rects[index].w * rects[index].h) / totalArea;
		assert.ok(
			Math.abs(actual - share) <= 0.05,
			`tile ${index}: value share ${share.toFixed(4)} vs area share ${actual.toFixed(4)}`,
		);
	}
});

test('root tiles fan out across the canvas instead of stacking in one column', () => {
	const rows = Array.from({ length: 6 }, (_, index) => [`N${index}`, '1-输入', 5]);
	const spec = buildTreemapSpec(
		noteDataset(rows),
		{ groupField: 'none', xField: 'note', yField: 'tasks' },
		SIZE,
		'note',
	);

	assert.ok(spec);
	const roots = spec.tiles.filter((tile) => tile.depth === 0);
	assert.equal(roots.length, 6);
	const first = roots[0].rect;
	const sameX = roots.every((tile) => Math.abs(tile.rect.x - first.x) < 0.001);
	const sameY = roots.every((tile) => Math.abs(tile.rect.y - first.y) < 0.001);
	assert.equal(sameX, false, 'all root tiles share one x coordinate');
	assert.equal(sameY, false, 'all root tiles share one y coordinate');
});

test('note datasets default to per-note tiles grouped by folder', () => {
	const spec = buildTreemapSpec(
		noteDataset([
			['A', '1-输入', 6],
			['B', '1-输入', 4],
			['C', '2-输出', 10],
		]),
		{},
		SIZE,
		'note',
	);

	assert.ok(spec);
	assert.equal(spec.kind, 'treemap');
	assert.equal(spec.ariaKey, 'CHART_ARIA_TREEMAP');
	assert.equal(spec.labelMode, 'name');
	assert.equal(spec.valueLabelKey, 'DATASET_COL_TASKS');
	const parents = spec.tiles.filter((tile) => tile.depth === 0);
	assert.equal(parents.length, 2);
	const input = parents.find((tile) => tile.fullLabel === '1-输入');
	const output = parents.find((tile) => tile.fullLabel === '2-输出');
	assert.ok(input && output);
	assert.equal(input.value, 10);
	assert.equal(output.value, 10);
	assert.equal(input.relatedTotal, 2);
	const children = spec.tiles.filter((tile) => tile.parentKey === input.bucketKey);
	assert.equal(children.length, 2);
	for (const child of children) {
		assert.equal(child.depth, 1);
		assert.equal(child.refs.length, 1);
		assert.equal(child.refs[0].kind, 'note');
	}
});

test('folder datasets nest folders inside their parent path', () => {
	const spec = buildTreemapSpec(
		folderDataset([
			['1-输入/A', 3],
			['1-输入/B', 5],
			['2-输出/C', 7],
		]),
		{},
		SIZE,
		'folder',
	);

	assert.ok(spec);
	const parents = spec.tiles.filter((tile) => tile.depth === 0);
	assert.equal(parents.length, 2);
	assert.ok(parents.every((tile) => tile.bucketKey.startsWith('group:')));
	const input = parents.find((tile) => tile.fullLabel === '1-输入');
	assert.ok(input);
	assert.equal(input.targetPath, '1-输入');
	const children = spec.tiles.filter((tile) => tile.parentKey === input.bucketKey);
	assert.deepEqual(
		children.map((tile) => tile.fullLabel).sort(),
		['A', 'B'],
	);
});

test('groupField none keeps one flat tile per row', () => {
	const spec = buildTreemapSpec(
		noteDataset([
			['A', '1-输入', 6],
			['B', '2-输出', 4],
		]),
		{ groupField: 'none', xField: 'note', yField: 'tasks' },
		SIZE,
		'note',
	);

	assert.ok(spec);
	assert.equal(spec.tiles.length, 2);
	assert.ok(spec.tiles.every((tile) => tile.depth === 0 && !tile.parentKey));
	assert.equal(spec.tiles[0].fullLabel, 'A');
	assert.equal(spec.tiles[0].value, 6);
});

test('topN merges the remainder into a non-clickable Other tile', () => {
	const rows = Array.from({ length: 6 }, (_, index) => [
		`N${index}`,
		'1-输入',
		index + 1,
	]);
	const spec = buildTreemapSpec(
		noteDataset(rows),
		{ groupField: 'none', xField: 'note', yField: 'tasks', topN: 3 },
		SIZE,
		'note',
	);

	assert.ok(spec);
	const other = spec.tiles.find((tile) => tile.isOther);
	assert.ok(other);
	assert.equal(other.labelKey, 'SETTING_PIE_OTHER');
	assert.equal(other.value, 1 + 2 + 3);
	assert.equal(other.rowIds.length, 0);
	assert.equal(other.refs.length, 0);
	assert.equal(other.relatedTotal, 0);
	assert.equal(other.targetPath, undefined);
	assert.equal(spec.tiles.length, 4);
	assert.equal(
		spec.tiles
			.filter((tile) => !tile.isOther)
			.reduce((sum, tile) => sum + tile.value, 0),
		15,
	);
});

test('integer percentages add up to 100 for roots and leaves', () => {
	const spec = buildTreemapSpec(
		noteDataset([
			['A', '1-输入', 3],
			['B', '1-输入', 3],
			['C', '2-输出', 3],
		]),
		{},
		SIZE,
		'note',
	);

	assert.ok(spec);
	const roots = spec.tiles.filter((tile) => tile.depth === 0 && !tile.isOther);
	assert.equal(
		roots.reduce((sum, tile) => sum + tile.integerPercent, 0),
		100,
	);
	const leaves = spec.tiles.filter((tile) => tile.depth === 1);
	assert.equal(
		leaves.reduce((sum, tile) => sum + tile.integerPercent, 0),
		100,
	);
});

test('project rows carry their pending-task refs into the tile', () => {
	const spec = buildTreemapSpec(
		projectDataset([
			['Alpha', 4],
			['Beta', 2],
		]),
		{},
		SIZE,
		'project',
	);

	assert.ok(spec);
	assert.equal(spec.tiles.length, 2);
	const alpha = spec.tiles.find((tile) => tile.fullLabel === 'Alpha');
	assert.ok(alpha);
	assert.deepEqual(alpha.refs, [{ path: 'Alpha.md', label: 'Alpha', kind: 'task' }]);
	assert.equal(alpha.relatedTotal, 4);
});

test('header space and groups keep children inside the parent tile', () => {
	const spec = buildTreemapSpec(
		noteDataset([
			['A', '1-输入', 6],
			['B', '1-输入', 4],
		]),
		{},
		SIZE,
		'note',
	);

	assert.ok(spec);
	const parent = spec.tiles.find((tile) => tile.depth === 0);
	const children = spec.tiles.filter((tile) => tile.depth === 1);
	assert.ok(parent);
	assert.ok(parent.rect.h > TREEMAP_HEADER_H);
	for (const child of children) {
		assert.ok(child.rect.y >= parent.rect.y + TREEMAP_HEADER_H - 0.001);
		assert.ok(inside(child.rect, parent.rect));
	}
});

test('empty rows, tiny canvases and zero totals return null', () => {
	assert.equal(
		buildTreemapSpec(noteDataset([]), {}, SIZE, 'note'),
		null,
	);
	assert.equal(
		buildTreemapSpec(noteDataset([['A', 'x', 1]]), {}, { w: 40, h: 40 }, 'note'),
		null,
	);
	assert.equal(
		buildTreemapSpec(
			noteDataset([
				['A', 'x', 0],
				['B', 'x', 0],
			]),
			{},
			SIZE,
			'note',
		),
		null,
	);
});

test('truncated datasets report hidden rows and reserve height', () => {
	const spec = buildTreemapSpec(
		noteDataset([['A', '1-输入', 1]], {
			total: 4,
			truncated: true,
		}),
		{ showLegend: true },
		SIZE,
		'note',
	);

	assert.ok(spec);
	assert.equal(spec.hiddenCount, 3);
	assert.equal(spec.showLegend, true);
	assert.equal(spec.extrasHeight, 22 + 20);
});