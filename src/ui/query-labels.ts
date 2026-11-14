import { t } from "../lang/helpers";
import type { FilterState } from "../data/types";
import { TARGET_LABEL_KEYS } from "../query/manager";
import type { QueryDefinition, QueryTarget } from "../query/types";

type LabelKey = Parameters<typeof t>[0];

const STATUS_LABEL_KEYS: Record<FilterState["status"], LabelKey> = {
	all: "FILTER_STATUS_ALL",
	completed: "FILTER_STATUS_COMPLETED",
	incomplete: "FILTER_STATUS_INCOMPLETE",
};

export function queryTargetLabel(target: QueryTarget): string {
	return t(TARGET_LABEL_KEYS[target]);
}

export function queryDisplayName(query: QueryDefinition): string {
	return query.nameKey ? t(query.nameKey as LabelKey) : query.name;
}

/**
 * Human-readable filter conditions, e.g. `Status: Incomplete · Project: AI`.
 * Task queries always show the status segment so builtins are self-explaining;
 * returns an empty string when nothing applies.
 */
export function queryFilterSummary(query: QueryDefinition): string {
	const parts: string[] = [];
	if (query.target === "task") {
		parts.push(
			t("QUERY_SUMMARY_STATUS", [
				t(STATUS_LABEL_KEYS[query.filters.status]),
			]),
		);
	}
	const { name, project, subject } = query.filters;
	if (name.trim()) parts.push(t("QUERY_SUMMARY_NAME", [name.trim()]));
	if (project.trim()) parts.push(t("QUERY_SUMMARY_PROJECT", [project.trim()]));
	if (subject.trim()) parts.push(t("QUERY_SUMMARY_SUBJECT", [subject.trim()]));
	return parts.join(" · ");
}
