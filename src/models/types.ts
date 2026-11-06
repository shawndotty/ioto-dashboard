export type Category = "Input" | "Output" | "Outcome" | "Tasks" | "Notes";

import type { GroupOption, SortOption, SortOrder } from "../data/types";

export type {
	FilterState,
	GroupOption,
	SortOption,
	SortOrder,
} from "../data/types";

declare module "obsidian" {
	interface App {
		commands: {
			executeCommandById(id: string): void;
		};
		plugins: {
			plugins: {
				[key: string]: unknown;
			};
		};
		dom: {
			appContainerEl: HTMLElement;
		};
	}
	interface MetadataCache {
		getAllPropertyInfos?(): Record<string, unknown>;
	}
}

/**
 * Obsidian types `FrontMatterCache` values as `any`. Narrow frontmatter reads
 * to the shapes this plugin actually consumes so the values stay type-safe.
 */
export type FrontmatterValue =
	| string
	| number
	| boolean
	| string[]
	| null
	| undefined;

export interface PaginationInfo {
	currentPage: number;
	totalPages: number;
	totalItems: number;
	pageSize: number;
	onPageChange: (page: number) => void;
}

/** State persisted by DashboardView / NoteView via ItemView.setState. */
export interface DashboardViewState {
	isZenMode?: boolean;
	activeCategory?: Category;
	activeTab?: "Notes" | "Tasks";
	activeQueryId?: string | null;
	sortOption?: SortOption;
	sortOrder?: SortOrder;
	groupOption?: GroupOption;
}

export type NoteViewState = DashboardViewState;

/** State persisted by TaskView via ItemView.setState. */
export interface TaskViewState {
	isZenMode?: boolean;
	activeQueryId?: string | null;
}
