import { setIcon, setTooltip } from "obsidian";
import { t } from "../../../lang/helpers";
import {
	checklistDisplay,
	chooseExpanded,
	daysForRange,
	formatCount,
	formatDuration,
	formatRelativeTime,
	locateChecklistLine,
	sanitizeChecklistText,
	splitWikilinks,
	toRecentRuns,
} from "../../../services/ai-runs-source";
import type {
	ComponentDefinition,
	ComponentRenderContext,
} from "../../registry";
import { formatCompactNumber } from "./donuts";
import { renderGeneratedAt, renderNoData } from "./shared";

function timeOf(ts: number): string {
	const date = new Date(ts);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString();
}

/**
 * 把文本片段挂到正文节点：普通片段为纯文本节点，可解析的 wikilink 才是 <a>。
 * 全程 createSpan/createEl({text})，绝不 innerHTML/MarkdownRenderer（任务原文含字面 <br>）。
 */
function appendFragments(
	host: HTMLElement,
	raw: string,
	ctx: ComponentRenderContext,
): void {
	for (const fragment of splitWikilinks(raw)) {
		if (!fragment.target) {
			host.createSpan({ text: fragment.text });
			continue;
		}
		// subpath 首版只打开目标笔记、不定位段内锚点。
		const linktext = (fragment.target.split("#", 1)[0] ?? "").trim();
		const path = linktext ? ctx.resolveLink?.(linktext) ?? null : null;
		if (!path) {
			host.createSpan({ text: fragment.text });
			continue;
		}
		const link = host.createEl("a", {
			cls: "internal-link ioto-ai-recent-link",
			text: fragment.text,
		});
		link.addEventListener("click", (event) => {
			event.stopPropagation(); // 链接点击不触发展开
			event.preventDefault();
			ctx.openLink?.(path, undefined, false);
		});
	}
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
			// 正文：可点 wikilink + 点击展开全文；三种入口的事件严格分层（见 Research §4.4）。
			const textEl = body.createDiv({ cls: "ioto-ai-recent-text" });
			const initial = chooseExpanded(run);
			let expandedText = initial.text;
			let summaryOnly = initial.summaryOnly;
			let expanded = false;
			let loading = false;
			const paint = (raw: string, showSummaryHint: boolean): void => {
				textEl.empty();
				appendFragments(textEl, raw, ctx);
				if (showSummaryHint) {
					textEl.createSpan({
						cls: "ioto-ai-recent-summary-only",
						text: ` · ${t("AI_METRICS_RECENT_SUMMARY_ONLY")}`,
					});
				}
			};
			paint(expandedText, false);
			textEl.setAttribute("title", t("AI_METRICS_RECENT_EXPAND"));
			textEl.addEventListener("click", (event) => {
				const target = event.target as HTMLElement | null;
				if (target?.closest("a.ioto-ai-recent-link")) return;
				expanded = !expanded;
				textEl.toggleClass("is-expanded", expanded);
				textEl.setAttribute(
					"title",
					expanded
						? t("AI_METRICS_RECENT_COLLAPSE")
						: t("AI_METRICS_RECENT_EXPAND"),
				);
				if (!expanded) {
					paint(expandedText, false);
					return;
				}
				paint(expandedText, summaryOnly);
				// 上游已有不截断全文：无需回读任务文件。
				if (!summaryOnly || loading) return;
				const sourcePath = run.sourcePath;
				const line1 = run.line;
				if (!sourcePath || line1 === undefined) return;
				loading = true;
				void (async () => {
					const lines = await ctx.readNoteLines?.(sourcePath) ?? null;
					loading = false;
					// 视图切页/卡片卸载后丢弃回填，避免操作已 detached DOM。
					if (!textEl.isConnected || !expanded) return;
					if (lines) {
						const index = locateChecklistLine(lines, line1, run.checklistText);
						if (index >= 0) {
							// 原文行仍经本插件脱敏保底，凭据不因读原文而绕过。
							expandedText = checklistDisplay(
								sanitizeChecklistText(lines[index] ?? ""),
							);
							summaryOnly = false;
							paint(expandedText, false);
							return;
						}
					}
					// 老数据无来源/行号漂移：保留摘要并标注「仅摘要」。
					paint(expandedText, true);
				})();
			});
			// 回跳按钮仅在快照带来源字段时渲染，不留死链。
			if (run.sourcePath) {
				const sourcePath = run.sourcePath;
				const button = meta.createEl("button", {
					cls: "clickable-icon ioto-ai-recent-open-source",
					attr: {
						type: "button",
						"aria-label": t("AI_METRICS_RECENT_OPEN_SOURCE"),
					},
				});
				setIcon(button, "external-link");
				setTooltip(button, t("AI_METRICS_RECENT_OPEN_SOURCE"));
				button.addEventListener("click", (event) => {
					event.stopPropagation();
					const line1 = run.line;
					void (async () => {
						let line: number | undefined;
						if (line1 !== undefined) {
							const lines =
								await ctx.readNoteLines?.(sourcePath) ?? null;
							if (lines) {
								const index = locateChecklistLine(
									lines,
									line1,
									run.checklistText,
								);
								if (index >= 0) line = index;
							}
						}
						// 行号未命中则打开文件但不定位，绝不静默跳错行。
						ctx.openFile(sourcePath, line);
					})();
				});
			}
			const status = row.createDiv({ cls: "ioto-ai-recent-status" });
			status.createSpan({
				cls: `ioto-ai-badge ${run.exitCode === 0 ? "is-ok" : "is-bad"}`,
				text: run.exitCode === 0
					? t("AI_METRICS_EXIT_OK")
					: t("AI_METRICS_EXIT_FAILED"),
			});
		}
		renderGeneratedAt(el, snapshot);
	},
};
