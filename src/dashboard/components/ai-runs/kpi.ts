import { t } from "../../../lang/helpers";
import {
	daysForRange,
	formatCount,
	formatDuration,
	toKpis,
	type AiMetricsRange,
} from "../../../services/ai-runs-source";
import type { ComponentDefinition } from "../../registry";
import {
	renderGeneratedAt,
	renderMetricRow,
	renderNoData,
	renderScope,
} from "./shared";

export const aiRunsKpiComponent: ComponentDefinition = {
	type: "ai-runs-kpi",
	labelKey: "COMPONENT_AI_RUNS_KPI_NAME",
	descriptionKey: "COMPONENT_AI_RUNS_KPI_DESC",
	icon: "activity",
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
		const kpi = toKpis(scoped);
		if (range === "today" && kpi.runs === 0) {
			renderNoData(el, "AI_METRICS_TODAY_EMPTY");
			return;
		}
		el.addClass("ioto-ai-metrics", "ioto-ai-kpi");
		const headline = el.createDiv({ cls: "ioto-ai-kpi-headline" });
		headline.createSpan({
			cls: "ioto-ai-kpi-value",
			text: formatCount(kpi.runs),
		});
		headline.createSpan({
			cls: "ioto-ai-kpi-caption",
			text: t("AI_METRICS_RUNS_TOTAL"),
		});
		if (kpi.underestimated) {
			headline.createSpan({
				cls: "ioto-ai-badge",
				text: t("AI_METRICS_UNDERESTIMATED"),
			});
		}

		renderMetricRow(
			el,
			t("AI_METRICS_SUCCEEDED"),
			formatCount(kpi.succeeded),
		);
		renderMetricRow(el, t("AI_METRICS_FAILED"), formatCount(kpi.failed));
		// 「输出 / 输入 / 总」三行分列，旧桥文件无 inputTokens 时后两行整行隐藏。
		renderMetricRow(
			el,
			t("AI_METRICS_OUTPUT_TOKENS"),
			formatCount(kpi.outputTokens),
		);
		renderMetricRow(
			el,
			t("AI_METRICS_INPUT_TOKENS"),
			kpi.inputTokens === undefined ? undefined : formatCount(kpi.inputTokens),
		);
		renderMetricRow(
			el,
			t("AI_METRICS_TOTAL_TOKENS"),
			kpi.totalTokens === undefined ? undefined : formatCount(kpi.totalTokens),
		);
		// 中位耗时为主指标（抗离群），均耗时降为辅助并标注「含个别长任务，仅供参考」。
		renderMetricRow(
			el,
			t("AI_METRICS_MEDIAN_DURATION"),
			formatDuration(kpi.medianDurationMs),
			"ioto-ai-metric-primary",
		);
		renderMetricRow(
			el,
			`${t("AI_METRICS_AVG_DURATION")} · ${t("AI_METRICS_AVG_DURATION_HINT")}`,
			formatDuration(kpi.avgDurationMs),
			"ioto-ai-metric-last", // 末行打标：CSS 去底边线（meta-row 加入后 :last-child 失效）
		);
		const meta = el.createDiv({ cls: "ioto-ai-meta-row" }); // 底部一行容器（两端对齐）
		renderScope(meta, snapshot, range); // el → meta
		renderGeneratedAt(meta, snapshot); // el → meta
	},
};
