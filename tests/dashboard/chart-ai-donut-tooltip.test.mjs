import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buildAgentDonutSpec } = await load(
	'../../src/dashboard/components/ai-runs/donuts.ts',
);

/** 四指标 → hover 数值应取的绝对字段。 */
const FIELD = {
	share: 'runs',
	inputShare: 'inputTokens',
	outputShare: 'outputTokens',
	totalShare: 'totalTokens',
};
const METRICS = Object.keys(FIELD);

const AGENTS = [
	{
		agent: 'claude', runs: 95, share: 0.38,
		inputTokens: 250259157, inputShare: 0.44,
		outputTokens: 2000000, outputShare: 0.40,
		totalTokens: 252259157, totalShare: 0.43,
	},
	{
		agent: 'codebuddy', runs: 80, share: 0.32,
		inputTokens: 120000000, inputShare: 0.21,
		outputTokens: 1500000, outputShare: 0.30,
		totalTokens: 121500000, totalShare: 0.21,
	},
	{
		agent: 'gemini', runs: 50, share: 0.20,
		inputTokens: 100000000, inputShare: 0.18,
		outputTokens: 900000, outputShare: 0.18,
		totalTokens: 100900000, totalShare: 0.17,
	},
	{
		agent: 'gpt', runs: 25, share: 0.10,
		inputTokens: 95000000, inputShare: 0.17,
		outputTokens: 600000, outputShare: 0.12,
		totalTokens: 95600000, totalShare: 0.19,
	},
];

const SIZE = { w: 240, h: 160 };
const colorIndexOf = (agent) => AGENTS.findIndex((a) => a.agent === agent);
const build = (agents, metric) =>
	buildAgentDonutSpec(agents, metric, SIZE, colorIndexOf, '250M');

test('四环 slice.value 取绝对字段，且 interactive 打开', () => {
	for (const metric of METRICS) {
		const spec = build(AGENTS, metric);
		assert.ok(spec, `${metric} spec missing`);
		assert.equal(spec.interactive, true, `${metric} interactive 应为 true`);
		assert.equal(spec.slices.length, AGENTS.length, `${metric} 分片数`);
		const field = FIELD[metric];
		for (let i = 0; i < AGENTS.length; i += 1) {
			assert.equal(
				spec.slices[i].value,
				AGENTS[i][field],
				`${metric} slice[${i}].value 应为绝对字段 ${field}`,
			);
		}
	}
});

test('formatter 按指标切换：绝对值不被误当占比显示成 1', () => {
	assert.equal(build(AGENTS, 'share').formatValue(95), '95');
	assert.equal(build(AGENTS, 'share').formatValue(250259157), '250,259,157');
	// formatCompactNumber 在 >=10M 时用 toFixed(0)：实测 250259157 → "250M"（计划稿写 "250.3M" 系笔误）。
	for (const metric of ['inputShare', 'outputShare', 'totalShare']) {
		const spec = build(AGENTS, metric);
		assert.equal(spec.formatValue(95), '95', metric);
		assert.equal(spec.formatValue(250259157), '250M', metric);
	}
	for (const metric of METRICS) {
		const spec = build(AGENTS, metric);
		const formatted = spec.slices.map((s) => spec.formatValue(s.value));
		assert.ok(
			formatted.every((v) => v !== '1'),
			`${metric} tooltip 不应出现 formatCount(0.x) 的 "1"`,
		);
	}
});

test('占比闭合：末片到 2π，整数百分比之和为 100', () => {
	for (const metric of METRICS) {
		const spec = build(AGENTS, metric);
		assert.ok(
			Math.abs(spec.slices.at(-1).endAngle - Math.PI * 2) < 1e-9,
			`${metric} 末片应闭合到 2π`,
		);
		assert.equal(
			spec.slices.reduce((s, x) => s + x.integerPercent, 0),
			100,
			`${metric} 整数占比之和`,
		);
	}
});

test('几何不变：percent 仍按绝对值等比计算', () => {
	const spec = build(AGENTS, 'share');
	const total = AGENTS.reduce((s, a) => s + a.runs, 0);
	for (let i = 0; i < AGENTS.length; i += 1) {
		assert.ok(
			Math.abs(spec.slices[i].percent - AGENTS[i].runs / total) < 1e-9,
			`slice[${i}].percent 等比校验`,
		);
	}
});

test('>7 agent：「其他」片取剩余绝对值之和且 isOther', () => {
	const many = [
		...AGENTS,
		...Array.from({ length: 5 }, (_, i) => ({
			agent: `bot${i}`, runs: 10 - i, share: 0.01,
			inputTokens: 1000 + i, inputShare: 0.01,
			outputTokens: 500 + i, outputShare: 0.01,
			totalTokens: 1500 + i, totalShare: 0.01,
		})),
	];
	for (const metric of METRICS) {
		const field = FIELD[metric];
		const expected = many.slice(7).reduce((s, a) => s + a[field], 0);
		const other = build(many, metric).slices.find((s) => s.isOther);
		assert.ok(other, `${metric} 缺少「其他」片`);
		assert.equal(other.value, expected, `${metric}「其他」片聚合值`);
		assert.equal(other.bucketKey, 'other', `${metric}「其他」片 bucketKey`);
	}
});

test('旧桥文件缺 inputTokens：inputShare / totalShare 降级为 null，其余两环正常', () => {
	const legacy = AGENTS.map(
		({ inputTokens, inputShare, totalTokens, totalShare, ...rest }) => rest,
	);
	assert.equal(build(legacy, 'inputShare'), null);
	assert.equal(build(legacy, 'totalShare'), null);
	assert.ok(build(legacy, 'share'), 'share 环应仍可画');
	assert.ok(build(legacy, 'outputShare'), 'outputShare 环应仍可画');
});
