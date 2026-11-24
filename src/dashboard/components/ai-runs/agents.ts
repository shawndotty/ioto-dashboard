import { t } from "../../../lang/helpers";
import {
	formatCount,
	formatDuration,
	formatPercent,
	toAgentSeries,
} from "../../../services/ai-runs-source";
import type { ComponentDefinition } from "../../registry";
import { renderGeneratedAt, renderNoData } from "./shared";

export const aiRunsAgentsComponent: ComponentDefinition = {
	type: "ai-runs-agents",
	labelKey: "COMPONENT_AI_RUNS_AGENTS_NAME",
	descriptionKey: "COMPONENT_AI_RUNS_AGENTS_DESC",
	icon: "bot",
	category: "overview",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({ queryId: "", w: 6, h: 4 }),
	size: { minW: 3, minH: 2, maxH: 12 },
	isEmpty: () => false,
	settings: [{ key: "title", kind: "text", group: "display" }],
	render: (el, ctx) => {
		const snapshot = ctx.aiRuns;
		if (!snapshot) {
			renderNoData(el);
			return;
		}
		const agents = toAgentSeries(snapshot);
		el.addClass("ioto-ai-metrics", "ioto-ai-agents");
		if (agents.length === 0) {
			el.createDiv({
				cls: "ioto-ai-empty",
				text: t("AI_METRICS_AGENTS_EMPTY"),
			});
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
		}
		renderGeneratedAt(el, snapshot);
	},
};
