import { TFile } from "obsidian";

export type Category = "Input" | "Output" | "Outcome";

export interface FilterState {
	name: string;
	project: string;
	dateType: "created" | "modified";
	dateStart: string;
	dateEnd: string;
	datePreset:
		| "all"
		| "last3days"
		| "last7days"
		| "last14days"
		| "last30days"
		| "custom";
	status: "all" | "completed" | "incomplete";
}

export interface TaskItem {
	file: TFile;
	content: string;
	status: string;
	line: number;
}

export type SortOption = "modified" | "created" | "name";
export type SortOrder = "asc" | "desc";
