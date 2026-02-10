import { TFile } from "obsidian";

export type Category = "Input" | "Output" | "Outcome" | "Tasks" | "Notes";

declare module "obsidian" {
	interface App {
		commands: {
			executeCommandById(id: string): void;
		};
		plugins: {
			plugins: {
				[key: string]: any;
			};
		};
		dom: {
			appContainerEl: HTMLElement;
		};
	}
}

export interface FilterState {
	name: string;
	project: string;
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
	custom?: Record<string, any>;
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
