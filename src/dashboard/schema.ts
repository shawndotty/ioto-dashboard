import { MEASURE_IDS, VIEW_IDS } from "./dataset/types";
import { MAX_CONTAINER_DEPTH } from "./hierarchy";
import type {
	DashboardComponentConfig,
	DashboardPage,
} from "./types";

/** Load-time validators shared by `repository.normalize` and the import planner. */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isComponent(value: unknown): value is DashboardComponentConfig {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.type === "string" &&
		typeof value.queryId === "string"
	);
}

export function isPage(value: unknown): value is DashboardPage {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		Array.isArray(value.components)
	);
}

export function isQuery(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		(value.target === "note" ||
			value.target === "task" ||
			value.target === "file" ||
			value.target === "folder") &&
		isRecord(value.scope) &&
		isRecord(value.filters)
	);
}

const VIEW_SET = new Set<string>(VIEW_IDS);
const MEASURE_SET = new Set<string>(MEASURE_IDS);

export function toOptions(
	value: unknown,
): Record<string, string | number | boolean> | undefined {
	if (!isRecord(value)) return undefined;
	const options: Record<string, string | number | boolean> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (
			typeof raw === "string" ||
			typeof raw === "boolean" ||
			(typeof raw === "number" && Number.isFinite(raw))
		) {
			options[key] = raw;
		}
	}
	return Object.keys(options).length > 0 ? options : undefined;
}

const LEGACY_COMPONENT_TYPES: Record<string, string> = {
	"unfinished-tasks": "task-list",
};

/** Whitelists stored fields so unknown/dirty keys never survive a load. */
export function toComponent(
	value: unknown,
	depth = 0,
): DashboardComponentConfig | null {
	if (!isComponent(value)) return null;
	const legacyType = LEGACY_COMPONENT_TYPES[value.type];
	const component: DashboardComponentConfig = {
		id: value.id,
		type: legacyType ?? value.type,
		queryId: value.queryId,
	};
	if (value.basis === "file" || value.basis === "section") {
		component.basis = value.basis;
	}
	if (typeof value.limit === "number" && Number.isFinite(value.limit)) {
		component.limit = value.limit;
	}
	if (typeof value.title === "string") component.title = value.title;
	if (typeof value.view === "string" && VIEW_SET.has(value.view)) {
		component.view = value.view as DashboardComponentConfig["view"];
	}
	if (
		!legacyType &&
		typeof value.measure === "string" &&
		MEASURE_SET.has(value.measure)
	) {
		component.measure = value.measure as DashboardComponentConfig["measure"];
	}
	const options = toOptions(value.options);
	if (options) component.options = options;
	for (const axis of ["x", "y", "w", "h"] as const) {
		const raw = value[axis];
		if (typeof raw === "number" && Number.isFinite(raw)) {
			component[axis] = raw;
		}
	}
	// Only the page level keeps children; deeper nesting is dropped on load.
	if (Array.isArray(value.children) && depth < MAX_CONTAINER_DEPTH) {
		const children = value.children
			.map((child) => toComponent(child, depth + 1))
			.filter((item): item is DashboardComponentConfig => item !== null);
		if (children.length > 0) component.children = children;
	}
	return component;
}

export function uniqueId(base: string, taken: Set<string>): string {
	if (!taken.has(base)) return base;
	let index = 2;
	let candidate = `${base}-${index}`;
	while (taken.has(candidate)) {
		index += 1;
		candidate = `${base}-${index}`;
	}
	return candidate;
}

export function slugOf(value: string): string {
	const slug = value.replace(/[^A-Za-z0-9_-]/g, "-");
	return slug.length > 0 ? slug : "dashboard";
}

export function toPage(
	value: unknown,
	defaultName = "Page 1",
): DashboardPage | null {
	if (!isPage(value)) return null;
	const name =
		typeof value.name === "string" && value.name.trim().length > 0
			? value.name.trim()
			: defaultName;
	const page: DashboardPage = {
		id: value.id,
		name,
		components: value.components
			.map(toComponent)
			.filter((item): item is DashboardComponentConfig => item !== null),
	};
	if (typeof value.parentId === "string" && value.parentId.length > 0) {
		page.parentId = value.parentId;
	}
	if (value.columns === 12 || value.columns === 24) {
		page.columns = value.columns;
	}
	if (typeof value.rowHeight === "number" && Number.isFinite(value.rowHeight)) {
		page.rowHeight = Math.min(200, Math.max(40, Math.round(value.rowHeight)));
	}
	return page;
}
