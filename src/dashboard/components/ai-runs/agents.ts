import { t } from "../../../lang/helpers";
import {
	daysForRange,
	formatCount,
	toAgentSeries,
	toKpis,
	type AiMetricsRange,
} from "../../../services/ai-runs-source";
import type { ComponentDefinition } from "../../registry";
import { renderResponsiveChart } from "../../dataset/charts/chart-host";
import {
	buildAgentDonutSpec,
	formatCompactNumber,
	renderAgentLegend,
	type AgentMetric,
} from "./donuts";
import {
	renderGeneratedAt,
	renderNoData,
	renderScope,
} from "./shared";

export const aiRunsAgentsComponent: ComponentDefinition = {
	type: "ai-runs-agents",
	labelKey: "COMPONENT_AI_RUNS_AGENTS_NAME",
	descriptionKey: "COMPONENT_AI_RUNS_AGENTS_DESC",
	icon: "bot",
	category: "overview",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({ queryId: "", options: { range: "all" }, w: 6, h: 4 }),
	size: { minW: 3, minH: 4, maxH: 12 },
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
		const scoped = { ...snapshot, days: daysForRange(snapshot, range) };
		const agents = toAgentSeries(scoped);
		el.addClass("ioto-ai-metrics", "ioto-ai-agents");
		if (agents.length === 0) {
			renderNoData(
				el,
				range === "today" ? "AI_METRICS_TODAY_EMPTY" : "AI_METRICS_AGENTS_EMPTY",
			);
			renderGeneratedAt(el, snapshot);
			return;
		}
		const kpi = toKpis(scoped);
		// 四图共用一套 agent→颜色映射，取 toAgentSeries() 的稳定位置（按 runs 降序）。
		const colorIndexOf = new Map(agents.map((a, i) => [a.agent, i]));
		const getColor = (agent: string) => colorIndexOf.get(agent) ?? 0;

		const METRICS: Array<{
			key: "AI_METRICS_RUNS_TOTAL" | "AI_METRICS_INPUT_TOKENS" | "AI_METRICS_OUTPUT_TOKENS" | "AI_METRICS_TOTAL_TOKENS";
			metric: AgentMetric;
			total?: string;
		}> = [
			{ key: "AI_METRICS_RUNS_TOTAL", metric: "share", total: formatCount(kpi.runs) },
			{
				key: "AI_METRICS_INPUT_TOKENS",
				metric: "inputShare",
				total: kpi.inputTokens === undefined ? undefined : formatCompactNumber(kpi.inputTokens),
			},
			{ key: "AI_METRICS_OUTPUT_TOKENS", metric: "outputShare", total: formatCompactNumber(kpi.outputTokens) },
			{
				key: "AI_METRICS_TOTAL_TOKENS",
				metric: "totalShare",
				total: kpi.totalTokens === undefined ? undefined : formatCompactNumber(kpi.totalTokens),
			},
		];
		const grid = el.createDiv({ cls: "ioto-ai-donut-grid" });
		for (const entry of METRICS) {
			const cell = grid.createDiv({ cls: "ioto-ai-donut-cell" });
			cell.createDiv({ cls: "ioto-ai-donut-caption", text: t(entry.key) });
			if (entry.total === undefined) {
				// Q9: 旧桥文件缺 inputTokens 时显示占位，不画空环、不写 0%/NaN%。
				cell.createDiv({ cls: "ioto-ai-empty", text: t("AI_METRICS_NO_DATA") });
				continue;
			}
			const totalText = entry.total;
			const metric = entry.metric;
			renderResponsiveChart(
				cell,
				(size) => buildAgentDonutSpec(agents, metric, size, getColor, totalText),
				60,
				undefined,
				{ hasRows: true },
			);
		}
		renderAgentLegend(el, agents, getColor);
		renderScope(el, snapshot, range);
		renderGeneratedAt(el, snapshot);
	},
};
