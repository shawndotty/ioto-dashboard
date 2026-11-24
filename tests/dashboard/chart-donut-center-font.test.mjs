import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { buildAgentDonutSpec } = await load(
	'../../src/dashboard/components/ai-runs/donuts.ts',
);
const { buildPieSpec } = await load(
	'../../src/dashboard/dataset/charts/pie-spec.ts',
);

const AGENTS = [
	{ agent: 'claude', runs: 3, share: 0.6 },
	{ agent: 'codebuddy', runs: 2, share: 0.4 },
];
const colorIndexOf = () => 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const make = (size, totalText) =>
	buildAgentDonutSpec(AGENTS, 'share', size, colorIndexOf, totalText);

test('small h=4 card: total font scales with inner diameter, caption clamped', () => {
	const spec = make({ w: 60, h: 60 }, '253M');
	assert.ok(spec);
	// radius≈22, innerRadius≈13.2, innerDiameter≈26.4, 4 chars → ≈9.2px（宽度约束主导）
	assert.ok(spec.centerFontSize >= 9 && spec.centerFontSize <= 12,
		`expected [9,12], got ${spec.centerFontSize}`);
	assert.equal(
		spec.centerCaptionFontSize,
		clamp(spec.centerFontSize * 0.6, 8, 13),
	);
});

test('wide card: total font clamps to the 26px ceiling', () => {
	const spec = make({ w: 200, h: 200 }, '253M');
	assert.ok(spec);
	assert.equal(spec.centerFontSize, 26);
});

test('more characters shrink the total font at the same size', () => {
	const many = make({ w: 60, h: 60 }, '1.23B');
	const one = make({ w: 60, h: 60 }, '5');
	assert.ok(many.centerFontSize <= one.centerFontSize,
		`"1.23B" (${many.centerFontSize}) should be <= "5" (${one.centerFontSize})`);
});

test('buildPieSpec donut omits both font fields (zero regression)', () => {
	const columns = [
		{ key: 'name', labelKey: 'DATASET_COL_NAME', type: 'text' },
		{ key: 'completed', labelKey: 'DATASET_COL_COMPLETED', type: 'number' },
	];
	const dataset = {
		object: 'project',
		measure: 'count',
		columns,
		rows: [{
			id: 'project:0',
			cells: {
				name: { text: 'A' },
				completed: { text: '1', sortValue: 1 },
			},
		}],
		total: 1,
		truncated: false,
	};
	const spec = buildPieSpec(dataset, {}, { w: 400, h: 300 }, 'project', 'donut');
	assert.ok(spec);
	assert.equal(spec.centerFontSize, undefined);
	assert.equal(spec.centerCaptionFontSize, undefined);
});
