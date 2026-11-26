import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { applyAiMetricsCompactLayout, AI_METRICS_LAYOUTS } = await load(
	'../../src/dashboard/ai-metrics-layout.ts'
);
const { createAiMetricsPage, AI_METRICS_PAGE_ID } = await load(
	'../../src/dashboard/types.ts'
);

/** 当前库那张手工调过的 6 卡页：6,6,3,3,3,3，保住「当日 / 最近7天」成对卡。 */
function currentLibraryPage() {
	return {
		id: AI_METRICS_PAGE_ID,
		name: 'AI 运行指标',
		rowHeight: 10,
		gap: 12,
		columns: 12,
		components: [
			{ id: 'a7', type: 'ai-runs-agents', queryId: '', w: 6, h: 12, title: '最近7天 Agent调用', options: { range: '7d' } },
			{ id: 'at', type: 'ai-runs-agents', queryId: '', w: 6, h: 12, title: '当日 Agent调用', options: { range: 'today' } },
			{ id: 'k7', type: 'ai-runs-kpi', queryId: '', w: 3, h: 12, title: '最近7天 AI运行' },
			{ id: 'kt', type: 'ai-runs-kpi', queryId: '', w: 3, h: 12, title: '当日 AI运行' },
			{ id: 'rc', type: 'ai-runs-recent', queryId: '', w: 3, h: 12, title: '运行明细' },
			{ id: 'fq', type: 'ai-runs-frequency', queryId: '', w: 3, h: 12, title: 'AI 使用频度' },
		],
	};
}

test('standard 5-card preset is compacted to A1 (4+8 / 4+4+4)', () => {
	const page = createAiMetricsPage('AI Metrics');
	const next = applyAiMetricsCompactLayout(page);
	assert.ok(next);
	assert.notEqual(next, page);
	assert.equal(next.rowHeight, 10);
	assert.equal(next.gap, 12);
	assert.deepEqual(next.components.map((c) => c.w), [4, 8, 4, 4, 4]);
	assert.deepEqual(next.components.map((c) => c.h), [19, 19, 17, 17, 17]);
	assert.deepEqual(AI_METRICS_LAYOUTS.standard5.w, [4, 8, 4, 4, 4]);
	assert.deepEqual(AI_METRICS_LAYOUTS.standard5.h, [19, 19, 17, 17, 17]);
	// 浅拷贝：组件对象是新的，原页保持预置值不被改写。
	assert.notEqual(next.components[0], page.components[0]);
	assert.equal(page.components[0].w, 4);
	assert.equal(page.components[0].h, 19);
});

test('current-library 6-card page keeps width/title, only corrects heights', () => {
	const page = currentLibraryPage();
	const next = applyAiMetricsCompactLayout(page);
	assert.ok(next);
	assert.deepEqual(next.components.map((c) => c.w), [6, 6, 3, 3, 3, 3]);
	assert.deepEqual(next.components.map((c) => c.h), [19, 19, 17, 17, 17, 17]);
	assert.deepEqual(next.components.map((c) => c.id), ['a7', 'at', 'k7', 'kt', 'rc', 'fq']);
	assert.deepEqual(next.components.map((c) => c.title), page.components.map((c) => c.title));
	assert.equal(next.components[0].options.range, '7d');
	assert.equal(next.components[1].options.range, 'today');
	assert.equal(next.rowHeight, 10);
	assert.equal(next.gap, 12);
});

test('unexpected page id or card type sequence returns null (fail-safe)', () => {
	const wrongId = currentLibraryPage();
	wrongId.id = 'page:not-ai-metrics';
	assert.equal(applyAiMetricsCompactLayout(wrongId), null);

	const unexpected = currentLibraryPage();
	unexpected.components[5].type = 'ai-runs-schedule';
	assert.equal(applyAiMetricsCompactLayout(unexpected), null);
});

test('re-applying to an already compacted page is idempotent', () => {
	const once = applyAiMetricsCompactLayout(currentLibraryPage());
	assert.ok(once);
	const twice = applyAiMetricsCompactLayout(once);
	assert.deepEqual(twice, once);
	// queryId / options 不丢。
	assert.equal(twice.components[0].queryId, '');
	assert.equal(twice.components[0].options.range, '7d');
	assert.equal(twice.components[2].title, '最近7天 AI运行');
});
