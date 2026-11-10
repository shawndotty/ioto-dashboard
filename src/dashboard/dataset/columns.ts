import type { DataObject, DatasetColumn } from "./types";
import { FILE_COLUMNS } from "./adapters/file";
import { FOLDER_COLUMNS } from "./adapters/folder";
import { NOTE_COLUMNS } from "./adapters/note";
import { PROJECT_COLUMNS } from "./adapters/project";
import { TASK_COLUMNS, TASK_SERIES_COLUMNS } from "./adapters/task";

/** Static column catalogue per object; the inspector uses it for field pickers. */
export function columnsForObject(object: DataObject): DatasetColumn[] {
	switch (object) {
		case "task":
			return TASK_COLUMNS;
		case "note":
			return NOTE_COLUMNS;
		case "file":
			return FILE_COLUMNS;
		case "folder":
			return FOLDER_COLUMNS;
		case "project":
			return PROJECT_COLUMNS;
	}
}

export function seriesColumnsForTask(): DatasetColumn[] {
	return TASK_SERIES_COLUMNS;
}
