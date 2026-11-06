import { matchesCustomFilters, matchesDate, matchesName } from "./note-query";
import type {
	CustomFilterDef,
	FilterState,
	SectionRole,
	TaskRecord,
	TaskScope,
} from "./types";

const ROLE_TO_TYPE: Partial<Record<SectionRole, string>> = {
	input: "Input",
	output: "Output",
	outcome: "Outcome",
};

function inScopeFolders(task: TaskRecord, scope: TaskScope): boolean {
	if (scope.folders === "all") return true;
	if (scope.folders === "task") return task.ioType === "Task";
	return (
		task.ioType === "Input" ||
		task.ioType === "Output" ||
		task.ioType === "Outcome"
	);
}

export function queryTasks(
	tasks: TaskRecord[],
	filters: FilterState,
	scope: TaskScope,
	customFilters: CustomFilterDef[] = [],
): TaskRecord[] {
	const taskTypes = filters.taskType ?? [];
	return tasks.filter((task) => {
		if (!inScopeFolders(task, scope)) return false;
		if (!scope.sections.includes(task.sectionRole)) return false;
		if (!matchesName(task.text, filters.name)) return false;

		if (filters.project) {
			if (
				!task.project ||
				!task.project
					.toLowerCase()
					.includes(filters.project.toLowerCase())
			) {
				return false;
			}
		}

		if (filters.status === "completed" && !task.isCompleted) return false;
		if (filters.status === "incomplete" && task.marker !== "open") {
			return false;
		}

		if (taskTypes.length > 0) {
			const mappedType = ROLE_TO_TYPE[task.sectionRole];
			if (mappedType && !taskTypes.includes(mappedType)) return false;
		}

		if (!matchesDate(task.noteCtime, task.noteMtime, filters)) return false;

		if (
			!matchesCustomFilters(
				task.noteFrontmatter,
				filters,
				customFilters,
				"task",
			)
		) {
			return false;
		}

		return true;
	});
}
