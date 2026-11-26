import type { ComponentDefinition } from "../../registry";
import { aiRunsKpiComponent } from "./kpi";
import { aiRunsAgentsComponent } from "./agents";
import { aiRunsFrequencyComponent } from "./frequency";
import { aiRunsScheduleComponent } from "./schedule";
import { aiRunsRecentComponent } from "./recent";

export const aiMetricsComponents: ComponentDefinition[] = [
	aiRunsKpiComponent,
	aiRunsAgentsComponent,
	aiRunsFrequencyComponent,
	aiRunsScheduleComponent,
	aiRunsRecentComponent,
];

export {
	aiRunsKpiComponent,
	aiRunsAgentsComponent,
	aiRunsFrequencyComponent,
	aiRunsScheduleComponent,
	aiRunsRecentComponent,
};
