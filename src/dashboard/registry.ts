import type {
	MetricRequest,
	MetricResult,
	ProjectProgressGroup,
} from "../metrics/types";
import type { QueryDefinition } from "../query/types";
import type { DashboardComponentConfig } from "./types";

export type ComponentStatus = "loading" | "ready" | "empty" | "error";

export interface ComponentRenderContext {
	config: DashboardComponentConfig;
	query: QueryDefinition | undefined;
	result: MetricResult | undefined;
	status: ComponentStatus;
	messageKey?: string;
	message?: string;
	editMode: boolean;
	openNote(path: string, line?: number): void;
	openProject(group: ProjectProgressGroup): void;
}

export interface ComponentDefinition {
	type: string;
	labelKey: string;
	descriptionKey: string;
	defaultQueryId: string;
	createConfig(queryId: string): Partial<DashboardComponentConfig>;
	toMetricRequest(config: DashboardComponentConfig): MetricRequest;
	/** `true` when the metric is valid but has nothing meaningful to show. */
	isEmpty(result: MetricResult): boolean;
	render(el: HTMLElement, ctx: ComponentRenderContext): void;
}

export const MIN_COMPONENT_W = 2;
export const MIN_COMPONENT_H = 1;
export const MAX_COMPONENT_W = 12;
export const MAX_COMPONENT_H = 6;

export function clampSize(w: number | undefined, h: number | undefined): {
	w: number;
	h: number;
} {
	return {
		w: Math.min(MAX_COMPONENT_W, Math.max(MIN_COMPONENT_W, w ?? 3)),
		h: Math.min(MAX_COMPONENT_H, Math.max(MIN_COMPONENT_H, h ?? 2)),
	};
}

export class ComponentRegistry {
	private definitions = new Map<string, ComponentDefinition>();

	register(definition: ComponentDefinition): void {
		this.definitions.set(definition.type, definition);
	}

	get(type: string): ComponentDefinition | undefined {
		return this.definitions.get(type);
	}

	list(): ComponentDefinition[] {
		return [...this.definitions.values()];
	}

	/** Unknown types render a placeholder card instead of breaking the panel. */
	placeholder(el: HTMLElement, type: string): void {
		el.createDiv({
			cls: "ioto-dashboard-card-placeholder",
			text: `Unknown component: ${type}`,
		});
	}
}
