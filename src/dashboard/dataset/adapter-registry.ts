import type { DataObject } from "./types";
import type { DatasetAdapter } from "./types";
import { fileAdapter } from "./adapters/file";
import { folderAdapter } from "./adapters/folder";
import { noteAdapter } from "./adapters/note";
import { projectAdapter } from "./adapters/project";
import { taskAdapter } from "./adapters/task";

const ADAPTERS: Record<DataObject, DatasetAdapter> = {
	task: taskAdapter,
	note: noteAdapter,
	file: fileAdapter,
	folder: folderAdapter,
	project: projectAdapter,
};

export function adapterFor(object: DataObject): DatasetAdapter {
	return ADAPTERS[object];
}
