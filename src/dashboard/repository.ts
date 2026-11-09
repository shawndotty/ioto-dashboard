import type {
	DashboardComponentConfig,
	DashboardPage,
	DashboardStoreData,
} from "./types";
import {
	DASHBOARD_SCHEMA_VERSION,
	DASHBOARD_STORE_KEY,
	activePage,
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
		(value.target === "note" || value.target === "task") &&
		isRecord(value.scope) &&
		isRecord(value.filters)
	);
}

export class DashboardRepository {
	constructor(private host: DashboardDataHost) {}

	async load(): Promise<DashboardLoadResult> {
		const data = await this.host.readData();
		const raw = isRecord(data) ? data[DASHBOARD_STORE_KEY] : undefined;
		if (raw === undefined) {
			const store = createDefaultStore();
			await this.save(store);
			return { store, damaged: false };
		}
		const store = this.normalize(raw);
		if (!store) return { store: createDefaultStore(), damaged: true };
		return { store, damaged: false };
	}

	private normalize(raw: unknown): DashboardStoreData | null {
		if (!isRecord(raw)) return null;
		const candidates = Array.isArray(raw.pages)
			? raw.pages
			: Array.isArray(raw.dashboards)
				? raw.dashboards
				: [];
		const pages = candidates
			.filter(isPage)
			.map((page) => ({
				id: page.id,
				name: typeof page.name === "string" ? page.name : "Page 1",
				components: page.components.filter(isComponent),
			}));
		const source = pages.length > 0 ? pages : createDefaultStore().pages;
		const queries = Array.isArray(raw.queries)
			? raw.queries.filter(isQuery)
			: [];
		const requestedId =
			typeof raw.activePageId === "string"
				? raw.activePageId
				: typeof raw.activeDashboardId === "string"
					? raw.activeDashboardId
					: undefined;
		const activeId =
			requestedId && source.some((item) => item.id === requestedId)
				? requestedId
				: source[0]?.id;
		const store: DashboardStoreData = {
			schemaVersion: DASHBOARD_SCHEMA_VERSION,
			pages: source,
			queries: queries as DashboardStoreData["queries"],
		};
		if (activeId) store.activePageId = activeId;
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

	async addComponent(
		pageId: string,
		component: DashboardComponentConfig,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = store.pages.find((item) => item.id === pageId);
			if (page) page.components.push(component);
		});
	}

	async updateComponent(
		pageId: string,
		componentId: string,
		patch: Partial<DashboardComponentConfig>,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = store.pages.find((item) => item.id === pageId);
			const component = page?.components.find(
				(item) => item.id === componentId,
			);
			if (component) Object.assign(component, patch);
		});
	}

	async moveComponent(
		pageId: string,
		componentId: string,
		toIndex: number,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const page = store.pages.find((item) => item.id === pageId);
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
			const page = store.pages.find((item) => item.id === pageId);
			if (!page) return;
			page.components = page.components.filter(
				(item) => item.id !== componentId,
			);
		});
	}

	async addPage(page: DashboardPage): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			if (store.pages.some((item) => item.id === page.id)) return;
			store.pages.push(page);
		});
	}

	async renamePage(pageId: string, name: string): Promise<DashboardStoreData> {
		const trimmed = name.trim();
		return this.mutate((store) => {
			if (!trimmed) return;
			const page = store.pages.find((item) => item.id === pageId);
			if (page) page.name = trimmed;
		});
	}

	async removePage(pageId: string): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			// The last page is never removed: the view needs a canvas.
			if (store.pages.length <= 1) return;
			const remaining = store.pages.filter((page) => page.id !== pageId);
			if (remaining.length === store.pages.length) return;
			store.pages = remaining;
			if (store.activePageId === pageId) {
				store.activePageId = remaining[0]?.id;
			}
		});
	}

	referenceCount(store: DashboardStoreData, queryId: string): number {
		return store.pages.reduce(
			(total, page) =>
				total +
				page.components.filter(
					(component) => component.queryId === queryId,
				).length,
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

	async setActivePage(pageId: string): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			if (store.pages.some((item) => item.id === pageId)) {
				store.activePageId = pageId;
			}
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
		return activePage(store);
	}
}
