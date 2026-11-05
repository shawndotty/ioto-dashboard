import { TFile } from "obsidian";

export type Category = "Input" | "Output" | "Outcome" | "Tasks" | "Notes";

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

export interface FilterState {
	name: string;
	project: string;
	subject: string;
	dateType: "created" | "modified";
	dateStart: string;
	dateEnd: string;
	datePreset:
		| "all"
		| "last1day"
		| "last3days"
		| "last7days"
		| "last14days"
		| "last30days"
		| "custom";
	status: "all" | "completed" | "incomplete";
	fileStatus: string;
	taskType?: string[]; // "Input" | "Output" | "Outcome"
	noteType?: string[]; // "Input" | "Output" | "Outcome"
	custom?: Record<string, unknown>;
}

export interface TaskItem {
	file: TFile;
	content: string;
	status: string;
	line: number;
	type?: "Input" | "Output" | "Outcome";
}

export type SortOption = "modified" | "created" | "name" | "size";
export type SortOrder = "asc" | "desc";
export type GroupOption = "none" | "project" | "created" | "modified" | "type";

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
