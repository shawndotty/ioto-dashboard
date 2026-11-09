import type { CountBasis } from "../metrics/types";
import type { QueryDefinition } from "../query/types";

export const DASHBOARD_SCHEMA_VERSION = 3;
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

export interface DashboardPage {
	id: string;
	name: string;
	components: DashboardComponentConfig[];
}

export interface DashboardStoreData {
	schemaVersion: number;
	pages: DashboardPage[];
	activePageId?: string;
	/** Only `user:*` queries are persisted here. */
	queries: QueryDefinition[];
}

export const DEFAULT_PAGE_ID = "page:default";

export function createDefaultStore(): DashboardStoreData {
	return {
		schemaVersion: DASHBOARD_SCHEMA_VERSION,
		pages: [
			{
				id: DEFAULT_PAGE_ID,
				name: "Page 1",
				components: [],
			},
		],
		activePageId: DEFAULT_PAGE_ID,
		queries: [],
	};
}

export function activePage(
	store: DashboardStoreData,
): DashboardPage | undefined {
	return (
		store.pages.find((item) => item.id === store.activePageId) ??
		store.pages[0]
	);
}
