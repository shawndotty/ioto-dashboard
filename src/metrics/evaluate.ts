import {
	ALL_SECTION_ROLES,
	DEFAULT_SCOPE_SECTIONS,
	type NoteRecord,
	type SectionRole,
	type TaskRecord,
} from "../data/types";
import { resolveQuery } from "../query/resolve";
import type { QueryDefinition } from "../query/types";
import { listProjectUniverse } from "./project";
import {
	metricKey,
	type CountBasis,
	type MetricBucket,
	type MetricEvaluationContext,
	type MetricRequest,
	type MetricResult,
	type ProjectPendingCounts,
	type ProjectPendingTask,
	type ProjectProgressGroup,
	type UnfinishedTaskItem,
} from "./types";

export function emptyBucket(): MetricBucket {
	return {
		total: 0,
		completed: 0,
		open: 0,
		cancelled: 0,
		other: 0,
		ratio: null,
	};
}

export function bucketOf(tasks: TaskRecord[]): MetricBucket {
	const bucket = emptyBucket();
	for (const task of tasks) {
		bucket.total += 1;
		if (task.marker === "done") bucket.completed += 1;
		else if (task.marker === "open") bucket.open += 1;
		else if (task.marker === "cancelled") bucket.cancelled += 1;
		else bucket.other += 1;
	}
	bucket.ratio = bucket.total === 0 ? null : bucket.completed / bucket.total;
	return bucket;
}

function effectiveBasis(request: MetricRequest): CountBasis {
	return request.basis ?? "file";
}

function sectionsFor(query: QueryDefinition): SectionRole[] {
	return query.scope.sections ?? DEFAULT_SCOPE_SECTIONS;
}

function resolvedNotes(
	ctx: MetricEvaluationContext,
	query: QueryDefinition,
): NoteRecord[] {
	if (query.target !== "note") return [];
	return resolveQuery(ctx.snapshot, query, {
		customFilters: ctx.customFilters,
		now: ctx.now,
	}).notes;}

/** The task set a metric counts; `basis` is interpreted here, never in components. */
function collectTasks(
	ctx: MetricEvaluationContext,
	query: QueryDefinition,
	basis: CountBasis,
): TaskRecord[] {
	if (query.target === "task") {
		return resolveQuery(ctx.snapshot, query, {
			customFilters: ctx.customFilters,
			sections: basis === "file" ? ALL_SECTION_ROLES : undefined,
			now: ctx.now,
		}).tasks;
	}
	const paths = new Set(resolvedNotes(ctx, query).map((note) => note.path));
	const tasks = ctx.snapshot.tasks.filter((task) => paths.has(task.path));
	if (basis === "file") return tasks;
	const sections = sectionsFor(query);
	return tasks.filter((task) => sections.includes(task.sectionRole));
}

function byNoteRecency(a: TaskRecord, b: TaskRecord): number {
	return (
		b.noteMtime - a.noteMtime ||
		a.path.localeCompare(b.path) ||
		a.line - b.line
	);
}

function unfinishedItems(tasks: TaskRecord[], limit: number): UnfinishedTaskItem[] {
	return tasks
		.filter((task) => task.marker === "open" && task.text.trim().length > 0)
		.sort(byNoteRecency)
		.slice(0, limit)
		.map((task) => ({
			path: task.path,
			line: task.line,
			text: task.text,
			project: task.project,
			noteBasename: task.noteBasename,
			noteMtime: task.noteMtime,
			sectionRole: task.sectionRole,
		}));
}

export const PENDING_LIST_LIMIT = 200;

/**
 * Tasks shown by the project drill-down. Counts always come from the
 * untruncated set so they stay equal to the row's `bucket.open + bucket.other`.
 */
export function buildPendingSnapshot(
	tasks: TaskRecord[],
	limit: number = PENDING_LIST_LIMIT,
): {
	items: ProjectPendingTask[];
	total: number;
	counts: ProjectPendingCounts;
} {
	const counts: ProjectPendingCounts = {
		open: 0,
		inProgress: 0,
		forwarded: 0,
		other: 0,
	};
	const pending: TaskRecord[] = [];
	for (const task of tasks) {
		if (task.marker === "done" || task.marker === "cancelled") continue;
		pending.push(task);
		if (task.marker === "open") counts.open += 1;
		else if (task.marker === "in-progress") counts.inProgress += 1;
		else if (task.marker === "forwarded") counts.forwarded += 1;
		else counts.other += 1;
	}
	const items = [...pending]
		.sort(byNoteRecency)
		.slice(0, limit)
		.map((task) => ({
			path: task.path,
			line: task.line,
			text: task.text,
			marker: task.marker,
			noteBasename: task.noteBasename,
			noteMtime: task.noteMtime,
		}));
	return { items, total: pending.length, counts };
}

function projectInScope(
	folder: string,
	query: QueryDefinition,
	includeSubfolders: boolean,
): boolean {
	const paths = query.scope.folders;
	if (paths.length === 0) return true;
	const matched = paths.some((path) =>
		includeSubfolders
			? folder === path || folder.startsWith(`${path}/`)
			: folder === path,
	);
	return matched;
}

function projectGroups(
	ctx: MetricEvaluationContext,
	query: QueryDefinition,
	tasks: TaskRecord[],
): ProjectProgressGroup[] {
	const universe = listProjectUniverse(ctx.snapshot, ctx.taskFolder);
	const includeSubfolders = query.scope.includeSubfolders ?? true;
	const known = new Set(universe.map((project) => project.key));
	const byProject = new Map<string, TaskRecord[]>();
	const loose: TaskRecord[] = [];
	for (const task of tasks) {
		if (!task.project || !known.has(task.project)) {
			loose.push(task);
			continue;
		}
		const list = byProject.get(task.project);
		if (list) list.push(task);
		else byProject.set(task.project, [task]);
	}

	const groups: ProjectProgressGroup[] = universe
		.filter((project) =>
			projectInScope(project.folder, query, includeSubfolders),
		)
		.map((project) => {
			const projectTasks = byProject.get(project.key) ?? [];
			const record = ctx.snapshot.projects.find(
				(item) => item.folder === project.folder,
			);
			const pending = buildPendingSnapshot(projectTasks);
			return {
				key: project.key,
				name: project.name,
				folder: project.folder,
				fileCount: ctx.snapshot.notes.filter((note) =>
					note.path.startsWith(`${project.folder}/`),
				).length,
				bucket: bucketOf(projectTasks),
				status: record?.status,
				dueDate: record?.dueDate,
				pending: pending.items,
				pendingTotal: pending.total,
				pendingCounts: pending.counts,
			};
		});

	if (loose.length > 0) {
		const pending = buildPendingSnapshot(loose);
		groups.push({
			key: "",
			name: "Unclassified",
			nameKey: "QUERY_UNCLASSIFIED",
			folder: "",
			fileCount: 0,
			bucket: bucketOf(loose),
			pending: pending.items,
			pendingTotal: pending.total,
			pendingCounts: pending.counts,
		});
	}
	return groups;
}

export function evaluateMetric(
	request: MetricRequest,
	ctx: MetricEvaluationContext,
): MetricResult {
	const key = metricKey(request);
	const basis = effectiveBasis(request);
	if (request.kind === "daily-series") {
		return {
			key,
			kind: request.kind,
			basis,
			points: ctx.dailySeries?.(request.limit ?? 30) ?? [],
		};
	}

	const query = ctx.getQuery(request.queryId);
	if (!query) {
		return { key, kind: request.kind, basis };
	}

	const tasks = collectTasks(ctx, query, basis);
	const result: MetricResult = { key, kind: request.kind, basis };

	switch (request.kind) {
		case "note-count":
			result.scalar =
				query.target === "note"
					? resolvedNotes(ctx, query).length
					: new Set(tasks.map((task) => task.path)).size;
			break;
		case "task-count": {
			const measure = request.measure ?? "count";
			if (measure === "completed" || measure === "open" || measure === "ratio") {
				const bucket = bucketOf(tasks);
				if (measure === "ratio") result.bucket = bucket;
				else result.scalar = measure === "completed" ? bucket.completed : bucket.open;
			} else {
				result.scalar = tasks.length;
			}
			break;
		}
		case "task-completion":
			result.bucket = bucketOf(tasks);
			break;
		case "unfinished-tasks":
			result.items = unfinishedItems(tasks, request.limit ?? 20);
			break;
		case "project-progress":
			result.groups = projectGroups(ctx, query, tasks);
			break;
	}
	return result;
}

export function evaluateMetrics(
	requests: MetricRequest[],
	ctx: MetricEvaluationContext,
): Map<string, MetricResult> {
	const results = new Map<string, MetricResult>();
	for (const request of requests) {
		const key = metricKey(request);
		if (results.has(key)) continue;
		results.set(key, evaluateMetric(request, ctx));
	}
	return results;
}
