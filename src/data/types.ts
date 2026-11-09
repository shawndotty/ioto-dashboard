/**
 * Frozen data contract for the dashboard data layer.
 *
 * Rules:
 * - Existing fields may not be renamed or have their semantics changed.
 * - New fields must be optional.
 * - This folder (src/data) must not import UI code (views/**, ui/**, settings,
 *   services). Only `import type` from "obsidian" is allowed.
 */

export type IoType = "Input" | "Output" | "Outcome" | "Task" | "Unknown";

export type SectionRole =
	| "task"
	| "input"
	| "output"
	| "outcome"
	| "goal"
	| "review"
	| "other";

export type TaskMarker =
	| "open"
	| "done"
	| "cancelled"
	| "in-progress"
	| "forwarded"
	| "other";

export interface NoteRecord {
	path: string;
	basename: string;
	folder: string;
	ioType: IoType; // decided by root folder, never by title
	project?: string; // frontmatter Project
	subject?: string | string[];
	status?: string;
	ctime: number;
	mtime: number;
	size: number;
	fileTaskCount: number; // every checkbox in the file (comments stripped, empty skipped)
	fileCompletedCount: number; // only marker === "done"
	sectionTaskCount: number; // tasks inside the default scope sections
	sectionCompletedCount: number;
	frontmatter?: Record<string, unknown>; // kept for frontmatter-driven custom filters
}

export interface TaskRecord {
	path: string;
	line: number;
	marker: TaskMarker;
	isCompleted: boolean; // only marker === "done"
	text: string; // checkbox and %%...%% / <!-- --> stripped
	indent: number;
	ioType: IoType;
	sectionRole: SectionRole;
	sectionHeading: string;
	project?: string;
	noteStatus?: string;
	noteCtime: number;
	noteMtime: number;
	noteBasename: string;
	noteSize: number;
	noteFrontmatter?: Record<string, unknown>; // for frontmatter-driven custom filters
}

export interface TaskScope {
	folders: "task" | "ioo" | "all";
	sections: SectionRole[];
	includeEmptyText: false;
	includePlaceholders: false;
	/** Vault-absolute folders; empty keeps the legacy `folders` enum behaviour. */
	paths?: string[];
	includeSubfolders?: boolean;
}

export const DEFAULT_SCOPE_SECTIONS: SectionRole[] = [
	"task",
	"input",
	"output",
	"outcome",
];

export const ALL_SECTION_ROLES: SectionRole[] = [
	"task",
	"input",
	"output",
	"outcome",
	"goal",
	"review",
	"other",
];

export const DEFAULT_TASK_SCOPE: TaskScope = {
	folders: "task",
	sections: DEFAULT_SCOPE_SECTIONS,
	includeEmptyText: false,
	includePlaceholders: false,
};

export interface ProjectRecord {
	path: string; // path of the _project.md note
	folder: string; // project folder
	name: string; // folder name
	project?: string;
	category?: string;
	startDate?: string;
	dueDate?: string;
	status?: string;
	frontmatter?: Record<string, unknown>;
}

export interface CustomFilterDef {
	name: string;
	type: "text" | "number" | "boolean" | "date" | "list";
	target?: "all" | "note" | "task";
}

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
	taskType?: string[];
	noteType?: string[];
	custom?: Record<string, unknown>;
}

export type SortOption = "modified" | "created" | "name" | "size";
export type SortOrder = "asc" | "desc";
export type GroupOption = "none" | "project" | "created" | "modified" | "type";

export interface SavedQueryLike {
	filters: Partial<FilterState>;
	sortOption?: SortOption;
	sortOrder?: SortOrder;
	groupOption?: GroupOption;
}

export interface SectionHeadings {
	task: string[];
	input: string[];
	output: string[];
	outcome: string[];
	goal: string[];
	review: string[];
}

export interface IndexConfig {
	inputFolder: string;
	outputFolder: string;
	taskFolder: string;
	outcomeFolder: string;
	headings: SectionHeadings;
}

export interface IndexSnapshot {
	notes: NoteRecord[];
	tasks: TaskRecord[];
	projects: ProjectRecord[];
	/** Built on demand (`getSnapshot({ withTree: true })`): every file under the roots. */
	files?: FileRecord[];
	/** Built on demand: recursive aggregates for every folder under the roots. */
	folders?: FolderRecord[];
}

export interface FileRecord {
	path: string;
	basename: string;
	extension: string;
	folder: string;
	size: number;
	ctime: number;
	mtime: number;
}

export interface FolderRecord {
	path: string;
	name: string;
	depth: number;
	directFiles: number;
	directFolders: number;
	fileCount: number;
	noteCount: number;
	totalSize: number;
	latestMtime: number;
}

export interface NoteFacets {
	projects: string[];
	statuses: string[];
	subjects: string[];
}
