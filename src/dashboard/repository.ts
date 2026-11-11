import { MEASURE_IDS, VIEW_IDS } from "./dataset/types";
import type {
	DashboardComponentConfig,
	DashboardPage,
	DashboardStoreData,
	DashboardWorkspace,
} from "./types";
import {
	DASHBOARD_SCHEMA_VERSION,
	DASHBOARD_STORE_KEY,
	DEFAULT_DASHBOARD_ID,
	activeDashboard,
	activePageOf,
	createDefaultStore,
} from "./types";

export interface DashboardDataHost {
	readData(): Promise<unknown>;
	/** Serialised read-modify-write of the whole `data.json`. */
	updateData(mutate: (data: Record<string, unknown>) => void): Promise<void>;
}

export interface DashboardLoadResult {
	store: DashboardStoreData;
	/** JSON existed but was malformed: the raw data is kept, never overwritten. */
	damaged: boolean;
}

export interface DashboardRepositoryOptions {
	/** Localised default name for the first dashboard. */
	defaultDashboardName?: () => string;
}

const DEFAULT_DASHBOARD_NAME = "Dashboard 1";
const DEFAULT_PAGE_NAME = "Page 1";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComponent(value: unknown): value is DashboardComponentConfig {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.type === "string" &&
		typeof value.queryId === "string"
	);
}

function isPage(value: unknown): value is DashboardPage {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		Array.isArray(value.components)
	);
}

function isQuery(value: unknown): boolean {
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

function toOptions(
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

/** Whitelists stored fields so unknown/dirty keys never survive a load. */
function toComponent(value: unknown): DashboardComponentConfig | null {
	if (!isComponent(value)) return null;
	const component: DashboardComponentConfig = {
		id: value.id,
		type: value.type,
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
	if (typeof value.measure === "string" && MEASURE_SET.has(value.measure)) {
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
	return component;
}

function uniqueId(base: string, taken: Set<string>): string {
	if (!taken.has(base)) return base;
	let index = 2;
	let candidate = `${base}-${index}`;
	while (taken.has(candidate)) {
		index += 1;
		candidate = `${base}-${index}`;
	}
	return candidate;
}

function slugOf(value: string): string {
	const slug = value.replace(/[^A-Za-z0-9_-]/g, "-");
	return slug.length > 0 ? slug : "dashboard";
}

function toPage(value: unknown): DashboardPage | null {
	if (!isPage(value)) return null;
	const name =
		typeof value.name === "string" && value.name.trim().length > 0
			? value.name.trim()
			: DEFAULT_PAGE_NAME;
	const page: DashboardPage = {
		id: value.id,
		name,
		components: value.components
			.map(toComponent)
			.filter((item): item is DashboardComponentConfig => item !== null),
	};
	if (value.columns === 12 || value.columns === 24) {
		page.columns = value.columns;
	}
	if (typeof value.rowHeight === "number" && Number.isFinite(value.rowHeight)) {
		page.rowHeight = Math.min(200, Math.max(40, Math.round(value.rowHeight)));
	}
	return page;
}

export class DashboardRepository {
	private readonly listeners = new Set<
		(store: DashboardStoreData) => void
	>();

	constructor(
		private host: DashboardDataHost,
		private options: DashboardRepositoryOptions = {},
	) {}

	private defaultName(): string {
		return this.options.defaultDashboardName?.() ?? DEFAULT_DASHBOARD_NAME;
	}

	private defaultStore(): DashboardStoreData {
		return createDefaultStore(this.defaultName());
	}

	async load(): Promise<DashboardLoadResult> {
		const data = await this.host.readData();
		const raw = isRecord(data) ? data[DASHBOARD_STORE_KEY] : undefined;
		if (raw === undefined) {
			const store = this.defaultStore();
			await this.save(store);
			return { store, damaged: false };
		}
		const store = this.normalize(raw);
		if (!store) return { store: this.defaultStore(), damaged: true };
		return { store, damaged: false };
	}

	private normalizePages(candidates: unknown[]): DashboardPage[] {
		const pages: DashboardPage[] = [];
		for (const candidate of candidates) {
			const page = toPage(candidate);
			if (page) pages.push(page);
		}
		return pages;
	}

	private normalizeDashboard(
		value: Record<string, unknown>,
	): DashboardWorkspace | null {
		if (typeof value.id !== "string") return null;
		const pages = this.normalizePages(
			Array.isArray(value.pages) ? value.pages : [],
		);
		const name =
			typeof value.name === "string" && value.name.trim().length > 0
				? value.name.trim()
				: this.defaultName();
		const dashboard: DashboardWorkspace = { id: value.id, name, pages };
		const lastPageId =
			typeof value.lastPageId === "string" ? value.lastPageId : undefined;
		if (lastPageId && pages.some((page) => page.id === lastPageId)) {
			dashboard.lastPageId = lastPageId;
		}
		return dashboard;
	}

	/**
	 * Shape-based migration, not trusting `schemaVersion`:
	 * - `pages[]` → v3, wrapped in the default dashboard;
	 * - `dashboards[]` → v4 elements (with `pages`) and/or v2 elements (with
	 *   `components`, wrapped into a trailing default dashboard).
	 */
	private normalize(raw: unknown): DashboardStoreData | null {
		if (!isRecord(raw)) return null;

		const parsed: DashboardWorkspace[] = [];
		const legacyPages: DashboardPage[] = [];

		if (Array.isArray(raw.pages)) {
			const pages = this.normalizePages(raw.pages);
			const dashboard: DashboardWorkspace = {
				id: DEFAULT_DASHBOARD_ID,
				name: this.defaultName(),
				pages,
			};
			const lastPageId =
				typeof raw.activePageId === "string"
					? raw.activePageId
					: undefined;
			if (lastPageId && pages.some((page) => page.id === lastPageId)) {
				dashboard.lastPageId = lastPageId;
			}
			parsed.push(dashboard);
		} else if (Array.isArray(raw.dashboards)) {
			for (const entry of raw.dashboards) {
				if (!isRecord(entry)) continue;
				if (Array.isArray(entry.pages)) {
					const dashboard = this.normalizeDashboard(entry);
					if (dashboard) parsed.push(dashboard);
				} else if (Array.isArray(entry.components)) {
					const page = toPage(entry);
					if (page) legacyPages.push(page);
				}
			}
		}

		const takenDashboardIds = new Set<string>();
		const takenPageIds = new Set<string>();
		const dashboards: DashboardWorkspace[] = [];

		const pushDashboard = (dashboard: DashboardWorkspace): void => {
			if (takenDashboardIds.has(dashboard.id)) return;
			takenDashboardIds.add(dashboard.id);

			const pages: DashboardPage[] = [];
			for (const page of dashboard.pages) {
				if (takenPageIds.has(page.id)) continue;
				takenPageIds.add(page.id);
				pages.push(page);
			}
			if (pages.length === 0) {
				const pageId = uniqueId(
					`page:default-${slugOf(dashboard.id)}`,
					takenPageIds,
				);
				takenPageIds.add(pageId);
				pages.push({ id: pageId, name: DEFAULT_PAGE_NAME, components: [] });
			}

			const next: DashboardWorkspace = {
				id: dashboard.id,
				name: dashboard.name,
				pages,
			};
			const lastPageId = dashboard.lastPageId;
			if (lastPageId && pages.some((page) => page.id === lastPageId)) {
				next.lastPageId = lastPageId;
			}
			dashboards.push(next);
		};

		for (const dashboard of parsed) pushDashboard(dashboard);

		if (legacyPages.length > 0) {
			pushDashboard({
				id: uniqueId(DEFAULT_DASHBOARD_ID, takenDashboardIds),
				name: this.defaultName(),
				pages: legacyPages,
			});
		}

		const queries = Array.isArray(raw.queries)
			? raw.queries.filter(isQuery)
			: [];

		const store = this.defaultStore();
		if (dashboards.length === 0) {
			store.queries = queries as DashboardStoreData["queries"];
			return store;
		}

		const requested =
			typeof raw.activeDashboardId === "string"
				? raw.activeDashboardId
				: undefined;
		const activeDashboardId =
			requested && dashboards.some((item) => item.id === requested)
				? requested
				: dashboards[0]!.id;

		store.dashboards = dashboards;
		store.activeDashboardId = activeDashboardId;
		store.queries = queries as DashboardStoreData["queries"];
		return store;
	}

	async save(store: DashboardStoreData): Promise<void> {
		const payload: DashboardStoreData = {
			...store,
			schemaVersion: DASHBOARD_SCHEMA_VERSION,
		};
		await this.host.updateData((data) => {
			data[DASHBOARD_STORE_KEY] = payload;
		});
		this.notify(payload);
	}

	/** Fires once after every successful write (single notification point). */
	onChange(listener: (store: DashboardStoreData) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(store: DashboardStoreData): void {
		for (const listener of Array.from(this.listeners)) {
			try {
				listener(store);
			} catch (error) {
				console.warn("IOTO Dashboard: change listener failed", error);
			}
		}
	}

	private async mutate(
		mutate: (store: DashboardStoreData) => void,
	): Promise<DashboardStoreData> {
		const { store, damaged } = await this.load();
		if (damaged) return store;
		mutate(store);
		await this.save(store);
		return store;
	}

	private findPage(
		store: DashboardStoreData,
		pageId: string,
	): { dashboard: DashboardWorkspace; page: DashboardPage } | null {
		for (const dashboard of store.dashboards) {
			const page = dashboard.pages.find((item) => item.id === pageId);
			if (page) return { dashboard, page };
		}
		return null;
	}

	async addComponent(
		pageId: string,
		component: DashboardComponentConfig,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			this.findPage(store, pageId)?.page.components.push(component);
		});
	}

	async updateComponent(
		pageId: string,
		componentId: string,
		patch: Partial<DashboardComponentConfig>,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = this.findPage(store, pageId)?.page;
			const component = page?.components.find(
				(item) => item.id === componentId,
			);
			if (component) {
				const { options, ...rest } = patch;
				Object.assign(component, rest);
				if (options !== undefined) {
					const nextOptions: Record<string, string | number | boolean> = {
						...(component.options ?? {}),
					};
					for (const [key, value] of Object.entries(options)) {
						if (value === undefined) {
							delete nextOptions[key];
						} else {
							nextOptions[key] = value;
						}
					}
					component.options =
						Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
				}
				// `undefined` means "remove this key" (e.g. a cleared title).
				for (const key of Object.keys(rest)) {
					if ((rest as Record<string, unknown>)[key] === undefined) {
						delete (component as unknown as Record<string, unknown>)[
							key
						];
					}
				}
			}
		});
	}

	async moveComponent(
		pageId: string,
		componentId: string,
		toIndex: number,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = this.findPage(store, pageId)?.page;
			if (!page) return;
			const from = page.components.findIndex(
				(item) => item.id === componentId,
			);
			if (from < 0) return;
			const to = Math.min(
				page.components.length - 1,
				Math.max(0, Math.trunc(toIndex)),
			);
			if (to === from) return;
			const [moved] = page.components.splice(from, 1);
			if (moved) page.components.splice(to, 0, moved);
		});
	}

	async removeComponent(
		pageId: string,
		componentId: string,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = this.findPage(store, pageId)?.page;
			if (!page) return;
			page.components = page.components.filter(
				(item) => item.id !== componentId,
			);
		});
	}

	async duplicateComponent(
		pageId: string,
		componentId: string,
		title?: string,
	): Promise<{ store: DashboardStoreData; componentId: string } | null> {
		let newId: string | null = null;
		const store = await this.mutate((data) => {
			const page = this.findPage(data, pageId)?.page;
			if (!page) return;
			const index = page.components.findIndex(
				(item) => item.id === componentId,
			);
			const source = page.components[index];
			if (index < 0 || !source) return;
			const taken = new Set(
				data.dashboards.flatMap((item) =>
					item.pages.flatMap((p) => p.components.map((c) => c.id)),
				),
			);
			newId = uniqueId(`component:${Date.now()}`, taken);
			const copy: DashboardComponentConfig = {
				...structuredClone(source),
				id: newId,
			};
			if (title !== undefined) copy.title = title;
			page.components.splice(index + 1, 0, copy);
		});
		return newId ? { store, componentId: newId } : null;
	}

	async addPage(
		dashboardId: string,
		page: DashboardPage,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const dashboard = store.dashboards.find(
				(item) => item.id === dashboardId,
			);
			if (!dashboard) return;
			if (this.findPage(store, page.id)) return;
			dashboard.pages.push(page);
			dashboard.lastPageId = page.id;
		});
	}

	async renamePage(pageId: string, name: string): Promise<DashboardStoreData> {
		const trimmed = name.trim();
		return this.mutate((store) => {
			if (!trimmed) return;
			const page = this.findPage(store, pageId)?.page;
			if (page) page.name = trimmed;
		});
	}

	async updatePageLayout(
		pageId: string,
		columns: 12 | 24,
		rowHeight: number,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = this.findPage(store, pageId)?.page;
			if (!page) return;
			page.columns = columns === 24 ? 24 : 12;
			page.rowHeight = Math.min(
				200,
				Math.max(40, Math.round(rowHeight) || 72),
			);
		});
	}

	async removePage(pageId: string): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const hit = this.findPage(store, pageId);
			if (!hit) return;
			const { dashboard } = hit;
			// The last page of a dashboard is never removed: it needs a canvas.
			if (dashboard.pages.length <= 1) return;
			dashboard.pages = dashboard.pages.filter(
				(page) => page.id !== pageId,
			);
			if (dashboard.lastPageId === pageId) {
				dashboard.lastPageId = dashboard.pages[0]?.id;
			}
		});
	}

	async addDashboard(
		workspace: DashboardWorkspace,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			if (store.dashboards.some((item) => item.id === workspace.id)) {
				return;
			}
			const takenPageIds = new Set(
				store.dashboards.flatMap((item) =>
					item.pages.map((page) => page.id),
				),
			);
			const pages =
				workspace.pages.length > 0
					? workspace.pages
					: [
							{
								id: uniqueId(
									`page:default-${slugOf(workspace.id)}`,
									takenPageIds,
								),
								name: DEFAULT_PAGE_NAME,
								components: [],
							},
						];
			const lastPageId =
				workspace.lastPageId ?? pages[0]?.id;
			const dashboard: DashboardWorkspace = {
				id: workspace.id,
				name: workspace.name,
				pages,
			};
			if (
				lastPageId &&
				pages.some((page) => page.id === lastPageId)
			) {
				dashboard.lastPageId = lastPageId;
			}
			store.dashboards.push(dashboard);
			store.activeDashboardId = dashboard.id;
		});
	}

	async renameDashboard(
		dashboardId: string,
		name: string,
	): Promise<DashboardStoreData> {
		const trimmed = name.trim();
		return this.mutate((store) => {
			if (!trimmed) return;
			const dashboard = store.dashboards.find(
				(item) => item.id === dashboardId,
			);
			if (dashboard) dashboard.name = trimmed;
		});
	}

	async duplicateDashboard(
		dashboardId: string,
		name: string,
	): Promise<DashboardStoreData> {
		const trimmed = name.trim();
		return this.mutate((store) => {
			const source = store.dashboards.find(
				(item) => item.id === dashboardId,
			);
			if (!source) return;

			const timestamp = Date.now();
			const takenDashboardIds = new Set(
				store.dashboards.map((item) => item.id),
			);
			const takenPageIds = new Set(
				store.dashboards.flatMap((item) =>
					item.pages.map((page) => page.id),
				),
			);
			const takenComponentIds = new Set(
				store.dashboards.flatMap((item) =>
					item.pages.flatMap((page) =>
						page.components.map((component) => component.id),
					),
				),
			);

			const newId = uniqueId(`dashboard:${timestamp}`, takenDashboardIds);

			const pages: DashboardPage[] = source.pages.map(
				(page, pageIndex) => {
					const pageId = uniqueId(
						`page:${timestamp}-${pageIndex + 1}`,
						takenPageIds,
					);
					takenPageIds.add(pageId);
					const components = page.components.map(
						(component, componentIndex) => {
							const componentId = uniqueId(
								`component:${timestamp}-${pageIndex + 1}-${componentIndex + 1}`,
								takenComponentIds,
							);
							takenComponentIds.add(componentId);
							return {
								...structuredClone(component),
								id: componentId,
							};
						},
					);
					return { id: pageId, name: page.name, components };
				},
			);

			const dashboard: DashboardWorkspace = {
				id: newId,
				name: trimmed.length > 0 ? trimmed : source.name,
				pages,
			};
			const lastIndex = source.pages.findIndex(
				(page) => page.id === source.lastPageId,
			);
			const lastPage = pages[lastIndex >= 0 ? lastIndex : 0];
			if (lastPage) dashboard.lastPageId = lastPage.id;

			store.dashboards.push(dashboard);
			store.activeDashboardId = dashboard.id;
		});
	}

	async removeDashboard(
		dashboardId: string,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			// The last dashboard is never removed: the ribbon needs a landing.
			if (store.dashboards.length <= 1) return;
			const remaining = store.dashboards.filter(
				(item) => item.id !== dashboardId,
			);
			if (remaining.length === store.dashboards.length) return;
			store.dashboards = remaining;
			if (store.activeDashboardId === dashboardId) {
				store.activeDashboardId = store.dashboards[0]?.id;
			}
		});
	}

	async setActiveDashboard(
		dashboardId: string,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			if (store.dashboards.some((item) => item.id === dashboardId)) {
				store.activeDashboardId = dashboardId;
			}
		});
	}

	async setLastPage(
		dashboardId: string,
		pageId: string,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const dashboard = store.dashboards.find(
				(item) => item.id === dashboardId,
			);
			if (!dashboard) return;
			if (!dashboard.pages.some((page) => page.id === pageId)) return;
			dashboard.lastPageId = pageId;
		});
	}

	referenceCount(store: DashboardStoreData, queryId: string): number {
		return store.dashboards.reduce(
			(total, dashboard) =>
				total +
				dashboard.pages.reduce(
					(sum, page) =>
						sum +
						page.components.filter(
							(component) => component.queryId === queryId,
						).length,
					0,
				),
			0,
		);
	}

	async addQuery(
		query: DashboardStoreData["queries"][number],
	): Promise<DashboardStoreData> {
		return this.mutate((draft) => {
			draft.queries.push(query);
		});
	}

	async updateQuery(
		query: DashboardStoreData["queries"][number],
	): Promise<DashboardStoreData> {
		return this.mutate((draft) => {
			const index = draft.queries.findIndex((item) => item.id === query.id);
			if (index >= 0) draft.queries[index] = query;
		});
	}

	async deleteQuery(queryId: string): Promise<DashboardStoreData> {
		return this.mutate((draft) => {
			draft.queries = draft.queries.filter((item) => item.id !== queryId);
		});
	}

	exportJson(store: DashboardStoreData): string {
		return JSON.stringify(store, null, 2);
	}

	importJson(text: string): DashboardStoreData | null {
		try {
			const parsed: unknown = JSON.parse(text);
			return this.normalize(parsed);
		} catch (error) {
			console.warn("IOTO Dashboard: import failed", error);
			return null;
		}
	}

	current(store: DashboardStoreData) {
		return activePageOf(activeDashboard(store));
	}
}
