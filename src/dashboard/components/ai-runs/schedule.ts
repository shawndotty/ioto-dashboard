import { t } from "../../../lang/helpers";
import {
	formatCount,
	toScheduleRows,
} from "../../../services/ai-runs-source";
import type { ComponentDefinition } from "../../registry";
import { renderGeneratedAt, renderNoData } from "./shared";

export const aiRunsScheduleComponent: ComponentDefinition = {
	type: "ai-runs-schedule",
	labelKey: "COMPONENT_AI_RUNS_SCHEDULE_NAME",
	descriptionKey: "COMPONENT_AI_RUNS_SCHEDULE_DESC",
	icon: "calendar-clock",
	category: "overview",
	queryless: true,
	defaultQueryId: "",
	createConfig: () => ({ queryId: "", w: 4, h: 3 }),
	size: { minW: 3, minH: 2, maxH: 12 },
	isEmpty: () => false,
	settings: [{ key: "title", kind: "text", group: "display" }],
	render: (el, ctx) => {
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
				text: t("AI_METRICS_SCHEDULE_PLANNED", [
					formatCount(schedule.planned),
				]),
			});
		}
		renderGeneratedAt(el, snapshot);
	},
};
