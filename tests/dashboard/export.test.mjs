import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	buildExportFileName,
	clampExportScale,
	composePageHeader,
	computeCanvasScaleLimit,
	isOpaqueBackground,
	pickOpaqueBackground,
	SVG_INLINE_PROPS,
} = await load('../../src/export.ts');

// Obsidian 全局 `createEl`：仅页眉合成需要，Node 单测里给一个最小 canvas 替身。
function makeCanvas(width, height, withContext = true) {
	const canvas = { width, height, calls: [] };
	canvas.getContext = () =>
		withContext
			? {
					fillStyle: '',
					font: '',
					textBaseline: '',
					fillRect: (...args) => canvas.calls.push(['fillRect', ...args]),
					fillText: (...args) => canvas.calls.push(['fillText', ...args]),
					drawImage: (...args) => canvas.calls.push(['drawImage', ...args]),
				}
			: null;
	return canvas;
}

globalThis.createEl = (tag) => {
	assert.equal(tag, 'canvas');
	return makeCanvas(0, 0);
};

test('clampExportScale: 非法/越界回落并按 0.5 步长对齐', () => {
	assert.equal(clampExportScale(NaN), 2);
	assert.equal(clampExportScale(undefined), 2);
	assert.equal(clampExportScale('2'), 2);
	assert.equal(clampExportScale(0), 1);
	assert.equal(clampExportScale(9), 4);
	assert.equal(clampExportScale(2.3), 2.5);
	assert.equal(clampExportScale(2.24), 2);
});

test('buildExportFileName: 清洗页名 + 时间戳，非法字符不删除只替换', () => {
	const at = new Date(2026, 10, 26, 15, 29, 55);
	assert.equal(
		buildExportFileName('项目/画布:页?', at),
		'项目-画布-页--20261126-152955.png',
	);
	assert.equal(buildExportFileName('My Page', at), 'My Page-20261126-152955.png');
	assert.equal(buildExportFileName('page...', at), 'page-20261126-152955.png');
	assert.equal(buildExportFileName('  ', at), 'Untitled-20261126-152955.png');
});

test('buildExportFileName: 连导不同秒不覆盖（时间戳进文件名）', () => {
	const first = buildExportFileName('总览', new Date(2026, 10, 26, 15, 29, 55));
	const second = buildExportFileName('总览', new Date(2026, 10, 26, 15, 29, 56));
	assert.notEqual(first, second);
	assert.match(first, /^总览-\d{8}-\d{6}\.png$/);
});

test('isOpaqueBackground: transparent 与 0 alpha 判透明', () => {
	assert.equal(isOpaqueBackground(null), false);
	assert.equal(isOpaqueBackground(''), false);
	assert.equal(isOpaqueBackground('transparent'), false);
	assert.equal(isOpaqueBackground('rgba(0, 0, 0, 0)'), false);
	assert.equal(isOpaqueBackground('rgb(0 0 0 / 0%)'), false);
	assert.equal(isOpaqueBackground('rgba(0, 0, 0, 0.5)'), true);
	assert.equal(isOpaqueBackground('#1e1e1e'), true);
});

test('pickOpaqueBackground: 取首个实底，全透明回落主题实底', () => {
	assert.equal(
		pickOpaqueBackground(['transparent', 'rgba(0,0,0,0)', ' #123456 '], true),
		'#123456',
	);
	assert.equal(pickOpaqueBackground(['transparent'], true), '#1e1e1e');
	assert.equal(pickOpaqueBackground(['transparent'], false), '#ffffff');
});

test('computeCanvasScaleLimit: 超单边/超面积下调倍率但不低于 1', () => {
	assert.equal(computeCanvasScaleLimit(100, 100, 2), 2);
	const reduced = computeCanvasScaleLimit(10000, 10000, 2);
	assert.ok(reduced >= 1 && reduced < 2);
	assert.equal(computeCanvasScaleLimit(20000, 20000, 1), 1);
});

test('composePageHeader: 只画标题一行，高度增量为标题带', () => {
	const source = makeCanvas(400, 100);
	const out = composePageHeader(source, {
		title: '我的页面',
		backgroundColor: '#ffffff',
		textColor: '#1f1f1f',
		scale: 2,
	});
	const headerHeight = 14 * 2 + 18 * 2 + 14 * 2;
	assert.equal(out.width, 400);
	assert.equal(out.height, 100 + headerHeight);
	const fillTexts = out.calls.filter((call) => call[0] === 'fillText');
	assert.equal(fillTexts.length, 1, '第一版页眉只放标题，不放日期行');
	assert.deepEqual(fillTexts[0].slice(1, 4), ['我的页面', 48, 64]);
	const draw = out.calls.find((call) => call[0] === 'drawImage');
	assert.equal(draw[2], 0);
	assert.equal(draw[3], headerHeight);
});

test('composePageHeader: 拿不到 2d 上下文时退回原图', () => {
	const original = globalThis.createEl;
	globalThis.createEl = () => makeCanvas(0, 0, false);
	try {
		const source = makeCanvas(400, 100);
		const out = composePageHeader(source, {
			title: '页面',
			backgroundColor: '#ffffff',
			textColor: '#1f1f1f',
			scale: 2,
		});
		assert.equal(out, source);
	} finally {
		globalThis.createEl = original;
	}
});

test('SVG_INLINE_PROPS: 覆盖导致环形图变黑/文字错位的关键属性', () => {
	for (const prop of [
		'fill', 'stroke', 'stroke-width', 'text-anchor',
		'font-weight', 'font-family', 'opacity', 'paint-order',
	]) {
		assert.ok(SVG_INLINE_PROPS.includes(prop), `缺少 ${prop}`);
	}
});

test('SVG_INLINE_PROPS: 无重复且每项均为合法的 kebab-case 属性名', () => {
	assert.equal(new Set(SVG_INLINE_PROPS).size, SVG_INLINE_PROPS.length);
	for (const prop of SVG_INLINE_PROPS) {
		assert.match(prop, /^[a-z]+(-[a-z]+)*$/);
	}
});
