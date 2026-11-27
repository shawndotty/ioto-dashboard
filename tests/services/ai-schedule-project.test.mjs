import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../data/helpers.mjs';

const { projectSchedule } = await load('../../src/services/ai-schedule-project.ts');

function local(y, mo, d, h = 0, mi = 0) {
	return new Date(y, mo - 1, d, h, mi).getTime();
}

const NOW = local(2026, 11, 26, 12, 0);

function rule(over = {}) {
	return {
		id: 'r1',
		path: '3-任务/项目/每日同步.md',
		title: '每日同步',
		source: 'frontmatter',
		spec: 'daily 09:00',
		description: '每天 09:00',
		status: 'ok',
		issueKey: null,
		consecutiveFailures: 0,
		todayPlan: [local(2026, 11, 26, 9, 0)],
		...over,
	};
}

function board(over = {}) {
	return {
		schemaVersion: 1,
		generatedAt: NOW,
		day: '2026-11-26',
		enabled: true,
		maxPerDay: 3,
		graceMinutes: 30,
		failureThreshold: 3,
		rules: [rule()],
		today: [],
		...over,
	};
}

function entry(over = {}) {
	return {
		ruleId: 'r1',
		plannedAt: local(2026, 11, 26, 9, 0),
		trigger: 'tick',
		outcome: 'fired',
		...over,
	};
}

test('过去点按台账归属，未来点进入 upcoming 并受前 6 条限制', () => {
	const points = [];
	for (let i = 0; i < 10; i++) points.push(local(2026, 11, 26, 12, 30 + i));
	const projection = projectSchedule(
		board({
			rules: [rule({ id: 'r2', spec: 'every 5m', todayPlan: [local(2026, 11, 26, 9, 0), ...points] })],
			today: [entry({ ruleId: 'r2' })],
		}),
		NOW,
	);
	assert.equal(projection.summary.planned, 11);
	assert.equal(projection.summary.ran, 1);
	assert.equal(projection.upcoming.length, 6);
	assert.equal(projection.moreUpcoming, 4);
	assert.equal(projection.summary.upcoming, 10);
	assert.equal(projection.ran[0].outcome, 'fired');
});

test('no-op / failed / skipped 分别记账，showSkipped 控制 skipped 行', () => {
	const today = [
		entry({ plannedAt: local(2026, 11, 26, 9, 0), outcome: 'no-op' }),
		entry({ plannedAt: local(2026, 11, 26, 10, 0), outcome: 'failed' }),
		entry({ plannedAt: local(2026, 11, 26, 11, 0), outcome: 'skipped' }),
	];
	const b = board({
		rules: [rule({ todayPlan: today.map((e) => e.plannedAt) })],
		today,
	});
	const hidden = projectSchedule(b, NOW);
	assert.equal(hidden.summary.ran, 2); // fired/no-op + failed
	assert.equal(hidden.summary.failed, 1);
	assert.equal(hidden.summary.skipped, 1);
	assert.deepEqual(hidden.ran.map((r) => r.outcome), ['no-op', 'failed']);
	const shown = projectSchedule(b, NOW, { showSkipped: true });
	assert.deepEqual(shown.ran.map((r) => r.outcome), ['no-op', 'failed', 'skipped']);
});

test('无台账：宽限内为待补跑，超宽限为已错过', () => {
	const projection = projectSchedule(
		board({
			rules: [
				rule({
					todayPlan: [
						local(2026, 11, 26, 11, 45), // 15 分钟内 → pending
						local(2026, 11, 26, 9, 0), // 3 小时前 → missed
					],
				}),
			],
		}),
		NOW,
	);
	assert.deepEqual(projection.ran.map((r) => r.outcome), ['missed', 'pending-catchup']);
});

test('缺 plannedAt 的旧台账按容差就近对齐', () => {
	const projection = projectSchedule(
		board({
			today: [entry({ plannedAt: local(2026, 11, 26, 9, 5), trigger: 'catch-up' })],
		}),
		NOW,
	);
	assert.equal(projection.ran[0].outcome, 'fired');
	assert.equal(projection.ran[0].trigger, 'catch-up');
});

test('daily-cap 规则未来点不进入 upcoming，而进入 blocked', () => {
	const projection = projectSchedule(
		board({
			rules: [
				rule({
					status: 'daily-cap',
					todayPlan: [local(2026, 11, 26, 18, 0)],
				}),
			],
		}),
		NOW,
	);
	assert.equal(projection.upcoming.length, 0);
	assert.equal(projection.blocked.length, 1);
	assert.equal(projection.blocked[0].status, 'daily-cap');
	assert.equal(projection.blocked[0].blockedBy, 'status');
});

test('daily-cap 规则无未来点时不产生 blocked 幽灵行', () => {
	const projection = projectSchedule(
		board({
			rules: [rule({ status: 'daily-cap', todayPlan: [local(2026, 11, 26, 9, 0)] })],
			today: [entry()],
		}),
		NOW,
	);
	assert.equal(projection.blocked.length, 0);
	assert.equal(projection.ran.length, 1);
	assert.equal(projection.allDone, true);
});

test('blocked 按 plannedAt 升序，与 board.rules 顺序无关', () => {
	const projection = projectSchedule(
		board({
			rules: [
				rule({ id: 'late', status: 'daily-cap', todayPlan: [local(2026, 11, 26, 18, 0)] }),
				rule({ id: 'early', status: 'daily-cap', todayPlan: [local(2026, 11, 26, 15, 0)] }),
			],
		}),
		NOW,
	);
	assert.deepEqual(
		projection.blocked.map((r) => r.plannedAt),
		[local(2026, 11, 26, 15, 0), local(2026, 11, 26, 18, 0)],
	);
});

test('存在 blocked 时 allDone 为 false，不再与「全部完成」并存', () => {
	const projection = projectSchedule(
		board({
			rules: [
				rule({ id: 'done', todayPlan: [local(2026, 11, 26, 9, 0)] }),
				rule({ id: 'blocked', status: 'daily-cap', todayPlan: [local(2026, 11, 26, 18, 0)] }),
			],
			today: [entry({ ruleId: 'done' })],
		}),
		NOW,
	);
	assert.equal(projection.ran.length, 1);
	assert.equal(projection.blocked.length, 1);
	assert.equal(projection.upcoming.length, 0);
	assert.equal(projection.allDone, false);
});

test('总开关关闭：全部未来点 blocked，enabled=false', () => {
	const projection = projectSchedule(
		board({
			enabled: false,
			rules: [rule({ todayPlan: [local(2026, 11, 26, 18, 0)] })],
		}),
		NOW,
	);
	assert.equal(projection.enabled, false);
	assert.equal(projection.upcoming.length, 0);
	assert.equal(projection.blocked[0].blockedBy, 'global');
});

test('过期看板不再把今日点标为即将', () => {
	const projection = projectSchedule(
		board({
			day: '2026-11-25',
			rules: [rule({ todayPlan: [local(2026, 11, 26, 18, 0)] })],
		}),
		NOW,
	);
	assert.equal(projection.stale, true);
	assert.equal(projection.upcoming.length, 0);
	assert.equal(projection.blocked.length, 0);
});

test('连续失败预警：达到阈值-1 时挂到未来行', () => {
	const projection = projectSchedule(
		board({
			rules: [
				rule({
					consecutiveFailures: 2,
					todayPlan: [local(2026, 11, 26, 18, 0)],
				}),
			],
		}),
		NOW,
	);
	assert.equal(projection.upcoming[0].failureWarning?.failures, 2);
	assert.equal(projection.upcoming[0].failureWarning?.threshold, 3);
});

test('空态：无规则 vs 今日无计划', () => {
	const noRules = projectSchedule(board({ rules: [] }), NOW);
	assert.equal(noRules.noRules, true);
	const noToday = projectSchedule(
		board({ rules: [rule({ spec: 'weekly mon 09:00', todayPlan: [] })] }),
		NOW,
	);
	assert.equal(noToday.emptyToday, true);
});