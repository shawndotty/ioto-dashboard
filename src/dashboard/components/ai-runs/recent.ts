import { t } from "../../../lang/helpers";
import {
	formatDuration,
	toRecentRuns,
} from "../../../services/ai-runs-source";
import type { ComponentDefinition } from "../../registry";
import { renderGeneratedAt, renderNoData } from "./shared";

function timeOf(ts: number): string {
	const date = new Date(ts);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString();
}

export const aiRunsRecentComponent: ComponentDefinition = {
	type: "ai-runs-recent",
	labelKey: "COMPONENT_AI_RUNS_RECENT_NAME",
	descriptionKey: "COMPONENT_AI_RUNS_RECENT_DESC",
	icon: "list",
	category: "overview",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({ queryId: "", w: 8, h: 6 }),
	size: { minW: 3, minH: 2, maxH: 24 },
	isEmpty: () => false,
	settings: [{ key: "title", kind: "text", group: "display" }],
	render: (el, ctx) => {
		const snapshot = ctx.aiRuns;
		if (!snapshot) {
			renderNoData(el);
			return;
		}
		const runs = toRecentRuns(snapshot);
		el.addClass("ioto-ai-metrics", "ioto-ai-recent");
		if (runs.length === 0) {
			el.createDiv({
				cls: "ioto-ai-empty",
				text: t("AI_METRICS_RECENT_EMPTY"),
			});
			renderGeneratedAt(el, snapshot);
			return;
		}
		const list = el.createDiv({ cls: "ioto-ai-recent-list" });
		for (const run of runs) {
			const row = list.createDiv({ cls: "ioto-ai-recent-row" });
			const meta = row.createDiv({ cls: "ioto-ai-recent-meta" });
			meta.createSpan({ cls: "ioto-ai-recent-time", text: timeOf(run.timestamp) });
			meta.createSpan({ cls: "ioto-ai-recent-agent", text: run.agent });
			const duration = formatDuration(run.durationMs);
			if (duration) {
				meta.createSpan({
					cls: "ioto-ai-recent-duration",
					text: duration,
				});
			}
			meta.createSpan({
				cls:
					run.exitCode === 0
						? "ioto-ai-recent-ok"
						: "ioto-ai-recent-fail",
				text:
					run.exitCode === 0
						? t("AI_METRICS_EXIT_OK")
						: t("AI_METRICS_EXIT_FAILED"),
			});
			// wikilink 一律纯文本：用 text 属性创建文本节点，绝不用 innerHTML/markdown。
			row.createDiv({
				cls: "ioto-ai-recent-text",
				text: run.text,
			});
		}
		renderGeneratedAt(el, snapshot);
	},
};
