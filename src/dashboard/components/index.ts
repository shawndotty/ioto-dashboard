import { projectProgressComponent } from "./project-progress";
import { kpiComponent } from "./kpi";
import { taskListComponent } from "./task-list";
import { noteListComponent } from "./note-list";
import { tableComponent } from "./table";
import { lineChartComponent } from "./line-chart";
import { barChartComponent } from "./bar-chart";
import { ComponentRegistry } from "../registry";

export function createComponentRegistry(): ComponentRegistry {
	const registry = new ComponentRegistry();
	registry.register(kpiComponent);
	registry.register(projectProgressComponent);
	registry.register(taskListComponent);
	registry.register(noteListComponent);
	registry.register(tableComponent);
	registry.register(lineChartComponent);
	registry.register(barChartComponent);
	return registry;
}
