import {
	localDayKey,
	type ScheduleBoard,
	type ScheduleBoardEntry,
	type ScheduleBoardRule,
	type ScheduleOutcome,
	type ScheduleRuleStatus,
} from "./ai-schedule-source";

export type ScheduleRowOutcome = ScheduleOutcome | "missed" | "pending-catchup";

export interface ScheduleFailureWarning {
	failures: number;
	threshold: number;
}

export interface ScheduleRow {
	key: string;
	ruleId: string;
	path: string;
	title: string;
	spec: string;
	description: string;
	agent?: string;
	status: ScheduleRuleStatus;
	issueKey?: string | null;
	plannedAt: number;
	outcome?: ScheduleRowOutcome;
	/** 上游台账的跳过/失败人话原因（已渲染，仅作补充说明）。 */
	reason?: string;
	trigger?: "tick" | "catch-up";
	startedAt?: number;
	durationMs?: number;
	completed?: boolean;
	pendingCount?: number;
	/** 同一计划点命中多条台账（多次运行）时的条数。 */
	multiple?: number;
	failureWarning?: ScheduleFailureWarning;
	/** blocked 行：总开关关闭 或 规则状态不可运行。 */
	blockedBy?: "global" | "status";
}

export interface ScheduleProjection {
	day: string;
	enabled: boolean;
	stale: boolean;
	generatedAt: number;
	summary: {
		planned: number;
		ran: number;
		failed: number;
		skipped: number;
		upcoming: number;
	};
	/** 过去的计划点：fired / no-op / failed / skipped / disabled / missed / pending-catchup。 */
	ran: ScheduleRow[];
	/** 未来计划点（状态 ok 且总开关开启时才进入）。 */
	upcoming: ScheduleRow[];
	/** 今日不会再运行的规则（一规则一行）。 */
	blocked: ScheduleRow[];
	/** 被前 N 条折叠的数量。 */
	moreUpcoming: number;
	noRules: boolean;
	emptyToday: boolean;
	allDone: boolean;
}

export interface ProjectScheduleOptions {
	showSkipped?: boolean;
	upcomingLimit?: number;
}

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function baseRow(rule: ScheduleBoardRule, plannedAt: number): ScheduleRow {
	return {
		key: `${rule.id}@${plannedAt}`,
		ruleId: rule.id,
		path: rule.path,
		title: rule.title,
		spec: rule.spec,
		description: rule.description,
		...(rule.agent ? { agent: rule.agent } : {}),
		status: rule.status,
		...(rule.issueKey ? { issueKey: rule.issueKey } : {}),
		plannedAt,
	};
}

function failureWarningOf(
	rule: ScheduleBoardRule,
	threshold: number,
): ScheduleFailureWarning | undefined {
	if (rule.status !== "ok") return undefined;
	const limit = Math.max(1, threshold);
	if ((rule.consecutiveFailures ?? 0) < limit - 1) return undefined;
	return { failures: rule.consecutiveFailures ?? 0, threshold: limit };
}

/**
 * 归属算法（与 Plan-20261126-062553 §5.2 一致）：
 * 1. 每条规则按 `todayPlan + now` 切分过去/未来；
 * 2. 过去点按 `(ruleId, plannedAt)` 对齐台账，缺 `plannedAt` 的旧条目退化为
 *    「同规则 + 最近时间点（容差 = grace）」；
 * 3. 有台账 → 按 outcome 归入 ran；无台账 → 宽限内 pending-catchup，否则 missed；
 * 4. 未来点在规则不可运行或总开关关闭时进入 blocked（一规则一行）；
 * 5. 数据过期时不再把今日计划点标为「即将」，只保留历史行。
 */
export function projectSchedule(
	board: ScheduleBoard,
	now: number,
	options: ProjectScheduleOptions = {},
): ScheduleProjection {
	const showSkipped = options.showSkipped === true;
	const limit = Math.max(0, options.upcomingLimit ?? 6);
	const graceMs = Math.max(0, (finite(board.graceMinutes) ? board.graceMinutes : 0) * 60_000);
	const threshold = finite(board.failureThreshold) ? board.failureThreshold : 3;
	const stale = board.day !== localDayKey(now);
	const enabled = board.enabled === true;

	const entriesByRule = new Map<string, ScheduleBoardEntry[]>();
	for (const entry of board.today) {
		if (!entry || !finite(entry.plannedAt)) continue;
		const list = entriesByRule.get(entry.ruleId) ?? [];
		list.push(entry);
		entriesByRule.set(entry.ruleId, list);
	}
	for (const list of entriesByRule.values()) {
		list.sort((a, b) => a.plannedAt - b.plannedAt);
	}
	const used = new Set<ScheduleBoardEntry>();

	const takeEntry = (
		ruleId: string,
		point: number,
	): { entry?: ScheduleBoardEntry; multiple?: number } => {
		const list = entriesByRule.get(ruleId) ?? [];
		const exact = list.filter((entry) => !used.has(entry) && entry.plannedAt === point);
		if (exact.length > 0) {
			for (const entry of exact) used.add(entry);
			return {
				entry: exact[exact.length - 1],
				...(exact.length > 1 ? { multiple: exact.length } : {}),
			};
		}
		let nearest: ScheduleBoardEntry | undefined;
		let best = Number.POSITIVE_INFINITY;
		for (const entry of list) {
			if (used.has(entry)) continue;
			const distance = Math.abs(entry.plannedAt - point);
			if (distance <= graceMs && distance < best) {
				best = distance;
				nearest = entry;
			}
		}
		if (nearest) {
			used.add(nearest);
			return { entry: nearest };
		}
		return {};
	};

	const summary = { planned: 0, ran: 0, failed: 0, skipped: 0, upcoming: 0 };
	const ran: ScheduleRow[] = [];
	const blocked: ScheduleRow[] = [];
	const futureRows: ScheduleRow[] = [];

	for (const rule of board.rules) {
		const points = (Array.isArray(rule.todayPlan) ? rule.todayPlan : []).filter(finite);
		summary.planned += points.length;
		const past = points.filter((point) => point <= now);
		const future = points.filter((point) => point > now);
		const runnable = enabled && rule.status === "ok";
		const warning = failureWarningOf(rule, threshold);

		for (const point of past) {
			const { entry, multiple } = takeEntry(rule.id, point);
			const row = baseRow(rule, point);
			if (entry) {
				row.outcome = entry.outcome;
				row.trigger = entry.trigger;
				if (entry.startedAt !== undefined) row.startedAt = entry.startedAt;
				if (entry.durationMs !== undefined) row.durationMs = entry.durationMs;
				if (entry.completed !== undefined) row.completed = entry.completed;
				if (entry.pendingCount !== undefined) row.pendingCount = entry.pendingCount;
				if (entry.reason) row.reason = entry.reason;
				if (multiple) row.multiple = multiple;
				if (entry.outcome === "fired" || entry.outcome === "no-op") summary.ran += 1;
				if (entry.outcome === "failed") {
					summary.ran += 1;
					summary.failed += 1;
				}
				if (entry.outcome === "skipped" || entry.outcome === "disabled") {
					summary.skipped += 1;
					if (!showSkipped) continue;
				}
			} else {
				row.outcome = now <= point + graceMs ? "pending-catchup" : "missed";
			}
			ran.push(row);
		}

		if (points.length === 0) continue;
		summary.upcoming += future.length;
		if (!runnable) {
			blocked.push({
				...baseRow(rule, future[0] ?? rule.nextFireAt ?? 0),
				blockedBy: enabled ? "status" : "global",
			});
			continue;
		}
		if (stale) continue;
		for (const point of future) {
			futureRows.push({
				...baseRow(rule, point),
				...(warning ? { failureWarning: warning } : {}),
			});
		}
	}

	ran.sort((a, b) => a.plannedAt - b.plannedAt);
	futureRows.sort((a, b) => a.plannedAt - b.plannedAt);
	const upcoming = futureRows.slice(0, limit);
	const moreUpcoming = Math.max(0, futureRows.length - upcoming.length);

	return {
		day: board.day,
		enabled,
		stale,
		generatedAt: board.generatedAt,
		summary,
		ran,
		upcoming,
		blocked,
		moreUpcoming,
		noRules: board.rules.length === 0,
		emptyToday: board.rules.length > 0 && summary.planned === 0,
		allDone:
			enabled &&
			!stale &&
			summary.planned > 0 &&
			summary.ran > 0 &&
			summary.upcoming === 0,
	};
}