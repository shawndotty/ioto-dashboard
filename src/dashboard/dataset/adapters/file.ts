import { resolveQuery } from "../../../query/resolve";
import { noteDisplayName } from "../../../data/note-source";
import type { NoteDisplayOptions } from "../../../data/note-source";
import type { FileRecord, NoteRecord } from "../../../data/types";
import {
	emptyDataset,
	formatDate,
	formatSize,
	truncateRows,
	type Dataset,
	type DatasetAdapter,
	type DatasetColumn,
	type MeasureId,
} from "../types";
import { cell, summaryItem } from "./shared";
import {
	buildTimelineRows,
	TIMELINE_COLUMNS,
	type TimelineRecord,
} from "../timeline";

export const FILE_COLUMNS: DatasetColumn[] = [
	{ key: "name", labelKey: "DATASET_COL_NAME", type: "text" },
	{ key: "folder", labelKey: "DATASET_COL_FOLDER", type: "path" },
	{ key: "extension", labelKey: "DATASET_COL_EXTENSION", type: "text" },
	{ key: "size", labelKey: "DATASET_COL_SIZE", type: "size", align: "right" },
	{ key: "mtime", labelKey: "DATASET_COL_MTIME", type: "date", align: "right" },
];

function scalarTextFor(files: FileRecord[], measure: MeasureId): string {
	if (files.length === 0) {
		return measure === "size" || measure === "mtime" ? "—" : "0";
	}
	if (measure === "size") {
		return formatSize(files.reduce((sum, file) => sum + file.size, 0));
	}
	if (measure === "mtime") {
		const latest = files.reduce(
			(max, file) => (file.mtime > max ? file.mtime : max),
			files[0]?.mtime ?? 0,
		);
		return formatDate(latest);
	}
	return String(files.length);
}

function notesByPath(
	snapshot: { notes?: NoteRecord[] } | undefined,
): Map<string, NoteRecord> {
	return new Map((snapshot?.notes ?? []).map((note) => [note.path, note]));
}

function displayNameOf(
	file: FileRecord,
	notes: Map<string, NoteRecord>,
	display: NoteDisplayOptions | undefined,
): string {
	if (file.extension !== "md") return file.basename;
	return noteDisplayName(
		file.basename,
		notes.get(file.path)?.frontmatter,
		display,
	);
}

export const fileAdapter: DatasetAdapter = (input): Dataset => {
	const { request, query, snapshot } = input;
	const display = input.display;
	if (request.measure === "timeline") {
		const columns = TIMELINE_COLUMNS.file;
		if (!query || !snapshot) return emptyDataset(request, columns);
		const files = resolveQuery(snapshot, query, {
			customFilters: input.customFilters,
			now: input.now,
		}).files ?? [];
		const notes = notesByPath(snapshot);
		const records: TimelineRecord[] = files.map((file) => ({
			basename: file.basename,
			ctime: file.ctime,
			mtime: file.mtime,
			size: file.size,
			path: file.path,
			text: displayNameOf(file, notes, display),
			kind: "file",
		}));
		const timeline = buildTimelineRows(
			records,
			{
				bucket: request.timeline?.bucket ?? "day",
				dateField: request.timeline?.dateField ?? "auto",
				range: request.range ?? 30,
				now: input.now,
			},
			columns,
		);
		const truncated = truncateRows(timeline.rows, request.limit);
		return {
			object: request.object,
			measure: request.measure,
			columns: timeline.columns,
			...truncated,
			sourceTotal: timeline.sourceTotal,
		};
	}
	if (!query || !snapshot) return emptyDataset(request, FILE_COLUMNS);
	const files = resolveQuery(snapshot, query, {
		customFilters: input.customFilters,
		now: input.now,
	}).files ?? [];
	const notes = notesByPath(snapshot);
	const rows = files.map((file) => ({
		id: file.path,
		cells: {
			name: cell(displayNameOf(file, notes, display), { path: file.path }),
			folder: cell(file.folder, { path: file.folder }),
			extension: cell(file.extension),
			size: cell(formatSize(file.size), { sortValue: file.size }),
			mtime: cell(formatDate(file.mtime), { sortValue: file.mtime }),
		},
	}));
	const truncated = truncateRows(rows, request.limit);
	const totalSize = files.reduce((sum, file) => sum + file.size, 0);
	const latestMtime = files.reduce(
		(max, file) => (file.mtime > max ? file.mtime : max),
		0,
	);
	return {
		object: request.object,
		measure: request.measure,
		columns: FILE_COLUMNS,
		...truncated,
		scalarText: scalarTextFor(files, request.measure),
		summary: {
			items: [
				summaryItem("DATASET_SUMMARY_FILES_TOTAL", String(files.length), "count"),
				summaryItem("DATASET_SUMMARY_FILES_SIZE", formatSize(totalSize), "size"),
				summaryItem(
					"DATASET_SUMMARY_LATEST_MTIME",
					formatDate(latestMtime),
					"mtime",
				),
			],
		},
	};
};
