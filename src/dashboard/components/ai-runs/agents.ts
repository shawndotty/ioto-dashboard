import { t } from "../../../lang/helpers";
import {
	daysForRange,
	formatCount,
	formatDuration,
	formatPercent,
	toAgentSeries,
	type AiMetricsRange,
} from "../../../services/ai-runs-source";
import type { ComponentDefinition } from "../../registry";
import { renderGeneratedAt, renderNoData, renderScope } from "./shared";

export const aiRunsAgentsComponent: ComponentDefinition = {
	type: "ai-runs-agents",
	labelKey: "COMPONENT_AI_RUNS_AGENTS_NAME",
	descriptionKey: "COMPONENT_AI_RUNS_AGENTS_DESC",
	icon: "bot",
	category: "overview",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({ queryId: "", options: { range: "all" }, w: 6, h: 4 }),
	size: { minW: 3, minH: 2, maxH: 12 },
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
		const list = el.createDiv({ cls: "ioto-ai-agent-list" });
		for (const agent of agents) {
			const row = list.createDiv({ cls: "ioto-ai-agent-row" });
			row.createSpan({ cls: "ioto-ai-agent-name", text: agent.agent });
			row.createSpan({
				cls: "ioto-ai-agent-count",
				text: `${formatCount(agent.runs)} · ${formatPercent(agent.share)}`,
			});
			const duration = formatDuration(agent.avgDurationMs);
			if (duration) {
				row.createSpan({
					cls: "ioto-ai-agent-duration",
					text: `${t("AI_METRICS_AGENT_AVG_DURATION")} ${duration}`,
				});
			}
			const shares = (
				[
					["AI_METRICS_INPUT_TOKENS", agent.inputShare],
					["AI_METRICS_OUTPUT_TOKENS", agent.outputShare],
					["AI_METRICS_TOTAL_TOKENS", agent.totalShare],
				] as const
			)
				.filter(([, value]) => value !== undefined)
				.map(([key, value]) => `${t(key)} ${formatPercent(value!)}`)
				.join(" · ");
			if (shares) {
				row.createSpan({ cls: "ioto-ai-agent-token-shares", text: shares });
			}
		}
		renderScope(el, snapshot, range);
		renderGeneratedAt(el, snapshot);
	},
};
