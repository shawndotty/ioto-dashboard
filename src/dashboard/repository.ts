import { moveItem } from "./layout";
import {
	descendantsOf,
	normalizePageTree,
} from "./page-tree";
import {
	cloneWithFreshIds,
	collectComponentIds,
	containsComponent,
	findComponentLocation,
	walkComponents,
} from "./hierarchy";
import {
	isQuery,
	isRecord,
	slugOf,
	toPage,
	uniqueId,
} from "./schema";
import { MAX_COMPONENT_H, MIN_COMPONENT_W } from "./registry";
import { containerColumnsOf } from "./style-settings";
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
import type { ImportPlan } from "./bundle";
import type { CustomFilter } from "../settings";

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

export class ImportApplyError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "ImportApplyError";
	}
}

export interface DashboardRepositoryOptions {
	/** Localised default name for the first dashboard. */
	defaultDashboardName?: () => string;
}

const DEFAULT_DASHBOARD_NAME = "Dashboard 1";
const DEFAULT_PAGE_NAME = "Page 1";

/** Array insert with the same clamping as `moveItem`; omitted index appends. */
function insertAt<T>(list: T[], item: T, index?: number): void {
	const at =
		index === undefined
			? list.length
			: Math.min(list.length, Math.max(0, Math.trunc(index)));
	list.splice(at, 0, item);
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
		return normalizePageTree(pages);
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
			const component = page
				? findComponentLocation(page.components, componentId)?.config
				: undefined;
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

	/**
	 * Reorders a component inside its own parent (page list or container). The
	 * optional `parentId` only validates that the caller reordered the right
	 * level; `null` means the page itself.
	 */
	async moveComponent(
		pageId: string,
		componentId: string,
		toIndex: number,
		parentId?: string | null,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = this.findPage(store, pageId)?.page;
			if (!page) return;
			const location = findComponentLocation(page.components, componentId);
			if (!location) return;
			if (
				parentId !== undefined &&
				(location.parent?.id ?? null) !== parentId
			) {
				return;
			}
			const siblings = location.siblings;
			const from = location.index;
			const to = Math.min(
				siblings.length - 1,
				Math.max(0, Math.trunc(toIndex)),
			);
			if (to === from) return;
			const [moved] = siblings.splice(from, 1);
			if (moved) siblings.splice(to, 0, moved);
		});
	}

	/**
	 * Reorders a page inside its dashboard. `lastPageId` is intentionally
	 * untouched: order and the remembered page are independent concerns.
	 *
	 * `toIndex` is an index within the page's own layer: a group index for a
	 * top-level page (its children travel with it), or a sibling index for a
	 * subpage (clamped to its own group).
	 */
	async movePage(pageId: string, toIndex: number): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const hit = this.findPage(store, pageId);
			if (!hit) return;
			const { dashboard, page } = hit;
			const pages = dashboard.pages;
			const target = Math.trunc(toIndex);

			if (page.parentId) {
				const parentIndex = pages.findIndex(
					(item) => item.id === page.parentId,
				);
				if (parentIndex < 0) return;
				const siblings = pages.filter(
					(item) => item.parentId === page.parentId,
				);
				const from = siblings.indexOf(page);
				const to = Math.min(
					siblings.length - 1,
					Math.max(0, target),
				);
				if (from < 0 || to === from) return;
				dashboard.pages = moveItem(
					pages,
					parentIndex + 1 + from,
					parentIndex + 1 + to,
				);
				return;
			}

			const groups = pages.filter((item) => !item.parentId);
			const from = groups.indexOf(page);
			const to = Math.min(groups.length - 1, Math.max(0, target));
			if (from < 0 || to === from) return;
			const blockIds = new Set([
				page.id,
				...descendantsOf(pages, page.id).map((item) => item.id),
			]);
			const block = pages.filter((item) => blockIds.has(item.id));
			const rest = pages.filter((item) => !blockIds.has(item.id));
			// After removing the block, `to` still means "the group at that visual
			// position"; clamp to the end when the position no longer exists.
			const restGroups = rest.filter((item) => !item.parentId);
			const anchor = restGroups[to];
			const insertAt = anchor ? rest.indexOf(anchor) : rest.length;
			dashboard.pages = [
				...rest.slice(0, insertAt),
				...block,
				...rest.slice(insertAt),
			];
		});
	}

	/**
	 * Moves a page under `parentId` (top level only, one level deep) or back to
	 * the top level with `null`. Invalid requests are silently ignored.
	 */
	async setPageParent(
		pageId: string,
		parentId: string | null,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const hit = this.findPage(store, pageId);
			if (!hit) return;
			const { dashboard, page } = hit;
			if (parentId === null) {
				if (!page.parentId) return;
				delete page.parentId;
				dashboard.pages = normalizePageTree(dashboard.pages);
				return;
			}
			if (parentId === pageId) return;
			const parent = dashboard.pages.find((item) => item.id === parentId);
			if (!parent || parent.parentId) return;
			if (descendantsOf(dashboard.pages, pageId).length > 0) return;
			const rest = dashboard.pages.filter((item) => item.id !== pageId);
			const childCount = rest.filter(
				(item) => item.parentId === parentId,
			).length;
			const end = rest.indexOf(parent) + 1 + childCount;
			page.parentId = parentId;
			rest.splice(end, 0, page);
			dashboard.pages = normalizePageTree(rest);
		});
	}

	/**
	 * Cross-page relocation: unlike `moveComponent` (index reorder inside one
	 * page), this removes the component from `fromPageId` and inserts it into
	 * `toPageId` in a single write. The id and all configuration are preserved.
	 * Returns `null` for same-page requests, unknown pages, a missing component
	 * or an id already present on the target page.
	 */
	async transferComponent(
		fromPageId: string,
		componentId: string,
		toPageId: string,
		toIndex?: number,
	): Promise<{ store: DashboardStoreData; componentId: string } | null> {
		if (fromPageId === toPageId) return null;
		let moved = false;
		const store = await this.mutate((data) => {
			const source = this.findPage(data, fromPageId)?.page;
			const target = this.findPage(data, toPageId)?.page;
			if (!source || !target) return;
			const location = findComponentLocation(source.components, componentId);
			if (!location || location.depth !== 0) return;
			if (target.components.some((item) => item.id === componentId)) return;
			const [component] = location.siblings.splice(location.index, 1);
			if (!component) return;
			const at =
				toIndex === undefined
					? target.components.length
					: Math.min(
							target.components.length,
							Math.max(0, Math.trunc(toIndex)),
						);
			target.components.splice(at, 0, component);
			moved = true;
		});
		return moved ? { store, componentId } : null;
	}

	async removeComponent(
		pageId: string,
		componentId: string,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = this.findPage(store, pageId)?.page;
			if (!page) return;
			const location = findComponentLocation(page.components, componentId);
			if (!location) return;
			// Removing a container takes its whole subtree with it.
			location.siblings.splice(location.index, 1);
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
			const location = findComponentLocation(page.components, componentId);
			if (!location) return;
			const taken = new Set(
				data.dashboards.flatMap((item) =>
					item.pages.flatMap((p) => collectComponentIds(p.components)),
				),
			);
			const copy = cloneWithFreshIds(location.config, () => {
				const id = uniqueId(`component:${Date.now()}`, taken);
				taken.add(id);
				return id;
			});
			newId = copy.id;
			if (title !== undefined) copy.title = title;
			location.siblings.splice(location.index + 1, 0, copy);
		});
		return newId ? { store, componentId: newId } : null;
	}

	/**
	 * Moves a top-level component into a top-level container (`targetContainerId`)
	 * or a child back to the page (`null`). Guards keep the tree at depth 1:
	 * the target must be a page-level container, containers never nest, and a
	 * component can never move into its own subtree. Omitting `toIndex` keeps the
	 * historical append-at-end behaviour.
	 */
	async reparentComponent(
		pageId: string,
		componentId: string,
		targetContainerId: string | null,
		toIndex?: number,
	): Promise<DashboardStoreData | null> {
		let moved = false;
		const store = await this.mutate((data) => {
			const page = this.findPage(data, pageId)?.page;
			if (!page) return;
			const source = findComponentLocation(page.components, componentId);
			if (!source) return;
			if (targetContainerId === componentId) return;
			if (targetContainerId === null) {
				// Only children can leave a container.
				if (!source.parent) return;
				source.siblings.splice(source.index, 1);
				insertAt(page.components, source.config, toIndex);
				moved = true;
				return;
			}
			const target = findComponentLocation(page.components, targetContainerId);
			if (!target || target.depth !== 0) return;
			if (target.config.type !== "container") return;
			// A container is itself a subtree and must stay at page level.
			if (source.config.type === "container") return;
			if (containsComponent(source.config, targetContainerId)) return;
			if (source.parent?.id === targetContainerId) return;
			source.siblings.splice(source.index, 1);
			// Clamp only downwards: a child never grows to fill the container.
			const columns = Math.max(
				MIN_COMPONENT_W,
				containerColumnsOf(target.config.options),
			);
			const width = source.config.w ?? columns;
			source.config.w = Math.min(columns, Math.max(MIN_COMPONENT_W, width));
			if (source.config.h !== undefined) {
				source.config.h = Math.min(
					MAX_COMPONENT_H,
					Math.max(1, source.config.h),
				);
			}
			const children =
				target.config.children ?? (target.config.children = []);
			insertAt(children, source.config, toIndex);
			moved = true;
		});
		return moved ? store : null;
	}

	/** Removes a container frame and re-appends its children to the page. */
	async dissolveContainer(
		pageId: string,
		containerId: string,
	): Promise<DashboardStoreData | null> {
		let dissolved = false;
		const store = await this.mutate((data) => {
			const page = this.findPage(data, pageId)?.page;
			if (!page) return;
			const location = findComponentLocation(page.components, containerId);
			if (!location || location.depth !== 0) return;
			if (location.config.type !== "container") return;
			const children = location.config.children ?? [];
			location.siblings.splice(location.index, 1);
			page.components.push(...children);
			dissolved = true;
		});
		return dissolved ? store : null;
	}

	/**
	 * Copies a page (layout + components) right after the source. Page-level
	 * `columns` / `rowHeight` ride along via `structuredClone`, and every page /
	 * component id is regenerated against the whole store. `lastPageId` is left
	 * untouched on purpose: the caller switches pages itself.
	 */
	async duplicatePage(
		pageId: string,
		name?: string,
	): Promise<{ store: DashboardStoreData; pageId: string } | null> {
		let newPageId: string | null = null;
		const store = await this.mutate((data) => {
			const hit = this.findPage(data, pageId);
			if (!hit) return;
			const { dashboard, page } = hit;
			const index = dashboard.pages.indexOf(page);

			const takenPageIds = new Set(
				data.dashboards.flatMap((item) =>
					item.pages.map((p) => p.id),
				),
			);
			const takenComponentIds = new Set(
				data.dashboards.flatMap((item) =>
					item.pages.flatMap((p) =>
						collectComponentIds(p.components),
					),
				),
			);

			const pageBase = `page:${Date.now()}`;
			newPageId = uniqueId(pageBase, takenPageIds);
			takenPageIds.add(newPageId);
			const components = page.components.map((component) =>
				cloneWithFreshIds(component, () => {
					const componentId = uniqueId(
						`component:${Date.now()}`,
						takenComponentIds,
					);
					takenComponentIds.add(componentId);
					return componentId;
				}),
			);
			const copy: DashboardPage = {
				...structuredClone(page),
				id: newPageId,
				components,
			};
			const trimmed = name?.trim();
			if (trimmed) copy.name = trimmed;
			// A page copy never carries subpages: parent copies land after the
			// whole source group, subpage copies right after the source page.
			const insertAt = page.parentId
				? index + 1
				: index + 1 + descendantsOf(dashboard.pages, page.id).length;
			dashboard.pages.splice(insertAt, 0, copy);
		});
		return newPageId ? { store, pageId: newPageId } : null;
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
			const parent = page.parentId
				? dashboard.pages.find((item) => item.id === page.parentId)
				: undefined;
			if (parent && !parent.parentId) {
				const childCount = dashboard.pages.filter(
					(item) => item.parentId === parent.id,
				).length;
				dashboard.pages.splice(
					dashboard.pages.indexOf(parent) + 1 + childCount,
					0,
					page,
				);
			} else {
				delete page.parentId;
				dashboard.pages.push(page);
			}
			dashboard.pages = normalizePageTree(dashboard.pages);
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
			// Deleting a parent takes its subpages with it.
			const removed = new Set([
				pageId,
				...descendantsOf(dashboard.pages, pageId).map(
					(page) => page.id,
				),
			]);
			// The dashboard always needs a canvas: judge by what is left.
			if (dashboard.pages.length - removed.size <= 0) return;
			dashboard.pages = dashboard.pages.filter(
				(page) => !removed.has(page.id),
			);
			if (dashboard.lastPageId && removed.has(dashboard.lastPageId)) {
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
						collectComponentIds(page.components),
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
					const components = page.components.map((component) =>
						cloneWithFreshIds(component, () => {
							const componentId = uniqueId(
								`component:${timestamp}-${pageIndex + 1}`,
								takenComponentIds,
							);
							takenComponentIds.add(componentId);
							return componentId;
						}),
					);
					return { ...structuredClone(page), id: pageId, components };
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
						walkComponents(page.components).filter(
							(location) =>
								location.config.queryId === queryId,
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

	/**
	 * Applies a planned import in one `data.json` write: store and (optional)
	 * custom filters land together, followed by a single change notification.
	 * A damaged store is never overwritten.
	 */
	async applyImport(plan: ImportPlan): Promise<{
		store: DashboardStoreData;
		customFilters?: CustomFilter[];
	}> {
		const { store, damaged } = await this.load();
		if (damaged) {
			throw new ImportApplyError(
				"damaged",
				"Dashboard data is damaged; import was not applied.",
			);
		}
		const next = structuredClone(store);

		if (plan.mode === "replace") {
			if (plan.dashboards.length === 0) {
				throw new ImportApplyError(
					"empty-backup",
					"Backup contains no dashboards.",
				);
			}
			next.dashboards = plan.dashboards;
			next.activeDashboardId = plan.dashboards[0]?.id;
		} else {
			next.queries.push(...plan.queries);
			next.dashboards.push(...plan.dashboards);
			if (plan.pages.length > 0) {
				const dashboardId =
					plan.targetDashboardId ?? next.activeDashboardId;
				const dashboard = next.dashboards.find(
					(item) => item.id === dashboardId,
				);
				if (!dashboard) {
					throw new ImportApplyError(
						"missing-target",
						"Target dashboard no longer exists.",
					);
				}
				dashboard.pages = normalizePageTree([
					...dashboard.pages,
					...plan.pages,
				]);
			}
		}
		next.schemaVersion = DASHBOARD_SCHEMA_VERSION;

		let mergedFilters: CustomFilter[] | undefined;
		await this.host.updateData((data) => {
			data[DASHBOARD_STORE_KEY] = next;
			if (plan.customFilters.length > 0) {
				const existing = Array.isArray(data.customFilters)
					? (data.customFilters as CustomFilter[])
					: [];
				const names = new Set(existing.map((item) => item.name));
				const additions = plan.customFilters.filter(
					(item) => !names.has(item.name),
				);
				if (additions.length > 0) {
					mergedFilters = [...existing, ...additions];
					data.customFilters = mergedFilters;
				}
			}
		});
		this.notify(next);
		return { store: next, customFilters: mergedFilters };
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
