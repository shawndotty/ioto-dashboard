import { containerComponent } from "./container";
import { projectProgressComponent } from "./project-progress";
import { kpiComponent } from "./kpi";
import { taskListComponent } from "./task-list";
import { noteListComponent } from "./note-list";
import { timelineComponent } from "./timeline";
import { tableComponent } from "./table";
import { lineChartComponent } from "./line-chart";
import { heatmapComponent } from "./heatmap";
import { barChartComponent } from "./bar-chart";
import { donutChartComponent, pieChartComponent } from "./pie-chart";
import { scatterChartComponent } from "./scatter-chart";
import { treemapChartComponent } from "./treemap-chart";
import { markdownComponent } from "./markdown";
import { buttonComponent } from "./button";
import { baseComponent } from "./base";
import { ComponentRegistry } from "../registry";

export function createComponentRegistry(): ComponentRegistry {
	const registry = new ComponentRegistry();
	registry.register(containerComponent);
	registry.register(kpiComponent);
	registry.register(projectProgressComponent);
	registry.register(taskListComponent);
	registry.register(noteListComponent);
	registry.register(timelineComponent);
	registry.register(tableComponent);
	registry.register(lineChartComponent);
	registry.register(heatmapComponent);
	registry.register(barChartComponent);
	registry.register(pieChartComponent);
	registry.register(donutChartComponent);
	registry.register(scatterChartComponent);
	registry.register(treemapChartComponent);
	registry.register(markdownComponent);
	registry.register(buttonComponent);
	registry.register(baseComponent);
	return registry;
}
