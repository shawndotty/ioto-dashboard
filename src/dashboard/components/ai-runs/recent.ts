import { t } from "../../../lang/helpers";
import {
	daysForRange,
	formatCount,
	formatDuration,
	formatRelativeTime,
	toRecentRuns,
} from "../../../services/ai-runs-source";
import type { ComponentDefinition } from "../../registry";
import { formatCompactNumber } from "./donuts";
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
		// 今日汇总条：与 KPI 的 today 口径同源，缺字段时按片段省略，不留空洞。
		const today = daysForRange(snapshot, "today")[0]?.totals;
		if (today) {
			const present = (value: unknown): value is number =>
				typeof value === "number" && Number.isFinite(value);
			const n = today.runs;
			const s = today.succeeded;
			const f = today.failed;
			const o = today.outputTokens;
			if (present(n) && present(s) && present(f) && present(o)) {
				el.createDiv({
					cls: "ioto-ai-recent-summary",
					text: t("AI_METRICS_RECENT_SUMMARY", [
						formatCount(n),
						formatCount(s),
						formatCount(f),
						formatCompactNumber(o),
					]),
				});
			} else {
				const parts: string[] = [];
				if (present(n)) parts.push(`${t("AI_METRICS_RANGE_TODAY")} ${formatCount(n)} ${t("AI_METRICS_RUNS_TOTAL")}`);
				if (present(s)) parts.push(`${t("AI_METRICS_SUCCEEDED")} ${formatCount(s)}`);
				if (present(f)) parts.push(`${t("AI_METRICS_FAILED")} ${formatCount(f)}`);
				if (present(o)) parts.push(`${t("AI_METRICS_OUTPUT_TOKENS")} ${formatCompactNumber(o)}`);
				if (parts.length > 0) {
					el.createDiv({ cls: "ioto-ai-recent-summary", text: parts.join(" · ") });
				}
			}
		}
		const list = el.createDiv({ cls: "ioto-ai-recent-list" });
		const relativeLabels = {
			justNow: t("AI_METRICS_AGO_JUST_NOW"),
			minutes: t("AI_METRICS_AGO_MINUTES"),
			hours: t("AI_METRICS_AGO_HOURS"),
			days: t("AI_METRICS_AGO_DAYS"),
		};
		for (const run of runs) {
			// 两栏卡片：左栏正文，右栏状态 badge；badge 不再进 meta，位置才稳。
			const row = list.createDiv({ cls: "ioto-ai-recent-row" });
			const body = row.createDiv({ cls: "ioto-ai-recent-body" });
			const meta = body.createDiv({ cls: "ioto-ai-recent-meta" });
			meta.createSpan({ cls: "ioto-ai-recent-time", text: timeOf(run.timestamp) });
			const relative = formatRelativeTime(run.timestamp, snapshot.generatedAt, relativeLabels);
			if (relative) {
				meta.createSpan({ cls: "ioto-ai-recent-time", text: relative });
			}
			meta.createSpan({ cls: "ioto-ai-badge ioto-ai-recent-agent", text: run.agent });
			// durationUnknown 时 0ms 不代表真 0，显示「耗时未知」而不是误导性的 0ms。
			const duration =
				run.durationMs === 0 && run.durationUnknown === true
					? t("AI_METRICS_DURATION_UNKNOWN")
					: formatDuration(run.durationMs);
			if (duration) {
				meta.createSpan({ cls: "ioto-ai-recent-duration", text: duration });
			}
			// wikilink 一律纯文本：用 text 属性创建文本节点，绝不用 innerHTML/markdown。
			body.createDiv({
				cls: "ioto-ai-recent-text",
				text: run.text,
			});
			const status = row.createDiv({ cls: "ioto-ai-recent-status" });
			status.createSpan({
				cls: `ioto-ai-badge ${run.exitCode === 0 ? "ioto-ai-recent-ok" : "ioto-ai-recent-fail"}`,
				text: run.exitCode === 0
					? t("AI_METRICS_EXIT_OK")
					: t("AI_METRICS_EXIT_FAILED"),
			});
		}
		renderGeneratedAt(el, snapshot);
	},
};
