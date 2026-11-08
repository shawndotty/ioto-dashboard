import type { DashboardComponentConfig, DashboardStoreData } from "./types";
import {
	DASHBOARD_SCHEMA_VERSION,
	DASHBOARD_STORE_KEY,
	activeDashboard,
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

function isDashboard(value: unknown): boolean {
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
		const dashboards = Array.isArray(raw.dashboards)
			? raw.dashboards
					.filter(isDashboard)
					.map((dashboard) => {
						const record = dashboard as Record<string, unknown>;
						return {
							id: record.id as string,
							name:
								typeof record.name === "string"
									? record.name
									: "My Dashboard",
							components: (record.components as unknown[]).filter(
								isComponent,
							),
						};
					})
			: [];
		const source =
			dashboards.length > 0 ? dashboards : createDefaultStore().dashboards;
		const queries = Array.isArray(raw.queries)
			? raw.queries.filter(isQuery)
			: [];
		const activeId =
			typeof raw.activeDashboardId === "string" &&
			source.some((item) => item.id === raw.activeDashboardId)
				? raw.activeDashboardId
				: source[0]?.id;
		const store: DashboardStoreData = {
			schemaVersion: DASHBOARD_SCHEMA_VERSION,
			dashboards: source,
			queries: queries as DashboardStoreData["queries"],
		};
		if (activeId) store.activeDashboardId = activeId;
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
		dashboardId: string,
		component: DashboardComponentConfig,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const dashboard = store.dashboards.find(
				(item) => item.id === dashboardId,
			);
			if (dashboard) dashboard.components.push(component);
		});
	}

	async updateComponent(
		dashboardId: string,
		componentId: string,
		patch: Partial<DashboardComponentConfig>,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const dashboard = store.dashboards.find(
				(item) => item.id === dashboardId,
			);
			const component = dashboard?.components.find(
				(item) => item.id === componentId,
			);
			if (component) Object.assign(component, patch);
		});
	}

	async removeComponent(
		dashboardId: string,
		componentId: string,
	): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			const dashboard = store.dashboards.find(
				(item) => item.id === dashboardId,
			);
			if (!dashboard) return;
			dashboard.components = dashboard.components.filter(
				(item) => item.id !== componentId,
			);
		});
	}

	referenceCount(store: DashboardStoreData, queryId: string): number {
		return store.dashboards.reduce(
			(total, dashboard) =>
				total +
				dashboard.components.filter(
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

	async setActiveDashboard(dashboardId: string): Promise<DashboardStoreData> {
		return this.mutate((store) => {
			if (store.dashboards.some((item) => item.id === dashboardId)) {
				store.activeDashboardId = dashboardId;
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
		return activeDashboard(store);
	}
}
