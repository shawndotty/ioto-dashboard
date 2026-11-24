import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const {
	isAiRunsSnapshot,
	toKpis,
	daysForRange,
	toAgentSeries,
	toDailySeries,
	toScheduleRows,
	toRecentRuns,
	sanitizeChecklistText,
	localDayKey,
	formatCount,
	formatPercent,
	formatDuration,
	AiRunsSource,
} = await load('../../src/services/ai-runs-source.ts');

const NEW_BUCKET = (over = {}) => ({
	runs: 4,
	succeeded: 3,
	failed: 1,
	inputTokens: 1000,
	outputTokens: 200,
	durationMs: 4000,
	avgDurationMs: 1000,
	medianDurationMs: 900,
	...over,
});

function snapshot(over = {}) {
	return {
		schemaVersion: 1,
		generatedAt: 1795506036196,
		windowDays: 7,
		days: [
			{
				date: '2026-11-23',
				totals: NEW_BUCKET(),
				byAgent: { codebuddy: NEW_BUCKET(), qoder: NEW_BUCKET({ runs: 0, succeeded: 0, failed: 0 }) },
				schedules: { planned: 2, fired: 1, missing: 1 },
			},
		],
		recentRuns: [
			{
				timestamp: 1795506036126,
				agent: 'codebuddy',
				checklistText: '把结果写入 @[[Plan-20261124-153727]] token=1234567890123456789012345',
				exitCode: 0,
				durationMs: 185373,
			},
		],
		usageUnderestimated: true,
		...over,
	};
}

/** 旧桥文件：totals 5 字段、byAgent 4 字段，没有新投影字段。 */
function oldSnapshot() {
	return {
		schemaVersion: 1,
		generatedAt: 1795505542777,
		days: [
			{
				date: '2026-11-23',
				totals: {
					runs: 6,
					succeeded: 5,
					failed: 1,
					outputTokens: 204002,
					durationMs: 10302464,
				},
				byAgent: {
					qodercn: { runs: 6, succeeded: 5, failed: 1, outputTokens: 204002 },
				},
				schedules: { planned: 0, fired: 0, missing: 0 },
			},
		],
		recentRuns: [],
	};
}

test('isAiRunsSnapshot accepts both shapes, rejects bad schema/generatedAt/days', () => {
	assert.equal(isAiRunsSnapshot(snapshot()), true);
	assert.equal(isAiRunsSnapshot(oldSnapshot()), true);
	assert.equal(isAiRunsSnapshot({ schemaVersion: 2, generatedAt: 1, days: [] }), false);
	assert.equal(isAiRunsSnapshot({ schemaVersion: 1, generatedAt: 'x', days: [] }), false);
	assert.equal(isAiRunsSnapshot({ schemaVersion: 1, generatedAt: 1, days: {} }), false);
	assert.equal(isAiRunsSnapshot(null), false);
});

test('toKpis reads new fields and keeps output/total tokens distinct', () => {
	const result = toKpis(snapshot());
	assert.equal(result.runs, 4);
	assert.equal(result.outputTokens, 200);
	assert.equal(result.inputTokens, 1000);
	assert.equal(result.totalTokens, 1200);
	assert.equal(result.avgDurationMs, 1000);
	assert.equal(result.medianDurationMs, 900);
	assert.equal(result.underestimated, true);
});

test('toKpis ignores zero-run placeholder days when aggregating durations', () => {
	const result = toKpis(snapshot({
		days: [
			{
				date: '2026-11-21',
				totals: { runs: 0, outputTokens: 0, avgDurationMs: 0, medianDurationMs: 0 },
				byAgent: {},
			},
			{
				date: '2026-11-22',
				totals: NEW_BUCKET({ runs: 2, avgDurationMs: 1000, medianDurationMs: 900 }),
				byAgent: {},
			},
		],
	}));
	assert.equal(result.avgDurationMs, 1000);
	assert.equal(result.medianDurationMs, 900);
});

test('toKpis hides new fields on the 5/4 legacy bridge without undefined/NaN', () => {
	const result = toKpis(oldSnapshot());
	assert.equal(result.runs, 6);
	assert.equal(result.outputTokens, 204002);
	assert.equal('totalTokens' in result, false);
	assert.equal('avgDurationMs' in result, false);
	assert.equal('medianDurationMs' in result, false);
	for (const value of Object.values(result)) {
		assert.notEqual(value, undefined);
		assert.equal(Number.isNaN(value), false);
	}
});

test('toAgentSeries aggregates counts, computes share and keeps optional duration', () => {
	const rows = toAgentSeries(snapshot());
	assert.deepEqual(rows.map((row) => row.agent), ['codebuddy', 'qoder']);
	assert.equal(rows[0].runs, 4);
	assert.equal(rows[1].runs, 0);
	assert.ok(Math.abs(rows[0].share + rows[1].share - 1) < 1e-9);
	assert.equal(rows[0].avgDurationMs, 1000);
});

// 对齐真实桥文件 qodercn：11-18 runs=7 avg=1,368,305 median=489,553；
// 11-19 runs=5 avg=1,819,506 median=467,666。旧实现取「最后一天单日值」会得到 1,819,506。
const TWO_DAY_QODERCN = {
	days: [
		{
			date: '2026-11-18',
			totals: NEW_BUCKET(),
			byAgent: { qodercn: NEW_BUCKET({ runs: 7, avgDurationMs: 1_368_305, medianDurationMs: 489_553 }) },
		},
		{
			date: '2026-11-19',
			totals: NEW_BUCKET(),
			byAgent: { qodercn: NEW_BUCKET({ runs: 5, avgDurationMs: 1_819_506, medianDurationMs: 467_666 }) },
		},
	],
};

test('toAgentSeries weights avg across days', () => {
	const rows = toAgentSeries(snapshot(TWO_DAY_QODERCN));
	const q = rows.find((row) => row.agent === 'qodercn');
	// (1,368,305*7 + 1,819,506*5) / 12 ≈ 1,556,305.42，与 toKpis 整窗加权同口径。
	assert.ok(Math.abs(q.avgDurationMs - 1_556_305.42) < 1, `avg=${q.avgDurationMs}`);
});

test('toAgentSeries takes median of daily medians', () => {
	const rows = toAgentSeries(snapshot(TWO_DAY_QODERCN));
	const q = rows.find((row) => row.agent === 'qodercn');
	// 各日中位数的中位数：467,666 / 489,553 → floor(2/2)=1 → 489,553。
	assert.equal(q.medianDurationMs, 489_553);
});

test('toAgentSeries on legacy bridge has no duration fields', () => {
	const rows = toAgentSeries(oldSnapshot());
	assert.equal(rows.length, 1);
	assert.equal(rows[0].runs, 6);
	assert.equal('avgDurationMs' in rows[0], false);
	assert.equal('medianDurationMs' in rows[0], false);
});

test('toDailySeries and toScheduleRows cover trend and the 0/0 case', () => {
	const daily = toDailySeries(snapshot());
	assert.equal(daily.length, 1);
	assert.equal(daily[0].date, '2026-11-23');
	assert.equal(daily[0].runs, 4);

	assert.deepEqual(toScheduleRows(oldSnapshot()), {
		planned: 0,
		fired: 0,
		missing: 0,
		empty: true,
	});
	const busy = toScheduleRows(snapshot());
	assert.equal(busy.empty, false);
	assert.equal(busy.fired, 1);
	assert.equal(busy.missing, 1);
});

test('toRecentRuns sanitizes credentials and long digits but keeps wikilinks literal', () => {
	const rows = toRecentRuns(snapshot());
	const text = rows[0].text;
	assert.ok(text.includes('[[Plan-20261124-153727]]'), 'wikilink stays literal text');
	assert.ok(!text.includes('1234567890123456789012345'), '24+ digits redacted');
	assert.ok(text.includes('[redacted]'));
	assert.equal(rows[0].agent, 'codebuddy');
});

test('sanitizeChecklistText handles bearer/api-key patterns', () => {
	const text = sanitizeChecklistText('Bearer abcdefghij1234567890 api_key: sk-abcdefghijklmnopqrst');
	assert.ok(!text.includes('abcdefghij1234567890'));
	assert.ok(!text.includes('sk-abcdefghijklmnopqrst'));
});

test('localDayKey uses local calendar fields', () => {
	const d = new Date(2026, 10, 24, 23, 30);
	assert.equal(localDayKey(d.getTime()), '2026-11-24');
});

test('daysForRange: all returns the original days array unchanged', () => {
	const snap = snapshot();
	assert.deepEqual(daysForRange(snap, 'all'), snap.days);
});

test('daysForRange: today keeps only the snapshot generation day', () => {
	const today = localDayKey(snapshot().generatedAt);
	const snap = snapshot({
		days: [
			{ date: '2026-11-22', totals: NEW_BUCKET({ runs: 2 }), byAgent: {} },
			{ date: today, totals: NEW_BUCKET({ runs: 7 }), byAgent: {} },
			{ date: '2026-11-23', totals: NEW_BUCKET({ runs: 5 }), byAgent: {} },
		],
	});
	const scoped = daysForRange(snap, 'today');
	assert.equal(scoped.length, 1);
	assert.equal(scoped[0].date, today);
	assert.equal(toKpis({ ...snap, days: scoped }).runs, 7);
});

test('daysForRange: today with no matching day returns empty and KPI runs=0', () => {
	// fixture 的 days 只有 2026-11-23，generatedAt 是 2026-11-24。
	const snap = snapshot();
	const scoped = daysForRange(snap, 'today');
	assert.deepEqual(scoped, []);
	assert.equal(toKpis({ ...snap, days: scoped }).runs, 0);
});

test('daysForRange: today zero-run placeholder day yields runs=0 (not a row of zeros)', () => {
	const today = localDayKey(snapshot().generatedAt);
	const snap = snapshot({
		days: [
			{ date: '2026-11-22', totals: NEW_BUCKET({ runs: 9 }), byAgent: {} },
			{
				date: today,
				totals: { runs: 0, outputTokens: 0, avgDurationMs: 0, medianDurationMs: 0 },
				byAgent: {},
			},
		],
	});
	const scoped = daysForRange(snap, 'today');
	assert.equal(scoped.length, 1);
	assert.equal(toKpis({ ...snap, days: scoped }).runs, 0);
});

test('formatters produce readable, finite strings', () => {
	assert.equal(formatCount(1234567), '1,234,567');
	assert.equal(formatPercent(0.256), '26%');
	assert.equal(formatDuration(500), '500ms');
	assert.equal(formatDuration(1500), '1.5s');
	assert.equal(formatDuration(65_000), '1m 5s');
	assert.equal(formatDuration(3_600_000), '1h 0m');
	assert.equal(formatDuration(undefined), '');
});

test('formatDuration carries instead of emitting 60s / 60m', () => {
	assert.equal(formatDuration(359_932), '6m 0s', '秒余数进位，不能出现 60s');
	assert.equal(formatDuration(59_999_000), '16h 39m', '小时分支同样按秒取整，不能出现 60m');
});

function makeSource(raw, framework = '0-辅助/IOTO') {
	let notifies = 0;
	const source = new AiRunsSource({
		app: { vault: { adapter: { read: async () => raw } } },
		getSettings: () => (framework === null ? null : { IOTOFrameworkPath: framework }),
	});
	source.subscribe(() => { notifies += 1; });
	return { source, notifies: () => notifies };
}

test('AiRunsSource composes bridge path and matches normalized vault paths', async () => {
	const { source } = makeSource(JSON.stringify(snapshot()), '/0-辅助/IOTO/');
	assert.equal(source.bridgePath(), '0-辅助/IOTO/Dashboard/AI-Runs-Snapshot.md');
	assert.equal(source.matchesPath('0-辅助/IOTO/Dashboard/AI-Runs-Snapshot.md'), true);
	assert.equal(source.matchesPath('0-辅助/IOTO/Dashboard/Other.md'), false);
	assert.equal(makeSource('{}', null).source.bridgePath(), null);
});

test('AiRunsSource reads valid bridge, notifies only when generatedAt changes', async () => {
	const { source, notifies } = makeSource(JSON.stringify(snapshot()));
	const first = await source.read();
	assert.equal(first.generatedAt, 1795506036196);
	assert.equal(source.snapshotNow(), first);
	assert.equal(notifies(), 1);

	const again = await source.tick();
	assert.equal(again.generatedAt, first.generatedAt);
	assert.equal(notifies(), 1, 'unchanged generatedAt must not re-render');

	const newer = snapshot({ generatedAt: 1795506036999 });
	const raw = JSON.stringify(newer);
	(source.options.app.vault.adapter).read = async () => raw;
	const third = await source.read();
	assert.equal(third.generatedAt, 1795506036999);
	assert.equal(notifies(), 2);
});

test('AiRunsSource degrades silently on missing settings, bad JSON, wrong schema', async () => {
	const missing = makeSource('{}', null);
	assert.equal(await missing.source.read(), null);
	assert.equal(missing.source.snapshotNow(), null);

	const bad = makeSource('{not json');
	assert.equal(await bad.source.read(), null);

	const wrong = makeSource(JSON.stringify({ schemaVersion: 2, generatedAt: 1, days: [] }));
	assert.equal(await wrong.source.read(), null);
});

test('AiRunsSource reads the legacy 5/4 shape without throwing', async () => {
	const { source } = makeSource(JSON.stringify(oldSnapshot()));
	const result = await source.read();
	assert.equal(result.generatedAt, 1795505542777);
	assert.equal(toKpis(result).inputTokens, undefined);
});
