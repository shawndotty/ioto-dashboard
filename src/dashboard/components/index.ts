import { projectProgressComponent } from "./project-progress";
import { kpiComponent } from "./kpi";
import { unfinishedTasksComponent } from "./unfinished-tasks";
import { ComponentRegistry } from "../registry";

export function createComponentRegistry(): ComponentRegistry {
	const registry = new ComponentRegistry();
	registry.register(kpiComponent);
	registry.register(projectProgressComponent);
	registry.register(unfinishedTasksComponent);
	return registry;
}
