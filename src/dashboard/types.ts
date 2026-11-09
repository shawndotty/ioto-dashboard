import type { CountBasis } from "../metrics/types";
import type { QueryDefinition } from "../query/types";

export const DASHBOARD_SCHEMA_VERSION = 4;
export const DASHBOARD_STORE_KEY = "dashboardStore";
export const DEFAULT_DASHBOARD_ID = "dashboard:default";
export const DEFAULT_PAGE_ID = "page:default";

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

export interface DashboardPage {
	id: string;
	name: string;
	components: DashboardComponentConfig[];
}

export interface DashboardWorkspace {
	id: string;
	name: string;
	pages: DashboardPage[];
	/** The page this dashboard was last left on. */
	lastPageId?: string;
}

export interface DashboardStoreData {
	schemaVersion: number;
	dashboards: DashboardWorkspace[];
	/** Default landing target for the ribbon / global commands. */
	activeDashboardId?: string;
	/** Only `user:*` queries are persisted here; shared by every dashboard. */
	queries: QueryDefinition[];
}

export function createDefaultStore(defaultName = "Dashboard 1"): DashboardStoreData {
	return {
		schemaVersion: DASHBOARD_SCHEMA_VERSION,
		dashboards: [
			{
				id: DEFAULT_DASHBOARD_ID,
				name: defaultName,
				pages: [
					{
						id: DEFAULT_PAGE_ID,
						name: "Page 1",
						components: [],
					},
				],
				lastPageId: DEFAULT_PAGE_ID,
			},
		],
		activeDashboardId: DEFAULT_DASHBOARD_ID,
		queries: [],
	};
}

export function activeDashboard(
	store: DashboardStoreData,
): DashboardWorkspace | undefined {
	return (
		store.dashboards.find((item) => item.id === store.activeDashboardId) ??
		store.dashboards[0]
	);
}

export function activePageOf(
	dashboard: DashboardWorkspace | undefined,
): DashboardPage | undefined {
	if (!dashboard) return undefined;
	return (
		dashboard.pages.find((page) => page.id === dashboard.lastPageId) ??
		dashboard.pages[0]
	);
}

export function findDashboardForPage(
	store: DashboardStoreData,
	pageId: string,
): DashboardWorkspace | undefined {
	return store.dashboards.find((dashboard) =>
		dashboard.pages.some((page) => page.id === pageId),
	);
}
