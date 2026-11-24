import type { ComponentDefinition } from "../../registry";
import { aiRunsKpiComponent } from "./kpi";
import { aiRunsAgentsComponent } from "./agents";
import { aiRunsScheduleComponent } from "./schedule";
import { aiRunsRecentComponent } from "./recent";

export const aiMetricsComponents: ComponentDefinition[] = [
	aiRunsKpiComponent,
	aiRunsAgentsComponent,
	aiRunsScheduleComponent,
	aiRunsRecentComponent,
];

export {
	aiRunsKpiComponent,
	aiRunsAgentsComponent,
	aiRunsScheduleComponent,
	aiRunsRecentComponent,
};
