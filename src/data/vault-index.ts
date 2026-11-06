import { TFile } from "obsidian";
import type {
	App,
	EventRef,
	TAbstractFile,
	TFolder,
} from "obsidian";
import {
	buildNoteRecord,
	isInsideFolder,
	normalizeFolder,
	resolveIoType,
	toText,
} from "./note-source";
import { buildProjectRecord } from "./project-source";
import { extractTasks } from "./task-source";
import type {
	IndexConfig,
	IndexSnapshot,
	NoteRecord,
	ProjectRecord,
	TaskRecord,
} from "./types";

interface CachedFile {
	signature: string;
	note: NoteRecord;
	tasks: TaskRecord[];
	project: ProjectRecord | null;
}

async function mapWithLimit<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array<R>(items.length);
	let cursor = 0;
	const runners: Promise<void>[] = [];
	const runnerCount = Math.min(limit, items.length);
	for (let runner = 0; runner < runnerCount; runner++) {
		runners.push(
			(async () => {
				while (cursor < items.length) {
					const index = cursor++;
					const item = items[index];
					if (item === undefined) continue;
					results[index] = await worker(item);
				}
			})(),
		);
	}
	await Promise.all(runners);
	return results;
}

function isFolder(node: TAbstractFile): node is TFolder {
	return "children" in node;
}

/**
 * Single source of truth for notes / tasks / projects.
 *
 * Views never touch app.vault or metadataCache; they await getSnapshot() and
 * subscribe() to change notifications.
 */
export class VaultIndex {
	private records = new Map<string, CachedFile>();
	private dirty = new Set<string>();
	private building: Promise<void> | null = null;
	private built = false;
	private listeners = new Set<() => void>();
	private eventRefs: EventRef[] = [];

	constructor(
		private app: App,
		private getConfig: () => IndexConfig,
	) {}

	attach(): void {
		const { vault, metadataCache } = this.app;
		this.eventRefs.push(
			vault.on("modify", (file: TAbstractFile) => {
				this.invalidate(file.path);
			}),
		);
		this.eventRefs.push(
			vault.on("create", (file: TAbstractFile) => {
				this.invalidate(file.path);
			}),
		);
		this.eventRefs.push(
			vault.on("delete", (file: TAbstractFile) => {
				this.remove(file.path);
			}),
		);
		this.eventRefs.push(
			vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				this.remove(oldPath);
				this.invalidate(file.path);
			}),
		);
		this.eventRefs.push(
			metadataCache.on("changed", (file: TFile) => {
				this.invalidate(file.path);
			}),
		);
	}

	detach(): void {
		for (const ref of this.eventRefs) this.app.vault.offref(ref);
		this.eventRefs = [];
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	invalidate(path: string): void {
		const config = this.getConfig();
		if (!this.isIndexedPath(path, config) && !this.records.has(path)) return;
		this.dirty.add(path);
		this.notify();
	}

	remove(path: string): void {
		const existed = this.records.delete(path);
		this.dirty.delete(path);
		if (existed) this.notify();
	}

	rebuild(): void {
		// Keep the cache: buildAll() reuses entries whose (mtime,size) still match
		// and drops files that are no longer under any configured root.
		this.built = false;
		this.dirty.clear();
		this.notify();
	}

	async getSnapshot(): Promise<IndexSnapshot> {
		await this.ensureBuilt();
		await this.flushDirty();
		const notes: NoteRecord[] = [];
		const tasks: TaskRecord[] = [];
		const projects: ProjectRecord[] = [];
		for (const entry of this.records.values()) {
			notes.push(entry.note);
			tasks.push(...entry.tasks);
			if (entry.project) projects.push(entry.project);
		}
		notes.sort((a, b) => a.path.localeCompare(b.path));
		return { notes, tasks, projects };
	}

	async getNotes(): Promise<NoteRecord[]> {
		return (await this.getSnapshot()).notes;
	}

	async getTasks(): Promise<TaskRecord[]> {
		return (await this.getSnapshot()).tasks;
	}

	async getProjects(): Promise<ProjectRecord[]> {
		return (await this.getSnapshot()).projects;
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				console.warn("IOTO Dashboard: index listener failed", error);
			}
		}
	}

	private isIndexedPath(path: string, config: IndexConfig): boolean {
		return (
			path.endsWith(".md") &&
			(isInsideFolder(path, config.inputFolder) ||
				isInsideFolder(path, config.outputFolder) ||
				isInsideFolder(path, config.taskFolder) ||
				isInsideFolder(path, config.outcomeFolder))
		);
	}

	private async ensureBuilt(): Promise<void> {
		if (this.built) return;
		if (!this.building) {
			this.building = this.buildAll().finally(() => {
				this.building = null;
			});
		}
		await this.building;
	}

	private collectFiles(config: IndexConfig): TFile[] {
		const roots = [
			config.inputFolder,
			config.outputFolder,
			config.taskFolder,
			config.outcomeFolder,
		];
		const seen = new Set<string>();
		const files: TFile[] = [];
		for (const rawRoot of roots) {
			const root = normalizeFolder(rawRoot);
			if (!root) continue;
			const node = this.app.vault.getAbstractFileByPath(root);
			if (!node || !isFolder(node)) continue;
			for (const file of this.walk(node)) {
				if (seen.has(file.path)) continue;
				seen.add(file.path);
				files.push(file);
			}
		}
		return files;
	}

	private walk(folder: TFolder): TFile[] {
		const result: TFile[] = [];
		for (const child of folder.children) {
			if (isFolder(child)) {
				result.push(...this.walk(child));
			} else if (child instanceof TFile && child.extension === "md") {
				result.push(child);
			}
		}
		return result;
	}

	private async buildAll(): Promise<void> {
		const config = this.getConfig();
		const files = this.collectFiles(config);
		const previous = this.records;
		const next = new Map<string, CachedFile>();

		await mapWithLimit(files, 32, async (file) => {
			const signature = this.signatureOf(file);
			const cached = previous.get(file.path);
			if (cached && cached.signature === signature) {
				next.set(file.path, cached);
				return;
			}
			const entry = await this.loadFile(file, config, signature);
			if (entry) next.set(file.path, entry);
		});

		this.records = next;
		this.built = true;
	}

	private async flushDirty(): Promise<void> {
		if (this.dirty.size === 0) return;
		const paths = [...this.dirty];
		this.dirty.clear();
		const config = this.getConfig();
		await mapWithLimit(paths, 16, async (path) => {
			const node = this.app.vault.getAbstractFileByPath(path);
			if (!(node instanceof TFile) || !this.isIndexedPath(path, config)) {
				this.records.delete(path);
				return;
			}
			const file = node;
			const signature = this.signatureOf(file);
			const cached = this.records.get(path);
			if (cached && cached.signature === signature) return;
			const entry = await this.loadFile(file, config, signature);
			if (entry) this.records.set(path, entry);
			else this.records.delete(path);
		});
	}

	private signatureOf(file: TFile): string {
		return `${file.stat.mtime}:${file.stat.size}`;
	}

	private async loadFile(
		file: TFile,
		config: IndexConfig,
		signature: string,
	): Promise<CachedFile | null> {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter as
			| Record<string, unknown>
			| undefined;
		const content = await this.app.vault.cachedRead(file);
		const ioType = resolveIoType(file.path, config);
		const projectValue = frontmatter?.["Project"] ?? frontmatter?.["project"];
		const statusValue = frontmatter?.["Status"] ?? frontmatter?.["status"];
		const tasks = extractTasks({
			path: file.path,
			content,
			ioType,
			headings: config.headings,
			project: toText(projectValue),
			noteStatus: toText(statusValue),
			noteCtime: file.stat.ctime,
			noteMtime: file.stat.mtime,
			noteBasename: file.basename,
			noteSize: file.stat.size,
			noteFrontmatter: frontmatter,
		});
		const note = buildNoteRecord(
			{
				path: file.path,
				basename: file.basename,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
				size: file.stat.size,
				ioType,
				frontmatter,
			},
			tasks,
		);
		const project = buildProjectRecord({
			path: file.path,
			basename: file.basename,
			frontmatter,
		});
		return { signature, note, tasks, project };
	}
}
