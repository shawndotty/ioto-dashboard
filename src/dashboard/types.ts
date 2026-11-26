import type { CountBasis } from "../metrics/types";
import type { MeasureId, ViewId } from "./dataset/types";
import type { QueryDefinition } from "../query/types";

export const DASHBOARD_SCHEMA_VERSION = 7;
export const DASHBOARD_STORE_KEY = "dashboardStore";
export const DEFAULT_DASHBOARD_ID = "dashboard:default";
export const DEFAULT_PAGE_ID = "page:default";
/** A1 内置页：AI 运行指标；ID 固定，注入以它为幂等判据。 */
export const AI_METRICS_PAGE_ID = "page:ai-metrics";

export interface DashboardComponentConfig {
	id: string;
	type: string;
	queryId: string;
	basis?: CountBasis;
	limit?: number;
	title?: string;
	/** Presentation form; `undefined` falls back to the component default. */
	view?: ViewId;
	/** What the component computes; `undefined` falls back to the component default. */
	measure?: MeasureId;
	/** View-specific display parameters (scalar values only). */
	options?: Record<string, string | number | boolean>;
	/** Schema keeps x/y; the MVP auto-grid only consumes w/h. */
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	/** Only `acceptsChildren` components use this; first version caps depth at 1. */
	children?: DashboardComponentConfig[];
}

export const PAGE_ROW_HEIGHT_MIN = 10;
export const PAGE_ROW_HEIGHT_MAX = 200;
export const PAGE_ROW_HEIGHT_DEFAULT = 72;
export const PAGE_GAP_MIN = 0;
export const PAGE_GAP_MAX = 32;
export const PAGE_GAP_DEFAULT = 12;

export interface DashboardPage {
	id: string;
	name: string;
	/** Parent page id: a top-level page of the same dashboard. Omitted = top level. One level only. */
	parentId?: string;
	/** Page-level layout: 12 (default) or 24 columns. */
	columns?: 12 | 24;
	/** Page-level row height in px. */
	rowHeight?: number;
	/** Page-level grid gap in px; defaults to 12 when omitted. */
	gap?: number;
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

/** 预置页的组件类型/布局写死在代码里；不新增 schema 字段，不升级版本号。 */
export function createAiMetricsPage(name = "AI Metrics"): DashboardPage {
	return {
		id: AI_METRICS_PAGE_ID,
		name,
		components: [
			{
				id: "ai-runs-kpi",
				type: "ai-runs-kpi",
				queryId: "",
				w: 6,
				h: 4,
			},
			{
				id: "ai-runs-agents",
				type: "ai-runs-agents",
				queryId: "",
				w: 6,
				h: 4,
			},
			{
				id: "ai-runs-frequency",
				type: "ai-runs-frequency",
				queryId: "",
				w: 8,
				h: 6,
			},
			{
				id: "ai-runs-schedule",
				type: "ai-runs-schedule",
				queryId: "",
				w: 6,
				h: 6,
			},
			{
				id: "ai-runs-recent",
				type: "ai-runs-recent",
				queryId: "",
				w: 8,
				h: 6,
			},
		],
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
