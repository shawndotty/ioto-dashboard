import { t } from "../../../lang/helpers";
import {
	formatGeneratedAt,
	localDayKey,
	type AiMetricsRange,
	type AiRunsSnapshot,
} from "../../../services/ai-runs-source";

export function renderNoData(
	el: HTMLElement,
	textKey: Parameters<typeof t>[0] = "AI_METRICS_NO_DATA",
): void {
	el.addClass("ioto-ai-metrics");
	el.createDiv({
		cls: "ioto-ai-empty",
		text: t(textKey),
	});
}

/** 数据截至 …：generatedAt 缺失时不渲染这一行。 */
export function renderGeneratedAt(el: HTMLElement, snapshot: AiRunsSnapshot): void {
	if (typeof snapshot.generatedAt !== "number") return;
	const stamp = formatGeneratedAt(snapshot.generatedAt);
	if (!stamp) return;
	el.createDiv({
		cls: "ioto-ai-generated-at",
		text: t("AI_METRICS_GENERATED_AT", [stamp]),
	});
}

/** 统计范围标识：today 用快照日键、all 用窗口天数（windowDays 非 number 回退文案）。
 *  KPI 卡与 Agent 卡共用，文案与类名保持一致。 */
export function renderScope(
	el: HTMLElement,
	snapshot: AiRunsSnapshot,
	range: AiMetricsRange,
): void {
	const scope =
		range === "today"
			? t("AI_METRICS_SCOPE_TODAY", [localDayKey(snapshot.generatedAt)])
			: typeof snapshot.windowDays === "number"
				? t("AI_METRICS_SCOPE_ALL", [String(snapshot.windowDays)])
				: t("AI_METRICS_RANGE_ALL");
	el.createDiv({ cls: "ioto-ai-metric-scope", text: scope });
}

/** 数值行：value 为 undefined 时整行不渲染（旧桥文件缺字段时自动隐藏）。
 *  rowCls 加在整行上，供主指标等行级强调使用。 */
export function renderMetricRow(
	el: HTMLElement,
	label: string,
	value: string | undefined,
	rowCls?: string,
): void {
	if (value === undefined || value === "") return;
	const row = el.createDiv({
		cls: rowCls ? `ioto-ai-metric-row ${rowCls}` : "ioto-ai-metric-row",
	});
	row.createSpan({ cls: "ioto-ai-metric-label", text: label });
	row.createSpan({ cls: "ioto-ai-metric-value", text: value });
}
