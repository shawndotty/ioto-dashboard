import { t } from "../../../lang/helpers";
import {
	formatCount,
	formatDuration,
	formatPercent,
	type AgentProjection,
} from "../../../services/ai-runs-source";
import { arcPath, arcRatio } from "../../dataset/charts/geometry";
import {
	allocatePercents,
	type PieChartSpec,
	type PieSliceSpec,
} from "../../dataset/charts/pie-spec";
import type { ChartSize } from "../../dataset/charts/spec";

export type AgentMetric = "share" | "inputShare" | "outputShare" | "totalShare";

const TOP_AGENTS = 7;

/** 环心/图例 token 紧凑格式（250.3M / 1.2k），与 spec.ts:256 formatCompact 同口径。 */
export function formatCompactNumber(value: number): string {
	if (!Number.isFinite(value)) return "—";
	const abs = Math.abs(value);
	const trim = (n: number): string =>
		n.toFixed(n >= 10 ? 0 : 1).replace(/\.0$/, "");
	if (abs >= 1e9) return `${trim(value / 1e9)}B`;
	if (abs >= 1e6) return `${trim(value / 1e6)}M`;
	if (abs >= 1e3) return `${trim(value / 1e3)}k`;
	return String(Math.round(value));
}

/** hover tooltip 的数值口径：slice.value 存绝对值而非 0~1 占比（arcRatio 等比，几何不变）。 */
const METRIC_VALUE: Record<AgentMetric, {
	field: "runs" | "inputTokens" | "outputTokens" | "totalTokens";
	format: (n: number) => string;
}> = {
	share:       { field: "runs",         format: formatCount },
	inputShare:  { field: "inputTokens",  format: formatCompactNumber },
	outputShare: { field: "outputTokens", format: formatCompactNumber },
	totalShare:  { field: "totalTokens",  format: formatCompactNumber },
};

/**
 * 单个指标的环形 spec；totalText 为已格式化的环心总量；无可画分片返回 null 让 host 显示占位。
 * 颜色索引取 agent 在传入数组中的稳定位置（四图共用），不取环内分片位置。
 */
export function buildAgentDonutSpec(
	agents: AgentProjection[],
	metric: AgentMetric,
	size: ChartSize,
	colorIndexOf: (agent: string) => number,
	totalText: string,
): PieChartSpec | null {
	if (Math.min(size.w, size.h) < 60) return null;
	const raw = agents
		.map((a) => ({ agent: a.agent, value: a[METRIC_VALUE[metric].field] }))
		.filter((x): x is { agent: string; value: number } =>
			typeof x.value === "number" && x.value > 0);
	if (raw.length === 0) return null;

	// 前 7 用稳定索引色，其余合成「其他」灰片；颜色取 agent 的位置，不取环内位置。
	const shown = raw.slice(0, TOP_AGENTS);
	const rest = raw.slice(TOP_AGENTS);
	const total = raw.reduce((s, x) => s + x.value, 0);
	if (rest.length > 0) {
		shown.push({ agent: "other", value: rest.reduce((s, x) => s + x.value, 0) });
	}

	const center = { x: size.w / 2, y: size.h / 2 };
	const radius = Math.max(1, Math.min(size.w, size.h) / 2 - 8);
	const innerRadius = radius * 0.6;
	// 环心字号随内圈直径与字符数自适应；真机量测最宽 "266M" 约 0.685em/字符，留余量取 0.72。
	const innerDiameter = innerRadius * 2;
	const chars = Math.max(1, Array.from(totalText).length);
	const maxByWidth = innerDiameter / (chars * 0.72);
	const maxByHeight = innerDiameter * 0.40; // 两行总高 ≤ 内圈直径 80%
	const centerFontSize = Math.max(9, Math.min(26, Math.min(maxByWidth, maxByHeight)));
	const centerCaptionFontSize = Math.max(8, Math.min(13, centerFontSize * 0.6));
	const ints = allocatePercents(shown.map((x) => x.value));
	let cursor = 0;
	const slices: PieSliceSpec[] = shown.map((entry, i) => {
		const isOther = entry.agent === "other";
		const percent = arcRatio(entry.value, total);
		const startAngle = cursor;
		const endAngle = i === shown.length - 1
			? Math.PI * 2
			: cursor + percent * Math.PI * 2;
		cursor = endAngle;
		const idx = colorIndexOf(entry.agent);
		const cls = isOther
			? "ioto-chart-cat-other"
			: `ioto-chart-cat-${(idx % 8) + 1}`;
		return {
			label: isOther ? t("SETTING_PIE_OTHER") : entry.agent,
			value: entry.value,
			percent,
			integerPercent: ints[i] ?? 0,
			colorIndex: idx,
			className: cls,
			startAngle,
			endAngle,
			path: arcPath(center.x, center.y, radius, innerRadius, startAngle, endAngle),
			bucketKey: entry.agent,
			isOther,
		};
	});

	return {
		kind: "donut", width: size.w, height: size.h,
		ariaKey: "CHART_ARIA_DONUT",
		showLegend: false, valueList: null, hiddenCount: 0, extrasHeight: 0,
		interactive: true,
		center, radius, innerRadius, slices,
		labelMode: "none", formatValue: METRIC_VALUE[metric].format,
		valueLabelKey: "SETTING_PIE_TOTAL",
		totalText, totalLabelKey: "SETTING_PIE_TOTAL",
		centerFontSize, centerCaptionFontSize,
	};
}

const LEGEND_COLUMNS: ReadonlyArray<{
	key: "AI_METRICS_RUNS_TOTAL" | "AI_METRICS_INPUT_TOKENS" | "AI_METRICS_OUTPUT_TOKENS" | "AI_METRICS_TOTAL_TOKENS";
	metric: AgentMetric;
}> = [
	{ key: "AI_METRICS_RUNS_TOTAL", metric: "share" },
	{ key: "AI_METRICS_INPUT_TOKENS", metric: "inputShare" },
	{ key: "AI_METRICS_OUTPUT_TOKENS", metric: "outputShare" },
	{ key: "AI_METRICS_TOTAL_TOKENS", metric: "totalShare" },
];

/** 共享图例：行头色块+agent 名，四列整数占比，行尾均耗时；>7 个 agent 折叠出「其他」行。 */
export function renderAgentLegend(
	el: HTMLElement,
	agents: AgentProjection[],
	colorIndexOf: (agent: string) => number,
): void {
	const legend = el.createDiv({ cls: "ioto-ai-donut-legend" });
	const header = legend.createDiv({ cls: "ioto-ai-donut-legend-row is-header" });
	header.createSpan({
		cls: "ioto-ai-donut-legend-name",
		text: t("COMPONENT_AI_RUNS_AGENTS_NAME"),
	});
	for (const col of LEGEND_COLUMNS) {
		header.createSpan({ cls: "ioto-ai-donut-legend-value", text: t(col.key) });
	}
	header.createSpan({
		cls: "ioto-ai-donut-legend-duration",
		text: t("AI_METRICS_AGENT_AVG_DURATION"),
	});

	const shown = agents.slice(0, TOP_AGENTS);
	for (const agent of shown) {
		const row = legend.createDiv({ cls: "ioto-ai-donut-legend-row" });
		const name = row.createDiv({ cls: "ioto-ai-donut-legend-name" });
		const idx = colorIndexOf(agent.agent);
		name.createSpan({
			cls: `ioto-chart-legend-swatch ioto-chart-cat-${(idx % 8) + 1}`,
		});
		name.createSpan({ cls: "ioto-ai-donut-legend-label", text: agent.agent });
		for (const col of LEGEND_COLUMNS) {
			const value = agent[col.metric];
			row.createSpan({
				cls: "ioto-ai-donut-legend-value",
				text: typeof value === "number" ? formatPercent(value) : "—",
			});
		}
		row.createSpan({
			cls: "ioto-ai-donut-legend-duration",
			text: formatDuration(agent.avgDurationMs),
		});
	}

	if (agents.length > TOP_AGENTS) {
		const row = legend.createDiv({ cls: "ioto-ai-donut-legend-row is-other" });
		const name = row.createDiv({ cls: "ioto-ai-donut-legend-name" });
		name.createSpan({ cls: "ioto-chart-legend-swatch ioto-chart-cat-other" });
		name.createSpan({ cls: "ioto-ai-donut-legend-label", text: t("SETTING_PIE_OTHER") });
		for (const col of LEGEND_COLUMNS) {
			const missing = shown.some((a) => typeof a[col.metric] !== "number");
			const topSum = shown.reduce((sum, a) => sum + (a[col.metric] ?? 0), 0);
			row.createSpan({
				cls: "ioto-ai-donut-legend-value",
				text: missing
					? "—"
					: formatPercent(Math.max(0, 1 - topSum)),
			});
		}
		row.createSpan({ cls: "ioto-ai-donut-legend-duration", text: "" });
	}
}
