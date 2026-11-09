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

export interface SizeBounds {
	minW: number;
	maxW: number;
	minH: number;
	maxH: number;
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
	/** Extra size constraints layered on top of the registry defaults. */
	size?: Partial<SizeBounds>;
}

export const MIN_COMPONENT_W = 2;
export const MIN_COMPONENT_H = 1;
export const MAX_COMPONENT_W = 12;
/** Global hard cap (24 rows ≈ 2004px); components may declare a lower cap. */
export const MAX_COMPONENT_H = 24;

export const DEFAULT_SIZE_BOUNDS: SizeBounds = {
	minW: MIN_COMPONENT_W,
	maxW: MAX_COMPONENT_W,
	minH: MIN_COMPONENT_H,
	maxH: MAX_COMPONENT_H,
};

export function clampSize(
	w: number | undefined,
	h: number | undefined,
	bounds: SizeBounds = DEFAULT_SIZE_BOUNDS,
): { w: number; h: number } {
	return {
		w: Math.min(bounds.maxW, Math.max(bounds.minW, w ?? 3)),
		h: Math.min(bounds.maxH, Math.max(bounds.minH, h ?? 2)),
	};
}

export function boundsForSizeOverride(
	override?: Partial<SizeBounds>,
): SizeBounds {
	return { ...DEFAULT_SIZE_BOUNDS, ...override };
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

/** Resolves the size bounds declared by a component type, defaulting to global. */
export function boundsForType(
	registry: ComponentRegistry,
	type: string,
): SizeBounds {
	return boundsForSizeOverride(registry.get(type)?.size);
}
