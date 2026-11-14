import { t } from "../lang/helpers";
import { builtinQueries } from "../query/builtins";
import {
	savedQueryToDefinition,
	type SavedQuerySource,
} from "../query/repository";
import type { QueryDefinition, QueryTarget } from "../query/types";
import type { CustomFilter } from "../settings";
import { descendantsOf, normalizePageTree } from "./page-tree";
import { cloneWithFreshIds, walkComponents } from "./hierarchy";
import { isQuery, isRecord, toPage, uniqueId } from "./schema";
import type {
	DashboardComponentConfig,
	DashboardPage,
	DashboardStoreData,
	DashboardWorkspace,
} from "./types";
import { DASHBOARD_SCHEMA_VERSION } from "./types";

/**
 * Shareable transfer bundle. Import semantics are always "append" (the single
 * exception is a full backup restore), and every id is regenerated on import.
 */
export type BundleKind =
	| "ioto-dashboard-query"
	| "ioto-dashboard-page"
	| "ioto-dashboard"
	| "ioto-dashboard-backup";

export const BUNDLE_FORMAT_VERSION = 1;

export interface BundleRoots {
	inputFolder: string;
	outputFolder: string;
	taskFolder: string;
	outcomeFolder: string;
}

export interface BundleEnvelope {
	kind: BundleKind;
	formatVersion: 1;
	pluginVersion: string;
	storeSchemaVersion: number;
	exportedAt: string;
	source?: {
		dashboardName?: string;
		pageNames?: string[];
		roots?: BundleRoots;
	};
	payload: {
		queries: QueryDefinition[];
		pages?: DashboardPage[];
		dashboard?: DashboardWorkspace;
		dashboards?: DashboardWorkspace[];
		customFilters?: CustomFilter[];
	};
	warnings: string[];
}

export interface BundleSettings {
	roots: BundleRoots;
	customFilters: CustomFilter[];
	savedQueries: SavedQuerySource[];
}

export interface BundleContext {
	store: DashboardStoreData;
	settings: BundleSettings;
	pluginVersion?: string;
	now?: number;
}

export interface ImportWarning {
	code: string;
	level: "info" | "warn" | "error";
	message: string;
}

export interface ImportPlan {
	kind: BundleKind;
	mode: "append" | "replace";
	targetDashboardId?: string;
	pages: DashboardPage[];
	dashboards: DashboardWorkspace[];
	/** Only `user:` queries are written; built-ins are referenced, never stored. */
	queries: QueryDefinition[];
	customFilters: CustomFilter[];
	pageIdMap: Record<string, string>;
	queryIdMap: Record<string, string>;
	createdPageIds: string[];
	warnings: ImportWarning[];
}

export interface ImportPlanContext {
	store: DashboardStoreData;
	settings: BundleSettings;
	targetDashboardId?: string;
	rewritePaths?: boolean;
	/** Returns the query targets a component accepts, or null for an unknown type. */
	targetsFor?: (componentType: string) => QueryTarget[] | null;
	now?: number;
}

export interface BundleParseResult {
	ok: boolean;
	envelope?: BundleEnvelope;
	error?: { code: string; message: string };
}

export interface ExportResult {
	envelope: BundleEnvelope;
	json: string;
}

const ROOT_KEYS = [
	"inputFolder",
	"outputFolder",
	"taskFolder",
	"outcomeFolder",
] as const;

function clone<T>(value: T): T {
	return structuredClone(value);
}

function queryIdsInPages(pages: readonly DashboardPage[]): string[] {
	const ids = new Set<string>();
	for (const page of pages) {
		for (const location of walkComponents(page.components)) {
			const id = location.config.queryId;
			if (id) ids.add(id);
		}
	}
	return [...ids];
}

function clonePages(pages: readonly DashboardPage[]): DashboardPage[] {
	return pages.map((page) => clone(page));
}

function cloneDashboard(dashboard: DashboardWorkspace): DashboardWorkspace {
	return { ...clone(dashboard), pages: clonePages(dashboard.pages) };
}

function savedQueryName(base: string): string {
	return `${base}${t("TRANSFER_SAVED_QUERY_SUFFIX")}`;
}

function resolveQuery(
	queryId: string,
	ctx: BundleContext,
	warnings: string[],
): QueryDefinition | null {
	if (queryId.startsWith("builtin:")) {
		const builtin = builtinQueries().find((item) => item.id === queryId);
		if (builtin) return clone(builtin);
		warnings.push(t("TRANSFER_WARN_BUILTIN_MISSING", [queryId]));
		return null;
	}
	if (queryId.startsWith("saved:")) {
		const raw = ctx.settings.savedQueries.find(
			(item) => `saved:${item.id}` === queryId,
		);
		if (!raw) {
			warnings.push(t("TRANSFER_WARN_MISSING_SAVED", [queryId]));
			return null;
		}
		const definition = savedQueryToDefinition(raw, ctx.settings.roots);
		// `saved:` lives in settings, not the store, so it must travel as a
		// materialised `user:` snapshot to survive a different vault.
		return {
			...clone(definition),
			id: `user:${raw.id}`,
			name: savedQueryName(definition.name),
		};
	}
	const user = ctx.store.queries.find((item) => item.id === queryId);
	if (!user) {
		warnings.push(t("TRANSFER_WARN_MISSING_QUERY", [queryId]));
		return null;
	}
	return clone(user);
}

function collectQueries(
	queryIds: readonly string[],
	ctx: BundleContext,
	warnings: string[],
): QueryDefinition[] {
	const out = new Map<string, QueryDefinition>();
	for (const id of queryIds) {
		if (out.has(id)) continue;
		const resolved = resolveQuery(id, ctx, warnings);
		if (resolved) out.set(id, resolved);
	}
	return [...out.values()];
}

function collectCustomFilters(
	queries: readonly QueryDefinition[],
	ctx: BundleContext,
	warnings: string[],
): CustomFilter[] {
	const names = new Set<string>();
	for (const query of queries) {
		for (const name of Object.keys(query.filters.custom ?? {})) {
			names.add(name);
		}
	}
	const out: CustomFilter[] = [];
	for (const name of names) {
		const definition = ctx.settings.customFilters.find(
			(item) => item.name === name,
		);
		if (!definition) {
			warnings.push(t("TRANSFER_WARN_MISSING_FILTER", [name]));
			continue;
		}
		out.push(clone(definition));
	}
	return out;
}

function envelope(
	kind: BundleKind,
	ctx: BundleContext,
	payload: BundleEnvelope["payload"],
	source: BundleEnvelope["source"],
	warnings: string[],
): BundleEnvelope {
	const now = ctx.now ?? Date.now();
	return {
		kind,
		formatVersion: BUNDLE_FORMAT_VERSION,
		pluginVersion: ctx.pluginVersion ?? "",
		storeSchemaVersion: DASHBOARD_SCHEMA_VERSION,
		exportedAt: new Date(now).toISOString(),
		...(source ? { source } : {}),
		payload,
		warnings,
	};
}

function rootsOf(ctx: BundleContext): BundleRoots {
	return clone(ctx.settings.roots);
}

export function buildPageBundle(
	ctx: BundleContext,
	dashboardId: string,
	pageId: string,
): ExportResult | null {
	const dashboard = ctx.store.dashboards.find(
		(item) => item.id === dashboardId,
	);
	const page = dashboard?.pages.find((item) => item.id === pageId);
	if (!dashboard || !page) return null;

	const warnings: string[] = [];
	const pages = clone([page, ...descendantsOf(dashboard.pages, pageId)]);
	for (const item of pages) {
		if (item.parentId && !pages.some((candidate) => candidate.id === item.parentId)) {
			warnings.push(t("TRANSFER_WARN_PARENT_OUTSIDE", [item.name]));
		}
	}
	const queries = collectQueries(queryIdsInPages(pages), ctx, warnings);
	const customFilters = collectCustomFilters(queries, ctx, warnings);
	const result = envelope(
		"ioto-dashboard-page",
		ctx,
		{ pages, queries, customFilters },
		{
			dashboardName: dashboard.name,
			pageNames: pages.map((item) => item.name),
			roots: rootsOf(ctx),
		},
		warnings,
	);
	return { envelope: result, json: serializeBundle(result) };
}

export function buildDashboardBundle(
	ctx: BundleContext,
	dashboardId: string,
): ExportResult | null {
	const dashboard = ctx.store.dashboards.find(
		(item) => item.id === dashboardId,
	);
	if (!dashboard) return null;
	const copy = cloneDashboard(dashboard);
	const warnings: string[] = [];
	const queries = collectQueries(queryIdsInPages(copy.pages), ctx, warnings);
	const customFilters = collectCustomFilters(queries, ctx, warnings);
	const result = envelope(
		"ioto-dashboard",
		ctx,
		{ dashboard: copy, queries, customFilters },
		{
			dashboardName: dashboard.name,
			pageNames: copy.pages.map((item) => item.name),
			roots: rootsOf(ctx),
		},
		warnings,
	);
	return { envelope: result, json: serializeBundle(result) };
}

export function buildQueryBundle(
	ctx: BundleContext,
	queryId: string,
): ExportResult | null {
	const warnings: string[] = [];
	const query = resolveQuery(queryId, ctx, warnings);
	if (!query) return null;
	const customFilters = collectCustomFilters([query], ctx, warnings);
	const result = envelope(
		"ioto-dashboard-query",
		ctx,
		{ queries: [query], customFilters },
		{ roots: rootsOf(ctx) },
		warnings,
	);
	return { envelope: result, json: serializeBundle(result) };
}

export function buildBackupBundle(ctx: BundleContext): ExportResult {
	const warnings: string[] = [];
	const dashboards = ctx.store.dashboards.map(cloneDashboard);
	const queries = ctx.store.queries.map(clone);
	const result = envelope(
		"ioto-dashboard-backup",
		ctx,
		{ dashboards, queries },
		{ roots: rootsOf(ctx) },
		warnings,
	);
	return { envelope: result, json: serializeBundle(result) };
}

export function serializeBundle(bundle: BundleEnvelope): string {
	return JSON.stringify(bundle, null, 2);
}

const BUNDLE_KINDS: ReadonlySet<string> = new Set<BundleKind>([
	"ioto-dashboard-query",
	"ioto-dashboard-page",
	"ioto-dashboard",
	"ioto-dashboard-backup",
]);

export function parseBundle(text: string): BundleParseResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			ok: false,
			error: {
				code: "invalid-json",
				message: t("TRANSFER_ERROR_INVALID_JSON"),
			},
		};
	}
	if (!isRecord(parsed)) {
		return {
			ok: false,
			error: {
				code: "invalid-json",
				message: t("TRANSFER_ERROR_INVALID_JSON"),
			},
		};
	}
	if (
		typeof parsed.kind !== "string" ||
		!BUNDLE_KINDS.has(parsed.kind)
	) {
		return {
			ok: false,
			error: {
				code: "unknown-kind",
				message: t("TRANSFER_ERROR_UNKNOWN_KIND"),
			},
		};
	}
	if (parsed.formatVersion !== BUNDLE_FORMAT_VERSION) {
		return {
			ok: false,
			error: {
				code: "unsupported-version",
				message: t("TRANSFER_ERROR_UNSUPPORTED_VERSION", [
					String(parsed.formatVersion),
				]),
			},
		};
	}
	if (!isRecord(parsed.payload)) {
		return {
			ok: false,
			error: {
				code: "invalid-payload",
				message: t("TRANSFER_ERROR_INVALID_PAYLOAD"),
			},
		};
	}
	return { ok: true, envelope: parsed as unknown as BundleEnvelope };
}

function dedupeName(
	base: string,
	taken: Set<string>,
	suffix: string,
): string {
	const trimmed = base.trim() || "Item";
	if (!taken.has(trimmed.toLowerCase())) {
		taken.add(trimmed.toLowerCase());
		return trimmed;
	}
	const root = `${trimmed}${suffix}`;
	if (!taken.has(root.toLowerCase())) {
		taken.add(root.toLowerCase());
		return root;
	}
	let index = 2;
	while (taken.has(`${root} ${index}`.toLowerCase())) index += 1;
	const next = `${root} ${index}`;
	taken.add(next.toLowerCase());
	return next;
}

function readPages(
	raw: unknown,
	warnings: ImportWarning[],
): DashboardPage[] {
	if (!Array.isArray(raw)) return [];
	const pages: DashboardPage[] = [];
	for (const [index, candidate] of raw.entries()) {
		const page = toPage(candidate);
		if (page) {
			pages.push(page);
		} else {
			warnings.push({
				code: "page.dropped",
				level: "warn",
				message: t("TRANSFER_WARN_DROPPED_PAGE", [String(index + 1)]),
			});
		}
	}
	return pages;
}

function readQueries(raw: unknown): QueryDefinition[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(isQuery) as QueryDefinition[];
}

const FILTER_TYPES = new Set(["text", "number", "boolean", "date", "list"]);

function readCustomFilters(raw: unknown): CustomFilter[] {
	if (!Array.isArray(raw)) return [];
	const out: CustomFilter[] = [];
	for (const value of raw) {
		if (!isRecord(value) || typeof value.name !== "string") continue;
		if (typeof value.type !== "string" || !FILTER_TYPES.has(value.type)) {
			continue;
		}
		const target =
			value.target === "note" || value.target === "task"
				? value.target
				: "all";
		out.push({
			name: value.name,
			type: value.type as CustomFilter["type"],
			target,
		});
	}
	return out;
}

function collectStorePages(store: DashboardStoreData): DashboardPage[] {
	return store.dashboards.flatMap((dashboard) => dashboard.pages);
}

function planQueries(
	incoming: readonly QueryDefinition[],
	store: DashboardStoreData,
	base: string,
	warnings: ImportWarning[],
): {
	writable: QueryDefinition[];
	targets: Map<string, QueryTarget>;
	idMap: Map<string, string>;
} {
	const takenIds = new Set(store.queries.map((item) => item.id));
	const takenNames = new Set(
		store.queries.map((item) => item.name.toLowerCase()),
	);
	const writable: QueryDefinition[] = [];
	const targets = new Map<string, QueryTarget>();
	const idMap = new Map<string, string>();
	const seen = new Set<string>();
	let sequence = 0;

	for (const raw of incoming) {
		const query = clone(raw);
		if (seen.has(query.id)) continue;
		seen.add(query.id);

		if (query.id.startsWith("builtin:")) {
			targets.set(query.id, query.target);
			idMap.set(query.id, query.id);
			continue;
		}
		if (query.id.startsWith("saved:")) {
			warnings.push({
				code: "query.saved-skipped",
				level: "warn",
				message: t("TRANSFER_WARN_SAVED_SKIPPED", [query.name]),
			});
			continue;
		}
		sequence += 1;
		const id = uniqueId(`user:${base}-${sequence}`, takenIds);
		takenIds.add(id);
		const name = dedupeName(
			query.name,
			takenNames,
			t("TRANSFER_IMPORT_SUFFIX"),
		);
		delete query.nameKey;
		writable.push({ ...query, id, name });
		targets.set(id, query.target);
		idMap.set(query.id, id);
	}
	return { writable, targets, idMap };
}

function targetFor(
	queryId: string,
	targets: Map<string, QueryTarget>,
	store: DashboardStoreData,
): QueryTarget | undefined {
	if (targets.has(queryId)) return targets.get(queryId);
	if (queryId.startsWith("builtin:")) {
		return builtinQueries().find((item) => item.id === queryId)?.target;
	}
	return store.queries.find((item) => item.id === queryId)?.target;
}

function rewriteComponentTree(
	components: DashboardComponentConfig[],
	visit: (config: DashboardComponentConfig) => void,
): void {
	for (const config of components) {
		visit(config);
		if (config.children) rewriteComponentTree(config.children, visit);
	}
}

function remapComponents(
	page: DashboardPage,
	state: {
		base: string;
		takenComponentIds: Set<string>;
		queryIdMap: Map<string, string>;
		queryTargets: Map<string, QueryTarget>;
		store: DashboardStoreData;
		targetsFor?: (type: string) => QueryTarget[] | null;
		warnings: ImportWarning[];
		warnedTypes: Set<string>;
	},
): void {
	let sequence = 0;
	page.components = page.components.map((component) => {
		const copy = cloneWithFreshIds(component, () => {
			sequence += 1;
			const id = uniqueId(
				`component:${state.base}-${sequence}`,
				state.takenComponentIds,
			);
			state.takenComponentIds.add(id);
			return id;
		});
		rewriteComponentTree([copy], (config) => {
			const oldId = config.queryId;
			if (!oldId) return;
			const mapped = state.queryIdMap.get(oldId);
			if (mapped !== undefined) {
				config.queryId = mapped;
				return;
			}
			if (oldId.startsWith("builtin:")) {
				state.queryIdMap.set(oldId, oldId);
				return;
			}
			state.queryIdMap.set(oldId, "");
			config.queryId = "";
			state.warnings.push({
				code: "component.query-missing",
				level: "warn",
				message: t("TRANSFER_WARN_MISSING_QUERY", [oldId]),
			});
		});
		rewriteComponentTree([copy], (config) => {
			if (!config.queryId) return;
			const accepts = state.targetsFor?.(config.type);
			if (accepts === null) {
				if (!state.warnedTypes.has(config.type)) {
					state.warnedTypes.add(config.type);
					state.warnings.push({
						code: "component.unknown-type",
						level: "info",
						message: t("TRANSFER_WARN_UNKNOWN_COMPONENT", [
							config.type,
						]),
					});
				}
				return;
			}
			if (!accepts || accepts.length === 0) return;
			const target = targetFor(
				config.queryId,
				state.queryTargets,
				state.store,
			);
			if (target && !accepts.includes(target)) {
				config.queryId = "";
				state.warnings.push({
					code: "component.target-mismatch",
					level: "warn",
					message: t("TRANSFER_WARN_TARGET", [
						config.type,
						target,
					]),
				});
			}
		});
		return copy;
	});
}

function rewriteButtonPages(
	pages: readonly DashboardPage[],
	state: {
		pageIdMap: Map<string, string>;
		storePageIds: Set<string>;
		warnings: ImportWarning[];
	},
): void {
	for (const page of pages) {
		rewriteComponentTree(page.components, (config) => {
			if (config.type !== "button") return;
			if (config.options?.actionType !== "page") return;
			const pageId = String(config.options.pageId ?? "").trim();
			if (!pageId) return;
			const mapped = state.pageIdMap.get(pageId);
			if (mapped) {
				config.options.pageId = mapped;
				return;
			}
			if (state.storePageIds.has(pageId)) return;
			state.warnings.push({
				code: "component.page-missing",
				level: "warn",
				message: t("TRANSFER_WARN_BUTTON_PAGE", [
					config.title ?? config.id,
				]),
			});
		});
	}
}

function planPages(
	incoming: readonly DashboardPage[],
	options: {
		base: string;
		takenPageIds: Set<string>;
		existingPages: readonly DashboardPage[];
	},
	warnings: ImportWarning[],
): { pages: DashboardPage[]; pageIdMap: Map<string, string> } {
	const pageIdMap = new Map<string, string>();
	const staged: Array<{ page: DashboardPage; oldParent?: string }> = [];
	let sequence = 0;

	for (const raw of incoming) {
		const page = toPage(raw);
		if (!page) continue;
		if (pageIdMap.has(page.id)) continue;
		sequence += 1;
		const id = uniqueId(`page:${options.base}-${sequence}`, options.takenPageIds);
		options.takenPageIds.add(id);
		pageIdMap.set(page.id, id);
		staged.push({ page, oldParent: page.parentId });
		page.id = id;
	}

	for (const entry of staged) {
		if (!entry.oldParent) {
			delete entry.page.parentId;
			continue;
		}
		const mapped = pageIdMap.get(entry.oldParent);
		if (mapped) {
			entry.page.parentId = mapped;
		} else {
			delete entry.page.parentId;
			warnings.push({
				code: "page.parent-outside",
				level: "warn",
				message: t("TRANSFER_WARN_PARENT_OUTSIDE", [entry.page.name]),
			});
		}
	}

	// Names are unique per rendered level: top level and each parent group.
	const namesByLevel = new Map<string, Set<string>>();
	const levelKey = (parentId: string | undefined): string => parentId ?? "";
	for (const page of options.existingPages) {
		const key = levelKey(page.parentId);
		const set = namesByLevel.get(key) ?? new Set<string>();
		set.add(page.name.toLowerCase());
		namesByLevel.set(key, set);
	}
	for (const entry of staged) {
		const key = levelKey(entry.page.parentId);
		const set = namesByLevel.get(key) ?? new Set<string>();
		namesByLevel.set(key, set);
		entry.page.name = dedupeName(
			entry.page.name,
			set,
			t("TRANSFER_IMPORT_SUFFIX"),
		);
	}

	return {
		pages: normalizePageTree(staged.map((entry) => entry.page)),
		pageIdMap,
	};
}

function rewriteQueryPaths(
	queries: QueryDefinition[],
	source: BundleRoots | undefined,
	target: BundleRoots,
	warnings: ImportWarning[],
): void {
	if (!source) return;
	for (const query of queries) {
		query.scope.folders = query.scope.folders.map((path) => {
			for (const key of ROOT_KEYS) {
				const origin = source[key];
				if (!origin) continue;
				if (path === origin) {
					const next = target[key];
					warnings.push({
						code: "path.rewritten",
						level: "info",
						message: t("TRANSFER_WARN_PATH_REWRITTEN", [path, next]),
					});
					return next;
				}
				if (path.startsWith(`${origin}/`)) {
					const next = `${target[key]}${path.slice(origin.length)}`;
					warnings.push({
						code: "path.rewritten",
						level: "info",
						message: t("TRANSFER_WARN_PATH_REWRITTEN", [path, next]),
					});
					return next;
				}
			}
			warnings.push({
				code: "path.unmatched",
				level: "warn",
				message: t("TRANSFER_WARN_PATH_UNMATCHED", [path]),
			});
			return path;
		});
	}
}

function planBackup(
	envelopeValue: BundleEnvelope,
): ImportPlan {
	const warnings: ImportPlan["warnings"] = envelopeValue.warnings.map(
		(message) => ({ code: "export.warning", level: "warn", message }),
	);
	const dashboards: DashboardWorkspace[] = [];
	const seenDashboards = new Set<string>();
	if (Array.isArray(envelopeValue.payload.dashboards)) {
		for (const raw of envelopeValue.payload.dashboards) {
			if (!isRecord(raw) || typeof raw.id !== "string") continue;
			if (seenDashboards.has(raw.id)) continue;
			seenDashboards.add(raw.id);
			const pages = readPages(raw.pages, warnings);
			const taken = new Set(pages.map((page) => page.id));
			const seenPages = new Set<string>();
			const uniquePages = pages.filter((page) => {
				if (seenPages.has(page.id)) return false;
				seenPages.add(page.id);
				return true;
			});
			if (uniquePages.length === 0) {
				const id = uniqueId(`page:default-${raw.id}`, taken);
				uniquePages.push({ id, name: "Page 1", components: [] });
			}
			const dashboard: DashboardWorkspace = {
				id: raw.id,
				name:
					typeof raw.name === "string" && raw.name.trim()
						? raw.name.trim()
						: t("DASHBOARD_DEFAULT_NAME", ["1"]),
				pages: normalizePageTree(uniquePages),
			};
			if (
				typeof raw.lastPageId === "string" &&
				uniquePages.some((page) => page.id === raw.lastPageId)
			) {
				dashboard.lastPageId = raw.lastPageId;
			}
			dashboards.push(dashboard);
		}
	}
	return {
		kind: "ioto-dashboard-backup",
		mode: "replace",
		pages: [],
		dashboards,
		queries: readQueries(envelopeValue.payload.queries).map(clone),
		customFilters: [],
		pageIdMap: {},
		queryIdMap: {},
		createdPageIds: [],
		warnings,
	};
}

export function planImport(
	envelopeValue: BundleEnvelope,
	context: ImportPlanContext,
): ImportPlan {
	if (envelopeValue.kind === "ioto-dashboard-backup") {
		return planBackup(envelopeValue);
	}

	const now = context.now ?? Date.now();
	const base = `import-${now}`;
	const store = context.store;
	const warnings: ImportPlan["warnings"] = envelopeValue.warnings.map(
		(message) => ({ code: "export.warning", level: "warn", message }),
	);
	const { writable, targets, idMap } = planQueries(
		readQueries(envelopeValue.payload.queries),
		store,
		base,
		warnings,
	);
	const queryIdMap = idMap;

	const customFilters = readCustomFilters(
		envelopeValue.payload.customFilters,
	).filter(
		(item) =>
			!context.settings.customFilters.some(
				(existing) => existing.name === item.name,
			),
	);

	const plan: ImportPlan = {
		kind: envelopeValue.kind,
		mode: "append",
		pages: [],
		dashboards: [],
		queries: writable,
		customFilters,
		pageIdMap: {},
		queryIdMap: Object.fromEntries(queryIdMap),
		createdPageIds: [],
		warnings,
	};

	const takenComponentIds = new Set<string>();
	for (const page of collectStorePages(store)) {
		for (const location of walkComponents(page.components)) {
			takenComponentIds.add(location.config.id);
		}
	}
	const takenPageIds = new Set(
		collectStorePages(store).map((page) => page.id),
	);
	const takenDashboardIds = new Set(store.dashboards.map((item) => item.id));
	const warnedTypes = new Set<string>();

	const applyComponents = (pages: DashboardPage[]): void => {
		for (const page of pages) {
			remapComponents(page, {
				base,
				takenComponentIds,
				queryIdMap,
				queryTargets: targets,
				store,
				targetsFor: context.targetsFor,
				warnings,
				warnedTypes,
			});
		}
	};

	if (envelopeValue.kind === "ioto-dashboard-page") {
		const targetDashboardId =
			context.targetDashboardId ?? store.activeDashboardId;
		const target = store.dashboards.find(
			(item) => item.id === targetDashboardId,
		);
		if (!target) {
			warnings.push({
				code: "page.target-missing",
				level: "error",
				message: t("TRANSFER_ERROR_NO_TARGET_DASHBOARD"),
			});
			return plan;
		}
		const { pages, pageIdMap } = planPages(
			readPages(envelopeValue.payload.pages, warnings),
			{
				base,
				takenPageIds,
				existingPages: target.pages,
			},
			warnings,
		);
		applyComponents(pages);
		rewriteButtonPages(pages, {
			pageIdMap,
			storePageIds: new Set(collectStorePages(store).map((page) => page.id)),
			warnings,
		});
		plan.targetDashboardId = targetDashboardId;
		plan.pages = pages;
		plan.createdPageIds = pages.map((page) => page.id);
		plan.pageIdMap = Object.fromEntries(pageIdMap);
	} else if (envelopeValue.kind === "ioto-dashboard") {
		const rawDashboard = envelopeValue.payload.dashboard;
		if (!isRecord(rawDashboard) || typeof rawDashboard.id !== "string") {
			warnings.push({
				code: "dashboard.invalid",
				level: "error",
				message: t("TRANSFER_ERROR_INVALID_PAYLOAD"),
			});
			return plan;
		}
		const takenNames = new Set(
			store.dashboards.map((item) => item.name.toLowerCase()),
		);
		const name = dedupeName(
			typeof rawDashboard.name === "string" && rawDashboard.name.trim()
				? rawDashboard.name.trim()
				: t("DASHBOARD_DEFAULT_NAME", ["1"]),
			takenNames,
			t("TRANSFER_IMPORT_SUFFIX"),
		);
		const dashboardId = uniqueId(
			`dashboard:${base}`,
			takenDashboardIds,
		);
		const { pages, pageIdMap } = planPages(
			readPages(rawDashboard.pages, warnings),
			{
				base,
				takenPageIds,
				existingPages: [],
			},
			warnings,
		);
		applyComponents(pages);
		rewriteButtonPages(pages, {
			pageIdMap,
			storePageIds: new Set(collectStorePages(store).map((page) => page.id)),
			warnings,
		});
		const dashboard: DashboardWorkspace = {
			id: dashboardId,
			name,
			pages,
		};
		const lastPageId =
			typeof rawDashboard.lastPageId === "string"
				? pageIdMap.get(rawDashboard.lastPageId)
				: undefined;
		if (lastPageId && pages.some((page) => page.id === lastPageId)) {
			dashboard.lastPageId = lastPageId;
		}
		plan.dashboards = [dashboard];
		plan.createdPageIds = pages.map((page) => page.id);
		plan.pageIdMap = Object.fromEntries(pageIdMap);
	} else if (envelopeValue.kind === "ioto-dashboard-query") {
		plan.createdPageIds = [];
	}

	if (context.rewritePaths !== false) {
		rewriteQueryPaths(plan.queries, envelopeValue.source?.roots, context.settings.roots, warnings);
	}

	return plan;
}

export function hasImportErrors(plan: ImportPlan): boolean {
	return plan.warnings.some((item) => item.level === "error");
}

export function mergeCustomFilters(
	plan: ImportPlan,
	existing: readonly CustomFilter[],
): CustomFilter[] {
	const names = new Set(existing.map((item) => item.name));
	return [
		...existing,
		...plan.customFilters.filter((item) => !names.has(item.name)),
	];
}
