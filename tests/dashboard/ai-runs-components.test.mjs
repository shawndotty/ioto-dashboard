import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { createComponentRegistry } = await load('../../src/dashboard/components/index.ts');
const { createAiMetricsPage, AI_METRICS_PAGE_ID } = await load('../../src/dashboard/types.ts');
const en = (await load('../../src/lang/locale/en.ts')).default;

const EXPECTED = [
	'ai-runs-kpi',
	'ai-runs-agents',
	'ai-runs-frequency',
	'ai-runs-schedule',
	'ai-runs-recent',
];

const registry = createComponentRegistry();

test('AI Metrics components are registered', () => {
	for (const type of EXPECTED) {
		assert.ok(registry.get(type), `missing component: ${type}`);
	}
});

test('AI Metrics components are queryless with no queryId', () => {
	for (const type of EXPECTED) {
		const def = registry.get(type);
		assert.equal(def.queryless, true, `${type} must be queryless`);
		assert.equal(def.defaultQueryId, '', `${type} defaultQueryId must be empty`);
		assert.equal(def.createConfig('ignored').queryId, '', `${type} config must not carry a queryId`);
	}
});

test('preset page carries the four AI Metrics components without queryId', () => {
	const page = createAiMetricsPage('AI Metrics');
	assert.equal(page.id, AI_METRICS_PAGE_ID);
	assert.deepEqual(page.components.map((component) => component.type), EXPECTED);
	for (const component of page.components) {
		assert.equal(component.queryId, '');
	}
	// A1 紧凑布局：rowHeight=10 是 h 值口径前提，每行 w 和恰为 12。
	assert.equal(page.rowHeight, 10);
	assert.equal(page.gap, 12);
	assert.deepEqual(page.components.map((c) => c.w), [4, 8, 4, 4, 4]);
	assert.deepEqual(page.components.map((c) => c.h), [19, 19, 17, 17, 17]);
});

test('preset AI Metrics page rows each fill all 12 columns', () => {
	const widths = createAiMetricsPage('AI Metrics').components.map((c) => c.w);
	assert.equal(widths[0] + widths[1], 12);
	assert.equal(widths[2] + widths[3] + widths[4], 12);
});

test('all locale keys used by AI Metrics components exist in en', () => {
	const keys = [
		'AI_METRICS_PAGE_NAME',
		'COMPONENT_AI_RUNS_KPI_NAME',
		'COMPONENT_AI_RUNS_KPI_DESC',
		'COMPONENT_AI_RUNS_AGENTS_NAME',
		'COMPONENT_AI_RUNS_AGENTS_DESC',
		'COMPONENT_AI_RUNS_FREQUENCY_NAME',
		'COMPONENT_AI_RUNS_FREQUENCY_DESC',
		'AI_FREQUENCY_AGENT_LINE',
		'AI_FREQUENCY_DAY_TOTAL',
		'AI_FREQUENCY_TOKEN_NA',
		'AI_FREQUENCY_AXIS_MAX',
		'COMPONENT_AI_RUNS_SCHEDULE_NAME',
		'COMPONENT_AI_RUNS_SCHEDULE_DESC',
		'COMPONENT_AI_RUNS_RECENT_NAME',
		'COMPONENT_AI_RUNS_RECENT_DESC',
		'AI_METRICS_NO_DATA',
		'AI_METRICS_GENERATED_AT',
		'AI_METRICS_UNDERESTIMATED',
		'AI_METRICS_UNDERESTIMATED_HINT_NO_COUNT',
		'AI_METRICS_RUNS_TOTAL',
		'AI_METRICS_SUCCEEDED',
		'AI_METRICS_FAILED',
	'AI_METRICS_OUTPUT_TOKENS',
	'AI_METRICS_INPUT_TOKENS',
	'AI_METRICS_TOTAL_TOKENS',
	'AI_METRICS_AVG_DURATION',
	'AI_METRICS_TOTAL_DURATION',
	'AI_METRICS_MEDIAN_DURATION',
	'AI_METRICS_SMALL_SAMPLE_HINT',
		'AI_METRICS_AGENT_AVG_DURATION',
		'AI_METRICS_AGENTS_EMPTY',
		'AI_METRICS_SCHEDULE_NONE',
		'AI_METRICS_SCHEDULE_SUMMARY',
		'AI_METRICS_SCHEDULE_PLANNED',
		'AI_METRICS_RECENT_EMPTY',
		'AI_METRICS_EXIT_OK',
		'AI_METRICS_EXIT_FAILED',
	];
	for (const key of keys) {
		assert.equal(typeof en[key], 'string', `en.${key} missing`);
		assert.ok(en[key].length > 0, `en.${key} empty`);
	}
});
