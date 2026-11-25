import { App, normalizePath } from "obsidian";
import type { IotoSettings } from "./ioto-settings-services";

/**
 * 桥文件（`{IOTOFrameworkPath}/Dashboard/AI-Runs-Snapshot.md`）的唯一读取处。
 *
 * 所有新字段都按「存在才呈现」处理：上游白名单在 5/4 → 8/8 之间变动过，
 * 同一份桥文件也可能被不同版本运行态覆盖，因此投影对每个字段用可选链。
 */

export interface AiRunCounts {
	runs?: number;
	succeeded?: number;
	failed?: number;
	inputTokens?: number;
	outputTokens?: number;
	durationMs?: number;
	avgDurationMs?: number;
	medianDurationMs?: number;
}

export interface AiRunSchedules {
	planned?: number;
	fired?: number;
	missing?: number;
}

export interface AiRunDay {
	date: string;
	totals: AiRunCounts;
	byAgent: Record<string, AiRunCounts>;
	schedules?: AiRunSchedules;
}

export interface AiRunRecent {
	timestamp: number;
	agent: string;
	checklistText: string;
	exitCode: number | null;
	durationMs: number;
	/** true＝隔夜/长空闲导致开始时刻不可还原，durationMs=0 不代表真 0；旧桥文件缺此字段。 */
	durationUnknown?: boolean;
	/** 任务文件 vault 相对路径；上游 v281 新增，旧桥文件无。 */
	sourcePath?: string;
	/** checklist 行号，1-based（打开/读行须 −1）；上游 v281 新增。 */
	line?: number;
	/** 完整 checklist 原文（仅脱敏不截断）；上游 v281 新增。 */
	checklistTextFull?: string;
	/** true＝该条生成时无全文字段，checklistTextFull 实为摘要；上游 v281 新增。 */
	fullTextTruncated?: boolean;
}

export interface AiRunsSnapshot {
	schemaVersion: 1;
	generatedAt: number;
	windowDays?: number;
	days: AiRunDay[];
	recentRuns?: AiRunRecent[];
	usageUnderestimated?: boolean;
}

export interface KpiProjection {
	runs: number;
	succeeded: number;
	failed: number;
	outputTokens: number;
	inputTokens?: number;
	totalTokens?: number;
	/** 范围内总耗时：优先累加各日 totals.durationMs，缺字段时回退 avg × runs。 */
	totalDurationMs?: number;
	avgDurationMs?: number;
	medianDurationMs?: number;
	underestimated: boolean;
}

export interface AgentProjection {
	agent: string;
	runs: number;
	succeeded: number;
	failed: number;
	/** 0~1；总运行数为 0 时为 0。 */
	share: number;
	avgDurationMs?: number;
	medianDurationMs?: number;
	/** 绝对 token 数；仅当快照任一日 totals.inputTokens 有值时整组产出。 */
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	/** 0~1 占比；分母为 0 / 旧桥文件缺字段时不产出该键。 */
	inputShare?: number;
	outputShare?: number;
	totalShare?: number;
}

export interface DailyProjection {
	date: string;
	runs: number;
	outputTokens: number;
	avgDurationMs?: number;
}

export interface ScheduleProjection {
	planned: number;
	fired: number;
	missing: number;
	/** planned/fired/missing 全为 0：显示「暂无定时任务数据」而不是 0/0。 */
	empty: boolean;
}

export interface RecentProjection extends AiRunRecent {
	/** 已脱敏、仅作纯文本渲染的条目摘要。 */
	text: string;
	/** 展开候选全文：上游全文字段（脱敏后）或摘要；真实全文仍需按来源回读任务文件。 */
	textFull: string;
}

const CREDENTIAL_PATTERNS: RegExp[] = [
	/(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*\S+/gi,
	/bearer\s+[A-Za-z0-9._~-]+/gi,
	/\bsk-[A-Za-z0-9_-]{16,}/g,
];

/**
 * 脱敏凭据与 24+ 位 token 串；`[[...]]` 一律原样保留，由渲染层当纯文本处理。
 */
export function sanitizeChecklistText(raw: string): string {
	let text = raw.replace(/\d{24,}/g, "[redacted]");
	for (const pattern of CREDENTIAL_PATTERNS) {
		text = text.replace(pattern, "[redacted]");
	}
	return text.trim();
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 本地日键 `YYYY-MM-DD`，口径与上游 `metrics-aggregate.ts` 的 localDayKey 一致。 */
export function localDayKey(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isAiRunsSnapshot(raw: unknown): raw is AiRunsSnapshot {
	if (typeof raw !== "object" || raw === null) return false;
	const value = raw as Record<string, unknown>;
	return (
		value.schemaVersion === 1 &&
		typeof value.generatedAt === "number" &&
		Number.isFinite(value.generatedAt) &&
		Array.isArray(value.days)
	);
}

/** 聚合整个窗口的日汇总（旧桥文件缺新字段时对应指标自然缺席）。 */
export function toKpis(snapshot: AiRunsSnapshot): KpiProjection {
	let runs = 0;
	let succeeded = 0;
	let failed = 0;
	let outputTokens = 0;
	let inputTokens = 0;
	let hasInput = false;
	for (const day of snapshot.days) {
		const totals = day?.totals ?? {};
		runs += num(totals.runs) ?? 0;
		succeeded += num(totals.succeeded) ?? 0;
		failed += num(totals.failed) ?? 0;
		outputTokens += num(totals.outputTokens) ?? 0;
		const input = num(totals.inputTokens);
		if (input !== undefined) {
			hasInput = true;
			inputTokens += input;
		}
	}
	// 均耗时按 runs 加权还原整窗总耗时（daily avg × daily runs 可精确相加）；
	// 中位耗时没有可精确合并的口径，取各日中位数的中位数，与「总 token」同为整窗口径。
	let durationWeighted = 0;
	let runsWithDuration = 0;
	let totalDuration = 0;
	let hasTotalDuration = false;
	const dailyMedians: number[] = [];
	for (const day of snapshot.days) {
		const totals = day?.totals ?? {};
		const avg = num(totals.avgDurationMs);
		const median = num(totals.medianDurationMs);
		const dayRuns = num(totals.runs) ?? 0;
		if (avg !== undefined && dayRuns > 0) {
			durationWeighted += avg * dayRuns;
			runsWithDuration += dayRuns;
		}
		// 耗时三项同属「新桥文件」字段组：旧桥文件只有 durationMs 时整组隐藏，
		// 避免只显示总耗时、均/中位缺失的割裂呈现。
		if (dayRuns > 0 && (avg !== undefined || median !== undefined)) {
			const dayTotal = num(totals.durationMs);
			// 优先累加每日汇总；缺字段时回退 avg × runs；两者都无值则不产出该字段。
			const contribution =
				dayTotal ?? (avg !== undefined ? avg * dayRuns : undefined);
			if (contribution !== undefined) {
				totalDuration += contribution;
				hasTotalDuration = true;
			}
		}
		// 0 次运行的占位日 median=0，不能拉低整窗中位数。
		if (median !== undefined && dayRuns > 0) dailyMedians.push(median);
	}
	dailyMedians.sort((a, b) => a - b);
	const medianIndex = dailyMedians.length
		? Math.floor(dailyMedians.length / 2)
		: -1;
	return {
		runs,
		succeeded,
		failed,
		outputTokens,
		...(hasInput
			? { inputTokens, totalTokens: inputTokens + outputTokens }
			: {}),
		...(hasTotalDuration ? { totalDurationMs: totalDuration } : {}),
		...(runsWithDuration > 0
			? { avgDurationMs: durationWeighted / runsWithDuration }
			: {}),
		...(medianIndex >= 0
			? { medianDurationMs: dailyMedians[medianIndex] }
			: {}),
		underestimated: snapshot.usageUnderestimated === true,
	};
}

export type AiMetricsRange = "all" | "today";

/** 按范围筛出待聚合的 days；today 以快照生成日的本地日键为准。 */
export function daysForRange(
	snapshot: AiRunsSnapshot,
	range: AiMetricsRange,
): AiRunDay[] {
	if (range === "all") return snapshot.days;
	const key = localDayKey(snapshot.generatedAt);
	return snapshot.days.filter((day) => day?.date === key);
}

/** 按 agent 汇总调用次数/占比；耗时与 toKpis 同口径——整窗 runs 加权 + 各日中位数的中位数。 */
export function toAgentSeries(snapshot: AiRunsSnapshot): AgentProjection[] {
	const total = snapshot.days.reduce(
		(sum, day) => sum + (num(day?.totals?.runs) ?? 0),
		0,
	);
	const rows = new Map<string, AgentProjection>();
	// 累加器只作局部中间态，不进入 AgentProjection：avg 按 runs 加权还原整窗总耗时，
	// median 取各日中位数的中位数，均与 toKpis 完全一致，避免两卡口径再出分歧。
	const durationAcc = new Map<
		string,
		{ weighted: number; runsWithDuration: number; dailyMedians: number[] }
	>();
	// token 累加器同样只作中间态；分母按 Q5 取 days[].totals，不取 byAgent 求和，
	// 避免把未归属运行归一化掉。hasInput 决定输入/总三项是否产出（同 toKpis 口径）。
	const inAcc = new Map<string, number>();
	const outAcc = new Map<string, number>();
	let totalInput = 0;
	let totalOutput = 0;
	let hasInput = false;
	for (const day of snapshot.days) {
		const totals = day?.totals ?? {};
		const input = num(totals.inputTokens);
		if (input !== undefined) {
			hasInput = true;
			totalInput += input;
		}
		totalOutput += num(totals.outputTokens) ?? 0;
		for (const [agent, raw] of Object.entries(day?.byAgent ?? {})) {
			const runs = num(raw?.runs) ?? 0;
			inAcc.set(agent, (inAcc.get(agent) ?? 0) + (num(raw?.inputTokens) ?? 0));
			outAcc.set(agent, (outAcc.get(agent) ?? 0) + (num(raw?.outputTokens) ?? 0));
			const existing =
				rows.get(agent) ??
				({
					agent,
					runs: 0,
					succeeded: 0,
					failed: 0,
					share: 0,
				} satisfies AgentProjection);
			existing.runs += runs;
			existing.succeeded += num(raw?.succeeded) ?? 0;
			existing.failed += num(raw?.failed) ?? 0;
			const acc =
				durationAcc.get(agent) ??
				({ weighted: 0, runsWithDuration: 0, dailyMedians: [] } as {
					weighted: number;
					runsWithDuration: number;
					dailyMedians: number[];
				});
			const avg = num(raw?.avgDurationMs);
			const median = num(raw?.medianDurationMs);
			if (avg !== undefined && runs > 0) {
				acc.weighted += avg * runs;
				acc.runsWithDuration += runs;
			}
			// 0 次运行的占位日 median=0，不能拉低整窗中位数。
			if (median !== undefined && runs > 0) acc.dailyMedians.push(median);
			durationAcc.set(agent, acc);
			rows.set(agent, existing);
		}
	}
	const result = [...rows.values()].sort((a, b) => b.runs - a.runs);
	const ratio = (part: number, whole: number): number | undefined =>
		whole > 0 ? part / whole : undefined;
	for (const row of result) {
		row.share = total > 0 ? row.runs / total : 0;
		row.outputTokens = outAcc.get(row.agent) ?? 0;
		const outputShare = ratio(row.outputTokens, totalOutput);
		if (outputShare !== undefined) row.outputShare = outputShare;
		if (hasInput) {
			row.inputTokens = inAcc.get(row.agent) ?? 0;
			row.totalTokens = row.inputTokens + row.outputTokens;
			const inputShare = ratio(row.inputTokens, totalInput);
			if (inputShare !== undefined) row.inputShare = inputShare;
			const totalShare = ratio(row.totalTokens, totalInput + totalOutput);
			if (totalShare !== undefined) row.totalShare = totalShare;
		}
		const acc = durationAcc.get(row.agent);
		if (!acc) continue;
		if (acc.runsWithDuration > 0) {
			row.avgDurationMs = acc.weighted / acc.runsWithDuration;
		}
		if (acc.dailyMedians.length > 0) {
			acc.dailyMedians.sort((a, b) => a - b);
			row.medianDurationMs =
				acc.dailyMedians[Math.floor(acc.dailyMedians.length / 2)];
		}
	}
	return result;
}

export function toDailySeries(snapshot: AiRunsSnapshot): DailyProjection[] {
	return snapshot.days.map((day) => ({
		date: String(day?.date ?? ""),
		runs: num(day?.totals?.runs) ?? 0,
		outputTokens: num(day?.totals?.outputTokens) ?? 0,
		...(num(day?.totals?.avgDurationMs) !== undefined
			? { avgDurationMs: num(day?.totals?.avgDurationMs) }
			: {}),
	}));
}

export function toScheduleRows(snapshot: AiRunsSnapshot): ScheduleProjection {
	let planned = 0;
	let fired = 0;
	let missing = 0;
	for (const day of snapshot.days) {
		const schedules = day?.schedules ?? {};
		planned += num(schedules.planned) ?? 0;
		fired += num(schedules.fired) ?? 0;
		missing += num(schedules.missing) ?? 0;
	}
	return {
		planned,
		fired,
		missing,
		empty: planned === 0 && fired === 0 && missing === 0,
	};
}

export function toRecentRuns(snapshot: AiRunsSnapshot): RecentProjection[] {
	return (snapshot.recentRuns ?? []).map((run) => ({
		...run,
		text: sanitizeChecklistText(String(run?.checklistText ?? "")),
		textFull: sanitizeChecklistText(
			String(run?.checklistTextFull ?? run?.checklistText ?? ""),
		),
	}));
}

/** wikilink 拆分结果：target 缺席表示普通文本片段。 */
export interface TextFragment {
	text: string;
	target?: string;
}

/**
 * 把脱敏后的任务文本拆成「普通片段 + [[wikilink]] 片段」。
 * 只识别 `[[...]]`；`[[redacted]]` 与空目标降级为普通文本，绝不制造死链。
 */
export function splitWikilinks(text: string): TextFragment[] {
	const fragments: TextFragment[] = [];
	const pattern = /\[\[([^\]]+)\]\]/g;
	let cursor = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > cursor) fragments.push({ text: text.slice(cursor, index) });
		const inner = (match[1] ?? "").trim();
		const pipe = inner.indexOf("|");
		const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
		const display = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim();
		if (!target || target === "redacted" || !display) {
			fragments.push({ text: match[0] });
		} else {
			fragments.push({ text: display, target });
		}
		cursor = index + match[0].length;
	}
	if (cursor < text.length) fragments.push({ text: text.slice(cursor) });
	return fragments;
}

/**
 * 在任务文件行数组里定位 checklist 原文行。
 * `line1` 为上游 1-based 行号，返回 **0-based** 行号；probe（摘要前缀）用于校验行漂移。
 * 本行不中时在 ±3 邻域按距离由近及远找同前缀行；都不中返回 −1（打开文件但不定位）。
 */
export function locateChecklistLine(
	lines: string[],
	line1: number,
	probe: string,
): number {
	if (!probe || !Number.isFinite(line1)) return -1;
	const base = Math.trunc(line1) - 1;
	const offsets = [0, -1, 1, -2, 2, -3, 3];
	for (const offset of offsets) {
		const index = base + offset;
		if (index < 0 || index >= lines.length) continue;
		if (lines[index]?.includes(probe)) return index;
	}
	return -1;
}

/** 展开态正文：去 checklist 前缀、把字面 `<br>` 还原为换行，保持纯文本。 */
export function checklistDisplay(full: string): string {
	return full
		.replace(/^\s*-\s*\[[ xX]\]\s+/, "")
		.replace(/<br\s*\/?>/gi, "\n");
}

/**
 * 决定展开态先显示什么：新数据走上游全文字段；`fullTextTruncated` 或字段缺失
 * 则回退摘要并标注 summaryOnly，由渲染层按 sourcePath/line 异步回读任务文件覆盖。
 */
export function chooseExpanded(
	run: RecentProjection,
): { text: string; summaryOnly: boolean } {
	if (run.fullTextTruncated !== true && run.checklistTextFull) {
		return { text: run.textFull, summaryOnly: false };
	}
	return { text: run.textFull, summaryOnly: true };
}

/** 本地时间的可读文案，供「数据截至 …」使用。 */
export function formatGeneratedAt(ts: number): string {
	const date = new Date(ts);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleString();
}

export function formatCount(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

export function formatPercent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

export function formatDuration(ms?: number): string {
	const value = num(ms);
	if (value === undefined) return "";
	if (value < 1000) return `${Math.round(value)}ms`;
	if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
	// 先按秒取整再分解，避免 Math.round(秒余数)=60 造成「5m 60s」这类进位错误。
	const totalSec = Math.round(value / 1000);
	if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
	return `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m`;
}

/** 相对时间的四档文案；由渲染层注入 t()，默认中文便于纯函数单测直接断言。 */
export interface RelativeTimeLabels {
	justNow: string;
	minutes: string; // 含 {0}
	hours: string; // 含 {0}
	days: string; // 含 {0}
}

const DEFAULT_RELATIVE_LABELS: RelativeTimeLabels = {
	justNow: "刚刚",
	minutes: "{0}分钟前",
	hours: "{0}小时前",
	days: "{0}天前",
};

/**
 * 以快照 generatedAt 为基准的相对时间（绝不用 Date.now()，与 daysForRange 同口径）。
 * ts/baseTs 无效或 ts > baseTs 返回空串，渲染层据此省略该片段。
 */
export function formatRelativeTime(
	ts: number,
	baseTs: number,
	labels: RelativeTimeLabels = DEFAULT_RELATIVE_LABELS,
): string {
	if (!Number.isFinite(ts) || !Number.isFinite(baseTs) || ts > baseTs) return "";
	const diff = baseTs - ts;
	if (diff < 60_000) return labels.justNow;
	const fill = (template: string, value: number): string =>
		template.replace("{0}", String(value));
	if (diff < 3_600_000) return fill(labels.minutes, Math.floor(diff / 60_000));
	if (diff < 86_400_000) return fill(labels.hours, Math.floor(diff / 3_600_000));
	return fill(labels.days, Math.floor(diff / 86_400_000));
}

export interface AiRunsSourceOptions {
	app: App;
	getSettings: () => IotoSettings | null;
}

export class AiRunsSource {
	private snapshot: AiRunsSnapshot | null = null;
	private readonly listeners = new Set<() => void>();
	private reading: Promise<AiRunsSnapshot | null> | null = null;

	constructor(private readonly options: AiRunsSourceOptions) {}

	/** 相对库根的桥文件路径；IOTO FrameworkPath 未配置时返回 null。 */
	bridgePath(): string | null {
		const base = this.options.getSettings()?.IOTOFrameworkPath;
		if (typeof base !== "string" || base.trim() === "") return null;
		return `${normalizePath(base)}/Dashboard/AI-Runs-Snapshot.md`;
	}

	matchesPath(path: string): boolean {
		const bridge = this.bridgePath();
		if (!bridge) return false;
		return normalizePath(path) === normalizePath(bridge);
	}

	snapshotNow(): AiRunsSnapshot | null {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setSnapshot(next: AiRunsSnapshot | null): void {
		const prevAt = this.snapshot?.generatedAt;
		const nextAt = next?.generatedAt;
		if (this.snapshot === next) return;
		if (prevAt === nextAt && this.snapshot !== null && next !== null) return;
		this.snapshot = next;
		for (const listener of Array.from(this.listeners)) {
			try {
				listener();
			} catch (error) {
				console.warn("IOTO Dashboard: AI runs listener failed", error);
			}
		}
	}

	/** 读桥文件；任何失败都静默降级为 null（各卡显示「暂无数据」）。 */
	read(): Promise<AiRunsSnapshot | null> {
		if (this.reading) return this.reading;
		this.reading = this.performRead().finally(() => {
			this.reading = null;
		});
		return this.reading;
	}

	private async performRead(): Promise<AiRunsSnapshot | null> {
		const path = this.bridgePath();
		if (!path) {
			this.setSnapshot(null);
			return null;
		}
		try {
			const raw = await this.options.app.vault.adapter.read(path);
			const parsed: unknown = JSON.parse(raw);
			if (!isAiRunsSnapshot(parsed)) {
				this.setSnapshot(null);
				return null;
			}
			this.setSnapshot(parsed);
			return parsed;
		} catch {
			this.setSnapshot(null);
			return null;
		}
	}

	/** 轮询 / 手动刷新入口；与 read 共用去重，generatedAt 未变不广播。 */
	tick(): Promise<AiRunsSnapshot | null> {
		return this.read();
	}
}
