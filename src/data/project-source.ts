import { folderOf, readFrontmatterValue, toText } from "./note-source";
import type { ProjectRecord } from "./types";

function asText(value: unknown): string | undefined {
	return toText(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function isProjectNote(basename: string): boolean {
	return basename === "_project";
}

export function buildProjectRecord(input: {
	path: string;
	basename: string;
	frontmatter?: Record<string, unknown>;
}): ProjectRecord | null {
	if (!isProjectNote(input.basename)) return null;
	const frontmatter = input.frontmatter;
	const nested = asRecord(readFrontmatterValue(frontmatter, "IOTOProject"));
	const folder = folderOf(input.path);
	const name = folder.split("/").filter(Boolean).pop() ?? folder;
	return {
		path: input.path,
		folder,
		name,
		project: asText(readFrontmatterValue(frontmatter, "Project", "project")),
		category: asText(
			readFrontmatterValue(nested, "category", "Category") ??
				readFrontmatterValue(frontmatter, "category", "Category"),
		),
		startDate: asText(
			readFrontmatterValue(nested, "startDate", "start") ??
				readFrontmatterValue(frontmatter, "startDate", "start"),
		),
		dueDate: asText(
			readFrontmatterValue(nested, "dueDate", "due") ??
				readFrontmatterValue(frontmatter, "dueDate", "due"),
		),
		status: asText(
			readFrontmatterValue(nested, "status", "Status") ??
				readFrontmatterValue(frontmatter, "status", "Status"),
		),
		frontmatter,
	};
}
