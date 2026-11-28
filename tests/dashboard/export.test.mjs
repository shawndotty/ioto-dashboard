import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	buildExportFileName,
	buildExportHostClassNames,
	buildExportHostLayers,
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

test('buildExportHostClassNames: 非放大态逐字符等于既有实现（网格/整页零回归）', () => {
	const viewRootClass = 'ioto-custom-dashboard-view';
	assert.equal(
		buildExportHostClassNames(viewRootClass, false),
		`${viewRootClass} is-exporting ioto-dashboard-export-host`,
	);
	// 视图根带额外修饰类时原样透传，不丢不改。
	assert.equal(
		buildExportHostClassNames('ioto-custom-dashboard-view zen-mode', false),
		'ioto-custom-dashboard-view zen-mode is-exporting ioto-dashboard-export-host',
	);
});

test('buildExportHostClassNames: 放大态只带视图根与导出瞬时类，不再合写放大态类', () => {
	const stageClass = 'ioto-custom-dashboard-view ioto-dashboard-zoom__stage';
	const out = buildExportHostClassNames(stageClass, true);
	const tokens = out.split(/\s+/);
	for (const token of [
		'ioto-custom-dashboard-view',
		'is-exporting',
		'ioto-dashboard-export-host',
	]) {
		assert.ok(tokens.includes(token), `缺少 ${token}`);
	}
	assert.ok(
		!tokens.includes('ioto-dashboard-modal--component-zoom'),
		'放大态类改由分层函数承载，宿主不再合写',
	);
	assert.ok(
		!tokens.includes('ioto-dashboard-zoom__stage'),
		'舞台类改由分层函数承载，宿主不再合写',
	);
});

test('buildExportHostLayers: 非放大态无中间层（host > clone 单层结构不变）', () => {
	assert.deepEqual(buildExportHostLayers(false), []);
});

test('buildExportHostLayers: 放大态复刻 modal > stage 两层，卡片可作 stage 直接子元素', () => {
	const layers = buildExportHostLayers(true);
	assert.deepEqual(layers, [
		'ioto-dashboard-modal--component-zoom',
		'ioto-custom-dashboard-view ioto-dashboard-zoom__stage',
	]);
	const stageTokens = layers[1].split(/\s+/);
	assert.ok(stageTokens.includes('ioto-custom-dashboard-view'));
	assert.ok(stageTokens.includes('ioto-dashboard-zoom__stage'));
});

