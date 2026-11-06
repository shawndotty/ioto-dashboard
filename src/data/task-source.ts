import type {
	IoType,
	SectionHeadings,
	SectionRole,
	TaskMarker,
	TaskRecord,
} from "./types";

interface ParsedCheckbox {
	line: number;
	marker: TaskMarker;
	isCompleted: boolean;
	text: string;
	indent: number;
	sectionRole: SectionRole;
	sectionHeading: string;
}

interface HeadingFrame {
	level: number;
	role: SectionRole;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const CHECKBOX_RE =
	/^([ \t]*)(?:[-*+]|\d+[.)])\s+\[(.)\](?:\s+(.*))?$/;
const FENCE_RE = /^(```|~~~)/;

export function normalizeHeading(text: string): string {
	return text
		.trim()
		.replace(/\s+\^[\w-]+$/, "")
		.trim()
		.toLowerCase();
}

export function classifyHeading(
	text: string,
	headings: SectionHeadings,
): SectionRole | null {
	const key = normalizeHeading(text);
	if (!key) return null;
	const ordered: Array<[SectionRole, string[]]> = [
		["task", headings.task],
		["input", headings.input],
		["output", headings.output],
		["outcome", headings.outcome],
		["goal", headings.goal],
		["review", headings.review],
	];
	for (const [role, keywords] of ordered) {
		for (const keyword of keywords) {
			const normalized = normalizeHeading(keyword);
			if (!normalized) continue;
			if (key === normalized || key.startsWith(normalized)) return role;
		}
	}
	return null;
}

export function taskMarker(char: string): TaskMarker {
	switch (char) {
		case " ":
			return "open";
		case "x":
		case "X":
			return "done";
		case "-":
			return "cancelled";
		case "/":
			return "in-progress";
		case ">":
			return "forwarded";
		default:
			return "other";
	}
}

export function stripComments(text: string): string {
	return text
		.replace(/%%[\s\S]*?%%/g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.trim();
}

function countOccurrences(text: string, token: string): number {
	let count = 0;
	let index = text.indexOf(token);
	while (index !== -1) {
		count++;
		index = text.indexOf(token, index + token.length);
	}
	return count;
}

/**
 * Single-pass scan: a heading stack resolves nested sections, so duplicate or
 * variant headings no longer hide each other (the old metadataCache
 * `findIndex` + range approach kept only the first match per section).
 */
export function parseCheckboxes(
	content: string,
	headings: SectionHeadings,
): ParsedCheckbox[] {
	const lines = content.split(/\r?\n/);
	const stack: HeadingFrame[] = [];
	let sectionRole: SectionRole = "other";
	let sectionHeading = "";
	let inFence = false;
	let blockComment: "%%" | "<!--" | null = null;
	const result: ParsedCheckbox[] = [];

	for (let index = 0; index < lines.length; index++) {
		const rawLine = lines[index] ?? "";

		if (blockComment) {
			const closes =
				blockComment === "%%" ? rawLine.includes("%%") : rawLine.includes("-->");
			if (closes) blockComment = null;
			continue;
		}

		if (FENCE_RE.test(rawLine.trimStart())) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const trimmed = rawLine.trimStart();
		if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
			blockComment = "<!--";
			continue;
		}
		if (countOccurrences(rawLine, "%%") % 2 === 1) {
			blockComment = "%%";
			continue;
		}

		const headingMatch = HEADING_RE.exec(rawLine);
		if (headingMatch) {
			const level = (headingMatch[1] ?? "").length;
			const headingText = stripComments(headingMatch[2] ?? "");
			while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
				stack.pop();
			}
			const parentRole = stack[stack.length - 1]?.role ?? "other";
			const role = classifyHeading(headingText, headings) ?? parentRole;
			stack.push({ level, role });
			sectionRole = role;
			sectionHeading = headingText;
			continue;
		}

		const checkboxMatch = CHECKBOX_RE.exec(rawLine);
		if (!checkboxMatch) continue;

		const marker = taskMarker(checkboxMatch[2] ?? " ");
		const text = stripComments(checkboxMatch[3] ?? "");
		if (!text) continue;

		result.push({
			line: index,
			marker,
			isCompleted: marker === "done",
			text,
			indent: (checkboxMatch[1] ?? "").replace(/\t/g, "    ").length,
			sectionRole,
			sectionHeading,
		});
	}

	return result;
}

export interface TaskExtractionInput {
	path: string;
	content: string;
	ioType: IoType;
	headings: SectionHeadings;
	project?: string;
	noteStatus?: string;
	noteCtime: number;
	noteMtime: number;
	noteBasename: string;
	noteSize: number;
	noteFrontmatter?: Record<string, unknown>;
}

export function extractTasks(input: TaskExtractionInput): TaskRecord[] {
	return parseCheckboxes(input.content, input.headings).map((item) => ({
		path: input.path,
		line: item.line,
		marker: item.marker,
		isCompleted: item.isCompleted,
		text: item.text,
		indent: item.indent,
		ioType: input.ioType,
		sectionRole: item.sectionRole,
		sectionHeading: item.sectionHeading,
		project: input.project,
		noteStatus: input.noteStatus,
		noteCtime: input.noteCtime,
		noteMtime: input.noteMtime,
		noteBasename: input.noteBasename,
		noteSize: input.noteSize,
		noteFrontmatter: input.noteFrontmatter,
	}));
}
