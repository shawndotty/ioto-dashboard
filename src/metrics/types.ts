import type {
	CustomFilterDef,
	IndexSnapshot,
	SectionRole,
	TaskMarker,
} from "../data/types";
import type { QueryDefinition } from "../query/types";

export type CountBasis = "file" | "section";

/** Which number a metric should report; only meaningful for counting kinds. */
export type MetricMeasure = "count" | "completed" | "open" | "ratio";

export type MetricKind =
	| "note-count"
	| "task-count"
	| "task-completion"
	| "unfinished-tasks"
	| "project-progress"
	| "daily-series";

export interface MetricBucket {
	total: number;
	completed: number;
	open: number;
	cancelled: number;
	other: number;
	/** `null` when `total === 0`; never 0%. */
	ratio: number | null;
}

export interface MetricRequest {
	kind: MetricKind;
	queryId: string;
	basis?: CountBasis;
	/** Counting kinds only; omitted keeps the historical `count` behaviour. */
	measure?: MetricMeasure;
	groupBy?: "project" | "ioType" | "sectionRole";
	limit?: number;
}

export interface UnfinishedTaskItem {
	path: string;
	line: number;
	text: string;
	project?: string;
	noteBasename: string;
	noteMtime: number;
	sectionRole: SectionRole;
}

export interface ProjectPendingTask {
	path: string;
	line: number;
	/** May be empty; the view falls back to its own placeholder text. */
	text: string;
	/** Only open / in-progress / forwarded / other ever appear here. */
	marker: TaskMarker;
	noteBasename: string;
	noteMtime: number;
}

export interface ProjectPendingCounts {
	open: number;
	inProgress: number;
	forwarded: number;
	other: number;
}

export interface ProjectProgressGroup {
	key: string;
	name: string;
	nameKey?: string;
	folder: string;
	fileCount: number;
	bucket: MetricBucket;
	status?: string;
	dueDate?: string;
	pending?: ProjectPendingTask[];
	pendingTotal?: number;
	pendingCounts?: ProjectPendingCounts;
}

export interface DailyPoint {
	date: string;
	total: number;
	completed: number;
	open: number;
	cancelled: number;
	other: number;
}

export interface MetricResult {
	key: string;
	kind: MetricKind;
	basis: CountBasis;
	scalar?: number;
	bucket?: MetricBucket;
	items?: UnfinishedTaskItem[];
	groups?: ProjectProgressGroup[];
	points?: DailyPoint[];
}

export interface MetricEvaluationContext {
	snapshot: IndexSnapshot;
	getQuery(id: string): QueryDefinition | undefined;
	taskFolder: string;
	customFilters?: CustomFilterDef[];
	now?: () => number;
	dailySeries?: (limit: number) => DailyPoint[];
}

export function metricKey(request: MetricRequest): string {
	return [
		request.kind,
		request.queryId,
		request.basis ?? "",
		request.measure ?? "",
		request.groupBy ?? "",
		request.limit === undefined ? "" : String(request.limit),
	].join("|");
}
