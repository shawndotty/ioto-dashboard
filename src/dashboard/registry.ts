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
	TimelineBucket,
	ViewId,
} from "./dataset/types";
import type { TimelineSourceRef } from "./dataset/timeline";
import type { DashboardComponentConfig } from "./types";

export type ComponentStatus = "loading" | "ready" | "empty" | "error";

/** Everything the bucket detail modal needs; assembled by line and bar charts. */
export interface ChartBucketPayload {
	bucketKey: string;
	object: "task" | "note" | "file" | "project";
	cumulative: boolean;
	series: Array<{ key: string; label: string; value: number }>;
	refs: TimelineSourceRef[];
	relatedTotal: number;
	/** Only time buckets have one; project groups leave it empty. */
	bucket?: TimelineBucket;
	/** Timeline or project grouping; absent means timeline. */
	source?: "timeline" | "project";
}

export type ComponentSettingGroup =
	| "data"
	| "axes"
	| "axesX"
	| "axesY"
	| "display"
	| "style";

export type ComponentCategory =
	| "overview"
	| "analysis"
	| "navigation"
	| "action";

/** Inspector state a setting may depend on; absent means "no query resolved". */
export interface SettingContext {
	query?: QueryDefinition;
	config?: DashboardComponentConfig;
}

export interface SettingOption {
	value: string;
	labelKey: string;
}

interface SettingBase {
	/** Hides the row when the predicate returns false. */
	when?(config: DashboardComponentConfig, context?: SettingContext): boolean;
	/** Option keys whose values affect this row's options; drives inspector rebuilds. */
	refreshOn?: string[];
	/** Optional explanatory line rendered under the control. */
	hintKey?: string;
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
				key: string;
				kind: "number";
				group: ComponentSettingGroup;
				min: number;
				max: number;
				step?: number;
				fallback: number;
				/** Defaults to the limit label, used by the legacy `limit` row. */
				labelKey?: string;
				/** Numbers round to integers unless explicitly disabled. */
				integer?: boolean;
				/** `options` keys land in `config.options`, everything else on config. */
				target?: "config" | "options";
		  }
		| {
				key: string;
				kind: "text";
				group: ComponentSettingGroup;
				labelKey?: string;
				placeholderKey?: string;
				target?: "config" | "options";
		  }
		| {
				key: string;
				kind: "select";
				group: ComponentSettingGroup;
				labelKey: string;
				/** A function defers options to the current query (e.g. measures). */
				options:
					| SettingOption[]
					| ((context: SettingContext) => SettingOption[]);
				fallback: string;
				/** `options` keys land in `config.options`, everything else on config. */
				target?: "config" | "options";
		  }
		| {
				key: string;
				kind: "toggle";
				group: ComponentSettingGroup;
				labelKey: string;
				fallback: boolean;
				target?: "config" | "options";
		  }
		| {
				key: string;
				kind: "color";
				group: ComponentSettingGroup;
				labelKey: string;
				target?: "config" | "options";
		  }
		| {
				/** Dataset column picker; options come from the query's object. */
				key: string;
				kind: "field";
				group: ComponentSettingGroup;
				labelKey: string;
				role: "x" | "y";
				fallback: string;
				target?: "config" | "options";
		  }
		| {
				/** Column visibility checkboxes; options come from the query's object. */
				key: string;
				kind: "columns";
				group: ComponentSettingGroup;
				labelKey: string;
				target?: "options";
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
	openProjectTasks(group: ProjectProgressGroup, ratioBase: string): void;
	/** Any vault file, not just Markdown. */
	openFile(path: string, line?: number): void;
	/** Opens any vault file in a new tab; absent in hosts that cannot. */
	openFileInNewTab?(path: string, line?: number): void;
	openFolder(path: string): void;
	revealInExplorer(path: string): void;
	/** 按 Vault 实际节点类型分流：文件→新标签、文件夹→内容弹窗、缺失→Notice。 */
	openLink?(path: string, line: number | undefined, newTab: boolean): void;
	/** Opens the per-bucket detail list for a line chart point. */
	openChartBucket?(payload: ChartBucketPayload): void;
	/** Renders Markdown owned by the current view, so it unloads with the card. */
	renderMarkdown(el: HTMLElement, path: string): Promise<void>;
	/** Renders a fragment of Markdown owned by the current view (inline task text). */
	renderInlineMarkdown?(
		el: HTMLElement,
		markdown: string,
		sourcePath: string,
	): Promise<void>;
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
	isEmpty(result: MetricResult, config?: DashboardComponentConfig): boolean;
	render(el: HTMLElement, ctx: ComponentRenderContext): void;
	/** 在卡片头部标题右侧渲染组件级操作（如搜索入口）；加载/错误态与编辑态不调用。 */
	renderHeaderActions?(el: HTMLElement, ctx: ComponentRenderContext): void;
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
 * Writes one `config.options` key. `undefined` means "remove the key", which
 * makes the component fall back to its declared default.
 */
function optionPatch(
	key: string,
	value: string | number | boolean | undefined,
): Partial<DashboardComponentConfig> {
	return {
		options: { [key]: value },
	} as unknown as Partial<DashboardComponentConfig>;
}

type SelectSetting = Extract<ComponentSetting, { kind: "select" }>;

/** Static arrays pass through; function options resolve against the context. */
export function resolveSettingOptions(
	setting: SelectSetting,
	context: SettingContext = {},
): SettingOption[] {
	return typeof setting.options === "function"
		? setting.options(context)
		: setting.options;
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
	query?: QueryDefinition,
	config?: DashboardComponentConfig,
): Partial<DashboardComponentConfig> {
	switch (setting.kind) {
		case "query":
			return typeof raw === "string" && queryIds.has(raw)
				? { queryId: raw }
				: {};
		case "basis":
			return raw === "file" || raw === "section" ? { basis: raw } : {};
		case "number": {
			const target = setting.target === "options";
			const parsed =
				typeof raw === "number"
					? raw
					: typeof raw === "string" && raw.trim() !== ""
						? Number(raw)
						: Number.NaN;
			if (!Number.isFinite(parsed)) {
				// Clearing an option row falls back to the declared default.
				return target ? optionPatch(setting.key, undefined) : {};
			}
			const clamped = Math.min(setting.max, Math.max(setting.min, parsed));
			const value = setting.integer === false ? clamped : Math.round(clamped);
			return target
				? optionPatch(setting.key, value)
				: ({ [setting.key]: value } as Partial<DashboardComponentConfig>);
		}
		case "text": {
			if (typeof raw !== "string") return {};
			const trimmed = raw.trim();
			return setting.target === "options"
				? optionPatch(setting.key, trimmed || undefined)
				: ({ [setting.key]: trimmed || undefined } as Partial<DashboardComponentConfig>);
		}
		case "field": {
			if (typeof raw !== "string" || raw.trim() === "") return {};
			return setting.target === "options"
				? optionPatch(setting.key, raw)
				: ({ [setting.key]: raw } as Partial<DashboardComponentConfig>);
		}
		case "select": {
			if (typeof raw !== "string") return {};
			const options = resolveSettingOptions(setting, { query, config });
			if (!options.some((option) => option.value === raw)) return {};
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
		case "columns": {
			if (!Array.isArray(raw)) return {};
			const values = raw.filter(
				(value): value is string =>
					typeof value === "string" && value.trim().length > 0,
			);
			return setting.target === "options"
				? optionPatch(setting.key, values.join(",") || undefined)
				: {};
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
