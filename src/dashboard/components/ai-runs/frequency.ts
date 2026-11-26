import { setTooltip } from "obsidian";
import { t } from "../../../lang/helpers";
import {
	formatCount,
	toAgentRunCounts,
	toFrequencyDays,
	type AiMetricsRange,
} from "../../../services/ai-runs-source";
import type { ComponentDefinition } from "../../registry";
import { allocatePercents } from "../../dataset/charts/pie-spec";
import { formatCompactNumber } from "./donuts";
import { renderGeneratedAt, renderNoData, renderScope } from "./shared";

/** 前 7 个 agent 用稳定色，其余折叠「其他」，与 donuts.ts:18 / Agent 卡同口径。 */
const TOP_AGENTS = 7;

function fill(template: string, value: string): string {
	return template.replace("{0}", value);
}

export const aiRunsFrequencyComponent: ComponentDefinition = {
	type: "ai-runs-frequency",
	labelKey: "COMPONENT_AI_RUNS_FREQUENCY_NAME",
	descriptionKey: "COMPONENT_AI_RUNS_FREQUENCY_DESC",
	icon: "hash",
	category: "overview",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({ queryId: "", options: { range: "all" }, w: 8, h: 6 }),
	size: { minW: 3, minH: 3, maxH: 24 },
	isEmpty: () => false,
	settings: [
		{
			key: "range",
			kind: "select",
			group: "data",
			labelKey: "SETTING_AI_METRICS_RANGE",
			options: [
				{ value: "all", labelKey: "AI_METRICS_RANGE_ALL" },
				{ value: "today", labelKey: "AI_METRICS_RANGE_TODAY" },
			],
			fallback: "all",
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	render: (el, ctx) => {
		const snapshot = ctx.aiRuns;
		if (!snapshot) {
			renderNoData(el);
			return;
		}
		const range: AiMetricsRange =
			ctx.config.options?.range === "today" ? "today" : "all";
		// 先加类：空态也带 ioto-ai-frequency（同 kpi.ts:54）。
		el.addClass("ioto-ai-metrics", "ioto-ai-frequency");
		const days = toFrequencyDays(snapshot, range);
		// 相对峰值标尺：track 宽 = 当天次数 / 峰值；无灰段、无满格底槽（右侧留白即「没用到的次数」）。
		const maxRuns = Math.max(0, ...days.map((d) => d.runs));
		// 颜色身份全局唯一：降序位置同时供顶部徽章与 bar 分色，禁止按当天局部重排。
		const agents = toAgentRunCounts(snapshot, range).filter(
			(row) => row.runs > 0,
		);
		const colorIndexOf = new Map(agents.map((row, i) => [row.agent, i]));
		if (days.length === 0) {
			renderNoData(
				el,
				range === "today" ? "AI_METRICS_TODAY_EMPTY" : "AI_METRICS_NO_DATA",
			);
			renderGeneratedAt(el, snapshot);
			return;
		}

		// 顶部 Agent 绝对次数行：颜色索引取按次数降序的稳定位置，与 Agent 卡互通。
		if (agents.length > 0) {
			const line = el.createDiv({ cls: "ioto-ai-frequency-agents" });
			line.createSpan({
				cls: "ioto-ai-frequency-agents-label",
				text: t("AI_FREQUENCY_AGENT_LINE"),
			});
			const shown = agents.slice(0, TOP_AGENTS);
			const rest = agents.slice(TOP_AGENTS);
			shown.forEach((row, index) => {
				const badge = line.createSpan({
					cls: `ioto-ai-badge ioto-chart-cat-${(index % 8) + 1}`,
					text: `${row.agent} ${formatCount(row.runs)}`,
				});
				setTooltip(
					badge,
					`${t("AI_FREQUENCY_AGENT_LINE")}: ${formatCount(row.runs)}`,
					{ placement: "top" },
				);
			});
			if (rest.length > 0) {
				line.createSpan({
					cls: "ioto-ai-badge ioto-chart-cat-other",
					text: t("SETTING_PIE_OTHER"),
				});
			}
			if (snapshot.usageUnderestimated) {
				// 沿用 KPI 卡的低估提示，不另造说辞。
				const badge = line.createSpan({
					cls: "ioto-ai-badge",
					text: t("AI_METRICS_UNDERESTIMATED"),
				});
				setTooltip(badge, t("AI_METRICS_UNDERESTIMATED_HINT_NO_COUNT"), {
					placement: "top",
				});
			}
		}

		// 主体逐日行：日期 / 比例条 / 次数 / 输入·输出·总 token，全程纯文本渲染。
		// track 宽 = 当天次数 / 全局峰值；段在条内按 agent 占比；右侧留白即「没用到的次数」（无灰段）。
		const list = el.createDiv({ cls: "ioto-ai-frequency-days" });
		for (const day of days) {
			const row = list.createDiv({ cls: "ioto-ai-frequency-day" });
			row.createSpan({ cls: "ioto-ai-frequency-date", text: day.date });
			const track = row.createDiv({ cls: "ioto-ai-frequency-bar-track" });
			// 长度即数值：峰值日 100%，其余按 runs/峰值缩短；右侧留白即「没用到的次数」。
			track.style.width = `${(day.runs / maxRuns) * 100}%`;

			// 段按全局 agent 顺序堆叠（非当天降序）：同一 agent 天天同槽位，保证左右对齐。
			const segs: Array<{ runs: number; label: string; cls: string }> = [];
			for (const [agent, idx] of colorIndexOf) {
				const seg = day.segments.find((s) => s.agent === agent);
				if (!seg) continue;
				const isOther = idx >= TOP_AGENTS;
				segs.push({
					runs: seg.runs,
					label: isOther ? t("SETTING_PIE_OTHER") : agent,
					cls: isOther ? "ioto-chart-cat-other" : `ioto-chart-cat-${(idx % 8) + 1}`,
				});
			}
			if (day.unattributed > 0) {
				segs.push({
					runs: day.unattributed,
					label: t("SETTING_PIE_OTHER"),
					cls: "ioto-chart-cat-other",
				});
			}
			// 段的分母 = 当天 runs，和严格 100% → 填满本条（已按峰值缩短的）track。
			const widths = allocatePercents(segs.map((s) => s.runs));
			segs.forEach((seg, i) => {
				const width = widths[i] ?? 0;
				if (width <= 0) return; // 极短段不建 0px 空节点
				const part = track.createDiv({
					cls: `ioto-ai-frequency-bar-seg ${seg.cls}`,
				});
				part.style.width = `${width}%`;
				setTooltip(part, `${seg.label}: ${formatCount(seg.runs)}`, {
					placement: "top",
				});
			});
			const detail = segs
				.map((s) => `${s.label}: ${formatCount(s.runs)}`)
				.join("\n");
			setTooltip(
				track,
				[
					fill(t("AI_FREQUENCY_DAY_TOTAL"), formatCount(day.runs)),
					detail,
					fill(t("AI_FREQUENCY_AXIS_MAX"), formatCount(maxRuns)),
				].join("\n"),
				{ placement: "top" },
			);
			row.createSpan({
				cls: "ioto-ai-frequency-count",
				text: formatCount(day.runs),
			});
			row.createSpan({
				cls: "ioto-ai-frequency-token is-input",
				text:
					day.inputTokens === undefined
						? t("AI_FREQUENCY_TOKEN_NA")
						: formatCompactNumber(day.inputTokens),
			});
			row.createSpan({
				cls: "ioto-ai-frequency-token is-output",
				text: formatCompactNumber(day.outputTokens),
			});
			row.createSpan({
				cls: "ioto-ai-frequency-token is-total",
				text:
					day.totalTokens === undefined
						? t("AI_FREQUENCY_TOKEN_NA")
						: formatCompactNumber(day.totalTokens),
			});
		}

		const meta = el.createDiv({ cls: "ioto-ai-meta-row" });
		renderScope(meta, snapshot, range);
		renderGeneratedAt(meta, snapshot);
	},
};
