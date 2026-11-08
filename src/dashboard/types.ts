import type { CountBasis } from "../metrics/types";
import type { QueryDefinition } from "../query/types";

export const DASHBOARD_SCHEMA_VERSION = 2;
export const DASHBOARD_STORE_KEY = "dashboardStore";

export interface DashboardComponentConfig {
	id: string;
	type: string;
	queryId: string;
	basis?: CountBasis;
	limit?: number;
	title?: string;
	/** Schema keeps x/y; the MVP auto-grid only consumes w/h. */
	x?: number;
	y?: number;
	w?: number;
	h?: number;
}

export interface DashboardConfig {
	id: string;
	name: string;
	components: DashboardComponentConfig[];
}

export interface DashboardStoreData {
	schemaVersion: number;
	dashboards: DashboardConfig[];
	activeDashboardId?: string;
	/** Only `user:*` queries are persisted here. */
	queries: QueryDefinition[];
}

export const DEFAULT_DASHBOARD_ID = "dashboard:default";

export function createDefaultStore(): DashboardStoreData {
	return {
		schemaVersion: DASHBOARD_SCHEMA_VERSION,
		dashboards: [
			{
				id: DEFAULT_DASHBOARD_ID,
				name: "My Dashboard",
				components: [],
			},
		],
		activeDashboardId: DEFAULT_DASHBOARD_ID,
		queries: [],
	};
}

export function activeDashboard(
	store: DashboardStoreData,
): DashboardConfig | undefined {
	return (
		store.dashboards.find((item) => item.id === store.activeDashboardId) ??
		store.dashboards[0]
	);
}
