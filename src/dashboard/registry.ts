import type {
	CountBasis,
	MetricRequest,
	MetricResult,
	ProjectProgressGroup,
} from "../metrics/types";
import { QUERY_TARGETS, type QueryDefinition, type QueryTarget } from "../query/types";
import type {
	Dataset,
	DatasetRequest,
	DataObject,
	MeasureId,
	ViewId,
} from "./dataset/types";
import type { DashboardComponentConfig } from "./types";

export type ComponentStatus = "loading" | "ready" | "empty" | "error";

export type ComponentSettingGroup = "data" | "display";

export type ComponentCategory =
	| "overview"
	| "analysis"
	| "navigation"
	| "action";

interface SettingBase {
	/** Hides the row when the predicate returns false. */
	when?(config: DashboardComponentConfig): boolean;
}

export type ComponentSetting = SettingBase &
	(
		| { key: "queryId"; kind: "query"; group: "data" }
		| {
				key: "basis";
				kind: "basis";
				group: "data";
				fallback: CountBasis;
		  }
		| {
				key: "limit";
				kind: "number";
				group: "data";
				min: number;
				max: number;
				step?: number;
				fallback: number;
		  }
		| {
				key: "title";
				kind: "text";
				group: "display";
				placeholderKey?: string;
		  }
		| {
				key: string;
				kind: "select";
				group: "data" | "display";
				labelKey: string;
				options: Array<{ value: string; labelKey: string }>;
				fallback: string;
				/** `options` keys land in `config.options`, everything else on config. */
				target?: "config" | "options";
		  }
		| {
				key: string;
				kind: "toggle";
				group: "display";
				labelKey: string;
				fallback: boolean;
				target?: "config" | "options";
		  }
		| {
				key: string;
				kind: "color";
				group: "display";
				labelKey: string;
				target?: "config" | "options";
		  }
	);

export interface ComponentRenderContext {
	config: DashboardComponentConfig;
	query: QueryDefinition | undefined;
	result: MetricResult | undefined;
	dataset?: Dataset;
	status: ComponentStatus;
	messageKey?: string;
	message?: string;
	editMode: boolean;
	openNote(path: string, line?: number): void;
	openProject(group: ProjectProgressGroup): void;
	/** Any vault file, not just Markdown. */
	openFile(path: string, line?: number): void;
	openFolder(path: string): void;
	revealInExplorer(path: string): void;
	/** Renders Markdown owned by the current view, so it unloads with the card. */
	renderMarkdown(el: HTMLElement, path: string): Promise<void>;
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
	category?: ComponentCategory;
	/** Query targets this component understands (picker hints). */
	objects?: DataObject[];
	/** Query types this component can consume; derived from `objects` when absent. */
	queryTargets?: QueryTarget[];
	views?: ViewId[];
	viewDefault?: ViewId;
	measureDefault?: MeasureId;
	defaultQueryId: string;
	createConfig(queryId: string): Partial<DashboardComponentConfig>;
	toMetricRequest?(
		config: DashboardComponentConfig,
		query?: QueryDefinition,
	): MetricRequest;
	/** Set on components that read the Dataset pipeline. */
	toDatasetRequest?(
		config: DashboardComponentConfig,
		query?: QueryDefinition,
	): DatasetRequest;
	/** Dataset emptiness; defaults to `dataset.total === 0`. */
	isEmptyDataset?(dataset: Dataset): boolean;
	/** `true` when the metric is valid but has nothing meaningful to show. */
	isEmpty(result: MetricResult): boolean;
	render(el: HTMLElement, ctx: ComponentRenderContext): void;
	/** Extra size constraints layered on top of the registry defaults. */
	size?: Partial<SizeBounds>;
	/** Declarative settings rendered by the inspector panel, in display order. */
	settings?: ComponentSetting[];
}

const OBJECT_TO_TARGETS: Record<DataObject, QueryTarget[]> = {
	task: ["task"],
	note: ["note"],
	file: ["file"],
	folder: ["folder"],
	project: ["task", "note"],
};

/** Query types a component accepts; explicit `queryTargets` wins over `objects`. */
export function queryTargetsFor(definition: ComponentDefinition): QueryTarget[] {
	const explicit = definition.queryTargets;
	if (explicit && explicit.length > 0) {
		const declared = new Set(explicit);
		return QUERY_TARGETS.filter((target) => declared.has(target));
	}
	const targets = new Set<QueryTarget>();
	for (const object of definition.objects ?? []) {
		for (const target of OBJECT_TO_TARGETS[object]) targets.add(target);
	}
	return QUERY_TARGETS.filter((target) => targets.has(target));
}

/**
 * Normalises one inspector input into a component patch. Pure (no DOM), so the
 * settings contract can be unit-tested; empty/invalid input returns `{}` and
 * leaves the stored value untouched.
 */
export function coerceSettingValue(
	setting: ComponentSetting,
	raw: unknown,
	queryIds: ReadonlySet<string>,
): Partial<DashboardComponentConfig> {
	switch (setting.kind) {
		case "query":
			return typeof raw === "string" && queryIds.has(raw)
				? { queryId: raw }
				: {};
		case "basis":
			return raw === "file" || raw === "section" ? { basis: raw } : {};
		case "number": {
			const parsed =
				typeof raw === "number"
					? raw
					: typeof raw === "string" && raw.trim() !== ""
						? Number(raw)
						: Number.NaN;
			if (!Number.isFinite(parsed)) return {};
			const clamped = Math.min(setting.max, Math.max(setting.min, parsed));
			return { limit: Math.round(clamped) };
		}
		case "text": {
			if (typeof raw !== "string") return {};
			const trimmed = raw.trim();
			return trimmed ? { title: trimmed } : { title: undefined };
		}
		case "select": {
			if (typeof raw !== "string") return {};
			if (!setting.options.some((option) => option.value === raw)) return {};
			return setting.target === "options"
				? { options: { [setting.key]: raw } }
				: ({
						[setting.key]: raw,
					} as Partial<DashboardComponentConfig>);
		}
		case "toggle": {
			if (typeof raw !== "boolean") return {};
			return setting.target === "options"
				? { options: { [setting.key]: raw } }
				: ({
						[setting.key]: raw,
					} as Partial<DashboardComponentConfig>);
		}
		case "color": {
			if (typeof raw !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw)) {
				return {};
			}
			return setting.target === "options"
				? { options: { [setting.key]: raw } }
				: ({
						[setting.key]: raw,
					} as Partial<DashboardComponentConfig>);
		}
	}
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
