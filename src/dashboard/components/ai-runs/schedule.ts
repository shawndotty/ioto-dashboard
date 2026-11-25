import { setTooltip } from "obsidian";
import { t } from "../../../lang/helpers";
import {
	formatCount,
	formatDuration,
	formatGeneratedAt,
	toScheduleRows,
} from "../../../services/ai-runs-source";
import {
	projectSchedule,
	type ScheduleProjection,
	type ScheduleRow,
	type ScheduleRowOutcome,
} from "../../../services/ai-schedule-project";
import type {
	ComponentDefinition,
	ComponentRenderContext,
} from "../../registry";
import { renderGeneratedAt, renderNoData } from "./shared";

function clockOf(ts: number): string {
	const date = new Date(ts);
	if (Number.isNaN(date.getTime())) return "";
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const OUTCOME_KEYS: Record<ScheduleRowOutcome, Parameters<typeof t>[0]> = {
	fired: "AI_SCHEDULE_OUTCOME_FIRED",
	"no-op": "AI_SCHEDULE_OUTCOME_NOOP",
	failed: "AI_SCHEDULE_OUTCOME_FAILED",
	skipped: "AI_SCHEDULE_OUTCOME_SKIPPED",
	disabled: "AI_SCHEDULE_OUTCOME_DISABLED",
	missed: "AI_SCHEDULE_OUTCOME_MISSED",
	"pending-catchup": "AI_SCHEDULE_OUTCOME_PENDING_CATCHUP",
};

const OUTCOME_CLASS: Record<ScheduleRowOutcome, string> = {
	fired: "is-ok",
	"no-op": "is-ok",
	failed: "is-bad",
	missed: "is-bad",
	"pending-catchup": "is-warn",
	skipped: "is-muted",
	disabled: "is-muted",
};

const STATUS_KEYS = {
	ok: "AI_SCHEDULE_STATUS_OK",
	"daily-cap": "AI_SCHEDULE_STATUS_DAILY_CAP",
	unverified: "AI_SCHEDULE_STATUS_UNVERIFIED",
	"not-whitelisted": "AI_SCHEDULE_STATUS_NOT_WHITELISTED",
	missing: "AI_SCHEDULE_STATUS_MISSING",
	invalid: "AI_SCHEDULE_STATUS_INVALID",
	shadowed: "AI_SCHEDULE_STATUS_SHADOWED",
	disabled: "AI_SCHEDULE_STATUS_DISABLED",
} as const;

const STATUS_CLASS: Record<keyof typeof STATUS_KEYS, string> = {
	ok: "is-ok",
	"daily-cap": "is-warn",
	unverified: "is-warn",
	"not-whitelisted": "is-bad",
	missing: "is-bad",
	invalid: "is-bad",
	shadowed: "is-muted",
	disabled: "is-bad",
};

function renderRow(list: HTMLElement, row: ScheduleRow, ctx: ComponentRenderContext): void {
	const item = list.createDiv({ cls: "ioto-ai-schedule-row" });
	const body = item.createDiv({ cls: "ioto-ai-schedule-body" });
	const head = body.createDiv({ cls: "ioto-ai-schedule-main" });
	if (row.plannedAt > 0) {
		head.createSpan({ cls: "ioto-ai-schedule-time", text: clockOf(row.plannedAt) });
	} else {
		head.createSpan({ cls: "ioto-ai-schedule-time", text: t("AI_SCHEDULE_UNKNOWN_TIME") });
	}
	const title = head.createEl("a", {
		cls: "internal-link ioto-ai-schedule-title",
		text: row.title,
	});
	title.addEventListener("click", (event) => {
		event.preventDefault();
		ctx.openLink?.(row.path, undefined, false);
	});
	if (row.agent) {
		head.createSpan({ cls: "ioto-ai-badge ioto-ai-schedule-agent", text: row.agent });
	}
	if (row.trigger === "catch-up") {
		head.createSpan({
			cls: "ioto-ai-badge ioto-ai-schedule-badge is-muted",
			text: t("AI_SCHEDULE_OUTCOME_CATCHUP"),
		});
	}
	if (row.multiple && row.multiple > 1) {
		head.createSpan({
			cls: "ioto-ai-badge ioto-ai-schedule-badge is-muted",
			text: `×${row.multiple}`,
		});
	}
	const meta = body.createDiv({ cls: "ioto-ai-schedule-meta" });
	if (row.description) meta.createSpan({ text: row.description });
	if (row.durationMs !== undefined) {
		meta.createSpan({ text: formatDuration(row.durationMs) });
	}
	if (row.pendingCount !== undefined && row.pendingCount > 0) {
		meta.createSpan({
			text: t("AI_SCHEDULE_PENDING_ITEMS", [formatCount(row.pendingCount)]),
		});
	}
	const action = item.createDiv({ cls: "ioto-ai-schedule-status" });
	const warning = row.failureWarning;
	if (warning) {
		const badge = action.createSpan({
			cls: "ioto-ai-badge ioto-ai-schedule-badge is-warn",
			text: `${warning.failures}/${warning.threshold}`,
		});
		setTooltip(
			badge,
			t("AI_SCHEDULE_WARN_FAILURES", [
				String(warning.failures),
				String(warning.threshold),
			]),
			{ placement: "top" },
		);
		return;
	}
	if (row.outcome) {
		action.createSpan({
			cls: `ioto-ai-badge ioto-ai-schedule-badge ${OUTCOME_CLASS[row.outcome]}`,
			text: t(OUTCOME_KEYS[row.outcome]),
		});
		return;
	}
	const reasonTop = row.blockedBy === "global" ? "AI_SCHEDULE_BOARD_DISABLED" : STATUS_KEYS[row.status];
	action.createSpan({
		cls: `ioto-ai-badge ioto-ai-schedule-badge ${row.blockedBy === "global" ? "is-muted" : STATUS_CLASS[row.status]}`,
		text: t(reasonTop),
	});
}

function renderSection(
	el: HTMLElement,
	labelKey: Parameters<typeof t>[0],
	rows: ScheduleRow[],
	ctx: ComponentRenderContext,
	cls?: string,
): void {
	const section = el.createDiv({
		cls: cls ? `ioto-ai-schedule-section ${cls}` : "ioto-ai-schedule-section",
	});
	const header = section.createDiv({ cls: "ioto-ai-schedule-section-head" });
	header.createSpan({ cls: "ioto-ai-schedule-section-title", text: t(labelKey) });
	header.createSpan({ cls: "ioto-ai-schedule-count", text: formatCount(rows.length) });
	const list = section.createDiv({ cls: "ioto-ai-schedule-list" });
	for (const row of rows) renderRow(list, row, ctx);
}

function renderEmpty(el: HTMLElement, textKey: Parameters<typeof t>[0], projection?: ScheduleProjection): void {
	el.createDiv({ cls: "ioto-ai-empty", text: t(textKey) });
	if (projection) {
		const stamp = formatGeneratedAt(projection.generatedAt);
		if (stamp) {
			el.createDiv({
				cls: "ioto-ai-generated-at",
				text: t("AI_METRICS_GENERATED_AT", [stamp]),
			});
		}
	}
}

export const aiRunsScheduleComponent: ComponentDefinition = {
	type: "ai-runs-schedule",
	labelKey: "COMPONENT_AI_RUNS_SCHEDULE_NAME",
	descriptionKey: "COMPONENT_AI_RUNS_SCHEDULE_DESC",
	icon: "calendar-clock",
	category: "overview",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({
		queryId: "",
		options: { showBlocked: true },
		w: 6,
		h: 6,
	}),
	size: { minW: 3, minH: 4, maxH: 24 },
	isEmpty: () => false,
	settings: [
		{
			key: "showBlocked",
			kind: "toggle",
			group: "display",
			labelKey: "AI_SCHEDULE_SETTING_SHOW_BLOCKED",
			fallback: true,
			target: "options",
		},
		{
			key: "showSkipped",
			kind: "toggle",
			group: "display",
			labelKey: "AI_SCHEDULE_SETTING_SHOW_SKIPPED",
			fallback: false,
			target: "options",
		},
		{ key: "title", kind: "text", group: "display" },
	],
	render: (el, ctx) => {
		// 旧上游没有独立看板：继续用指标快照里的三数字摘要，不空白、不报错。
		const board = ctx.aiSchedule;
		if (!board) {
			const snapshot = ctx.aiRuns;
			if (!snapshot) {
				renderNoData(el);
				return;
			}
			const schedule = toScheduleRows(snapshot);
			el.addClass("ioto-ai-metrics", "ioto-ai-schedule");
			if (schedule.empty) {
				el.createDiv({
					cls: "ioto-ai-empty",
					text: t("AI_METRICS_SCHEDULE_NONE"),
				});
			} else {
				el.createDiv({
					cls: "ioto-ai-schedule-summary",
					text: t("AI_METRICS_SCHEDULE_SUMMARY", [
						formatCount(schedule.fired),
						formatCount(schedule.missing),
					]),
				});
				el.createDiv({
					cls: "ioto-ai-schedule-planned",
					text: t("AI_METRICS_SCHEDULE_PLANNED", [formatCount(schedule.planned)]),
				});
			}
			renderGeneratedAt(el, snapshot);
			return;
		}

		const projection = projectSchedule(board, Date.now(), {
			showSkipped: ctx.config.options?.showSkipped === true,
		});
		const showBlocked = ctx.config.options?.showBlocked !== false;
		el.addClass("ioto-ai-metrics", "ioto-ai-schedule");

		if (projection.noRules) {
			renderEmpty(el, "AI_SCHEDULE_BOARD_NONE", projection);
			return;
		}
		if (projection.emptyToday) {
			renderEmpty(el, "AI_SCHEDULE_BOARD_EMPTY_TODAY", projection);
			return;
		}

		const head = el.createDiv({ cls: "ioto-ai-schedule-head" });
		head.createDiv({
			cls: "ioto-ai-schedule-summary",
			text: t("AI_SCHEDULE_BOARD_SUMMARY", [
				formatCount(projection.summary.planned),
				formatCount(projection.summary.ran),
				formatCount(projection.summary.upcoming),
			]),
		});
		const stamp = clockOf(projection.generatedAt);
		if (stamp) {
			head.createDiv({
				cls: "ioto-ai-schedule-stamp",
				text: t("AI_METRICS_GENERATED_AT", [stamp]),
			});
		}
		if (projection.stale) {
			const stale = el.createDiv({ cls: "ioto-ai-schedule-banner is-warn" });
			stale.createSpan({
				text: t("AI_SCHEDULE_STALE", [formatGeneratedAt(projection.generatedAt)]),
			});
		} else if (!projection.enabled) {
			el.createDiv({
				cls: "ioto-ai-schedule-banner",
				text: t("AI_SCHEDULE_BOARD_DISABLED"),
			});
		}

		if (projection.ran.length > 0) {
			renderSection(el, "AI_SCHEDULE_SECTION_RAN", projection.ran, ctx);
		}
		if (projection.upcoming.length > 0) {
			renderSection(el, "AI_SCHEDULE_SECTION_UPCOMING", projection.upcoming, ctx);
			if (projection.moreUpcoming > 0) {
				el.createDiv({
					cls: "ioto-ai-schedule-more",
					text: t("AI_SCHEDULE_MORE", [formatCount(projection.moreUpcoming)]),
				});
			}
		}
		if (showBlocked && projection.blocked.length > 0) {
			renderSection(
				el,
				"AI_SCHEDULE_SECTION_BLOCKED",
				projection.blocked,
				ctx,
				"is-blocked",
			);
		}
		if (
			!projection.stale &&
			projection.enabled &&
			projection.allDone &&
			projection.upcoming.length === 0
		) {
			el.createDiv({
				cls: "ioto-ai-schedule-done",
				text: t("AI_SCHEDULE_BOARD_ALL_DONE"),
			});
		}
	},
};