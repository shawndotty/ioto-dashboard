import assert from 'node:assert/strict';
import test from 'node:test';
import moment from '../stubs/obsidian.mjs';
import { load } from '../data/helpers.mjs';

const { summarizeExtremes, formatHeatmapDay, presetOf } = await load(
	'../../src/dashboard/ui/heatmap-tools-model.ts',
);

function filter(overrides = {}) {
	return { min: null, max: null, hideMiss: false, ...overrides };
}

test('extreme summaries collapse ties into one ordered entry', () => {
	assert.deepEqual(summarizeExtremes([], 0), {
		firstKey: null,
		count: 0,
		keys: [],
	});
	assert.deepEqual(summarizeExtremes(['2026-11-14'], 7), {
		firstKey: '2026-11-14',
		count: 7,
		keys: ['2026-11-14'],
	});
	assert.deepEqual(
		summarizeExtremes(['2026-11-14', '2026-11-02', '2026-10-31'], 12),
		{
			firstKey: '2026-11-14',
			count: 12,
			keys: ['2026-11-14', '2026-11-02', '2026-10-31'],
		},
	);
});

test('presetOf recognizes the three presets with peak first', () => {
	const model = { peak: 12, averageActive: 3.2 };
	assert.equal(presetOf(filter({ min: 12, max: 12 }), model), 'peak');
	assert.equal(presetOf(filter({ min: 4 }), model), 'average');
	assert.equal(presetOf(filter({ min: 1 }), model), 'active');
	assert.equal(presetOf(filter({ min: 2 }), model), null);
	assert.equal(presetOf(filter({ min: 2, max: 4 }), model), null);
	assert.equal(presetOf(filter(), model), null);
});

test('presetOf edge cases: peak wins at 1, zero averages never match', () => {
	assert.equal(
		presetOf(filter({ min: 1, max: 1 }), { peak: 1, averageActive: 1 }),
		'peak',
	);
	assert.equal(
		presetOf(filter({ min: 1 }), { peak: 0, averageActive: 0 }),
		'active',
	);
	assert.equal(
		presetOf(filter({ min: 0, max: 0 }), { peak: 0, averageActive: 0 }),
		null,
	);
	assert.equal(
		presetOf(filter({ min: 3 }), { peak: 10, averageActive: 2.1 }),
		'average',
	);
});

test('formatHeatmapDay renders month and day without the year', () => {
	const previous = moment.locale();
	moment.locale('en');
	try {
		const text = formatHeatmapDay('2026-11-14');
		assert.equal(text, 'Nov 14');
		assert.equal(text.includes('2026'), false);
	} finally {
		moment.locale(previous);
	}
});
