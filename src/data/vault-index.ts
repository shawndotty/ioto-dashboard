import { TFile } from "obsidian";
import type {
	App,
	EventRef,
	TAbstractFile,
	TFolder,
} from "obsidian";
import {
	buildNoteRecord,
	folderProjectName,
	isInsideFolder,
	resolveIoType,
	toText,
} from "./note-source";
import { buildProjectRecord } from "./project-source";
import { extractTasks } from "./task-source";
import { fileRecords, folderRecords } from "./file-source";
import { baseRoots, normalizeExtraRoots } from "../query/extra-roots";
import type {
	IndexConfig,
	IndexSnapshot,
	NoteRecord,
	ProjectRecord,
	TaskRecord,
} from "./types";

export interface SnapshotOptions {
	withTree?: boolean;
	/**
	 * Folders to index on demand for this request. Passing the field (even as
	 * an empty list) scopes the snapshot and drops unrequested extra records;
	 * omitting it takes the base snapshot without touching the extra cache.
	 */
	extraRoots?: string[];
}

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

function isWithinScope(path: string, roots: string[]): boolean {
	return roots.some((root) => isInsideFolder(path, root));
}

/**
 * Single source of truth for notes / tasks / projects.
 *
 * Views never touch app.vault or metadataCache; they await getSnapshot() and
 * subscribe() to change notifications.
 */
export class VaultIndex {
	private records = new Map<string, CachedFile>();
	/** Notes under query-referenced folders outside the four framework roots. */
	private extraRecords = new Map<string, CachedFile>();
	/** Extra roots whose current contents are already in `extraRecords`. */
	private extraRootsLoaded = new Set<string>();
	private dirty = new Set<string>();
	private building: Promise<void> | null = null;
	private built = false;
	private listeners = new Set<() => void>();
	private eventRefs: EventRef[] = [];
	private warnedAt = new Map<string, number>();

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
		const tracked =
			this.isIndexedPath(path, config) ||
			this.isInExtraRoot(path) ||
			this.records.has(path) ||
			this.extraRecords.has(path);
		if (!tracked) return;
		this.dirty.add(path);
		this.notify();
	}

	remove(path: string): void {
		const base = this.records.delete(path);
		const extra = this.extraRecords.delete(path);
		this.dirty.delete(path);
		if (base || extra) this.notify();
	}

	rebuild(): void {
		// Keep the cache: buildAll() reuses entries whose (mtime,size) still match
		// and drops files that are no longer under any configured root.
		this.built = false;
		this.dirty.clear();
		this.extraRecords.clear();
		this.extraRootsLoaded.clear();
		this.notify();
	}

	async getSnapshot(
		options: SnapshotOptions = {},
	): Promise<IndexSnapshot> {
		await this.ensureBuilt();
		await this.flushDirty();
		const config = this.getConfig();
		const extras = normalizeExtraRoots(options.extraRoots ?? [], config);
		const notes: NoteRecord[] = [];
		const tasks: TaskRecord[] = [];
		const projects: ProjectRecord[] = [];
		for (const entry of this.records.values()) {
			notes.push(entry.note);
			tasks.push(...entry.tasks);
			if (entry.project) projects.push(entry.project);
		}
		// Only an explicit `extraRoots` request reads or merges the extra cache;
		// the base snapshot (daily metrics) must stay on the four roots.
		if (options.extraRoots !== undefined) {
			await this.loadExtraRoots(extras);
			this.pruneExtraRecords(extras);
			for (const entry of this.extraRecords.values()) {
				// A configured root nested inside an extra root must not duplicate.
				if (this.records.has(entry.note.path)) continue;
				notes.push(entry.note);
				tasks.push(...entry.tasks);
				if (entry.project) projects.push(entry.project);
			}
		}
		notes.sort((a, b) => a.path.localeCompare(b.path));
		const snapshot: IndexSnapshot = { notes, tasks, projects };
		if (extras.length > 0) snapshot.extraPaths = extras;
		if (options.withTree) {
			const tree = this.collectTree(config, extras);
			const scope = [...baseRoots(config), ...extras];
			const files = fileRecords(
				tree.files.map((file) => ({
					path: file.path,
					basename: file.basename,
					extension: file.extension,
					size: file.stat.size,
					ctime: file.stat.ctime,
					mtime: file.stat.mtime,
				})),
			).filter((file) => isWithinScope(file.path, scope));
			snapshot.files = files;
			snapshot.folders = folderRecords(files, tree.folders).filter(
				(folder) => isWithinScope(folder.path, scope),
			);
		}
		return snapshot;
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

	private collectTree(
		config: IndexConfig,
		extraRoots: string[] = [],
	): {
		files: TFile[];
		folders: string[];
	} {
		const roots = [...baseRoots(config), ...extraRoots];
		const seenFiles = new Set<string>();
		const seenFolders = new Set<string>();
		const files: TFile[] = [];
		const folders: string[] = [];
		for (const root of roots) {
			const node = this.app.vault.getAbstractFileByPath(root);
			if (!node || !isFolder(node)) continue;
			if (!seenFolders.has(root)) {
				seenFolders.add(root);
				folders.push(root);
			}
			this.walk(node, seenFiles, files, seenFolders, folders);
		}
		return { files, folders };
	}

	private collectExtraFiles(root: TFolder): TFile[] {
		const files: TFile[] = [];
		const walk = (folder: TFolder): void => {
			for (const child of folder.children) {
				if (isFolder(child)) walk(child);
				else if (child instanceof TFile) files.push(child);
			}
		};
		walk(root);
		return files;
	}

	private isInExtraRoot(path: string): boolean {
		for (const root of this.extraRootsLoaded) {
			if (isInsideFolder(path, root)) return true;
		}
		return false;
	}

	private async loadExtraRoots(roots: string[]): Promise<void> {
		if (roots.length === 0) return;
		const config = this.getConfig();
		for (const root of roots) {
			if (this.extraRootsLoaded.has(root)) continue;
			const node = this.app.vault.getAbstractFileByPath(root);
			if (!node || !isFolder(node)) {
				this.warnOnce(
					`extra-root:${root}`,
					new Error(`Extra query root is not a folder: ${root}`),
				);
				continue;
			}
			const files = this.collectExtraFiles(node).filter(
				(file) => file.extension === "md",
			);
			await mapWithLimit(files, 32, async (file) => {
				const signature = this.signatureOf(file);
				const cached = this.extraRecords.get(file.path);
				if (cached && cached.signature === signature) return;
				try {
					const entry = await this.loadFile(file, config, signature);
					if (entry) this.extraRecords.set(file.path, entry);
					else this.extraRecords.delete(file.path);
				} catch (error) {
					if (!cached) this.extraRecords.delete(file.path);
					this.dirty.add(file.path);
					this.warnOnce(`extra:${file.path}`, error);
				}
			});
			this.extraRootsLoaded.add(root);
		}
	}

	private pruneExtraRecords(roots: string[]): void {
		for (const path of [...this.extraRecords.keys()]) {
			if (!isWithinScope(path, roots)) this.extraRecords.delete(path);
		}
		for (const root of [...this.extraRootsLoaded]) {
			if (!roots.includes(root)) this.extraRootsLoaded.delete(root);
		}
	}

	private walk(
		folder: TFolder,
		seenFiles: Set<string>,
		files: TFile[],
		seenFolders: Set<string>,
		folders: string[],
	): void {
		for (const child of folder.children) {
			if (isFolder(child)) {
				if (!seenFolders.has(child.path)) {
					seenFolders.add(child.path);
					folders.push(child.path);
				}
				this.walk(child, seenFiles, files, seenFolders, folders);
			} else if (child instanceof TFile && !seenFiles.has(child.path)) {
				seenFiles.add(child.path);
				files.push(child);
			}
		}
	}

	private async buildAll(): Promise<void> {
		const config = this.getConfig();
		const files = this.collectTree(config).files.filter(
			(file) => file.extension === "md",
		);
		const previous = this.records;
		const next = new Map<string, CachedFile>();

		await mapWithLimit(files, 32, async (file) => {
			const signature = this.signatureOf(file);
			const cached = previous.get(file.path);
			if (cached && cached.signature === signature) {
				next.set(file.path, cached);
				return;
			}
			try {
				const entry = await this.loadFile(file, config, signature);
				if (entry) next.set(file.path, entry);
				else if (cached) next.set(file.path, cached);
			} catch (error) {
				if (cached) next.set(file.path, cached);
				this.dirty.add(file.path);
				this.warnOnce(`build:${file.path}`, error);
			}
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
			const inBase = this.isIndexedPath(path, config);
			const inExtra = this.isInExtraRoot(path);
			if (!(node instanceof TFile) || (!inBase && !inExtra)) {
				this.records.delete(path);
				this.extraRecords.delete(path);
				return;
			}
			const file = node;
			const target = inBase ? this.records : this.extraRecords;
			try {
				const signature = this.signatureOf(file);
				const cached = target.get(path);
				if (cached && cached.signature === signature) return;
				const entry = await this.loadFile(file, config, signature);
				if (entry) target.set(path, entry);
				else target.delete(path);
			} catch (error) {
				// Keep the last good record and retry on the next snapshot.
				this.dirty.add(path);
				this.warnOnce(`flush:${path}`, error);
			}
		});
	}

	private warnOnce(key: string, error: unknown): void {
		const now = Date.now();
		const last = this.warnedAt.get(key) ?? 0;
		if (now - last < 1000) return;
		this.warnedAt.set(key, now);
		console.warn("IOTO Dashboard: index read failed", key, error);
	}

	private signatureOf(file: TFile): string {
		return `${file.stat.mtime}:${file.stat.size}`;
	}

	private async readWithRetry(file: TFile): Promise<string> {
		try {
			return await this.app.vault.cachedRead(file);
		} catch {
			// Sync folders can briefly expose placeholder/unavailable files.
			await new Promise((resolve) => window.setTimeout(resolve, 100));
			return this.app.vault.cachedRead(file);
		}
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
		const content = await this.readWithRetry(file);
		const ioType = resolveIoType(file.path, config);
		const projectValue = frontmatter?.["Project"] ?? frontmatter?.["project"];
		const statusValue = frontmatter?.["Status"] ?? frontmatter?.["status"];
		// Folder-first attribution for the task root; frontmatter still wins.
		const attributedProject =
			toText(projectValue) ??
			folderProjectName(file.path, config.taskFolder);
		const tasks = extractTasks({
			path: file.path,
			content,
			ioType,
			headings: config.headings,
			project: attributedProject,
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
				projectOverride: folderProjectName(
					file.path,
					config.taskFolder,
				),
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
