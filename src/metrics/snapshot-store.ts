import type {
	IndexConfig,
	IndexSnapshot,
	TaskRecord,
} from "../data/types";
import { listProjectUniverse } from "./project";
import type { DailyPoint } from "./types";

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_FILE_NAME = "metrics-snapshots.json";
export const SNAPSHOT_RETENTION_DAYS = 180;
export const MAX_SAMPLES = 3;

export interface BucketCounts {
	notes: number;
	tasks: number;
	open: number;
	cancelled: number;
	other: number;
}

export interface DailyProjectSnapshot {
	key: string;
	name: string;
	fileCount: number;
	totals: BucketCounts;
	byIoType: Record<string, BucketCounts>;
	bySectionRole: Record<string, BucketCounts>;
}

export interface DailySnapshot {
	capturedAt: number;
	scope: { roots: Record<string, string>; headingsHash: string };
	scopeChangedAt?: number;
	totals: BucketCounts;
	byIoType: Record<string, BucketCounts>;
	bySectionRole: Record<string, BucketCounts>;
	projects: DailyProjectSnapshot[];
	samples?: Array<{ deviceId: string; capturedAt: number; totals: BucketCounts }>;
}

export interface SnapshotFile {
	schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
	deviceId: string;
	days: Record<string, DailySnapshot>;
}

/** The tiny slice of Obsidian's DataAdapter this store needs (test-stubbable). */
export interface SnapshotAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

export function emptyBucketCounts(): BucketCounts {
	return { notes: 0, tasks: 0, open: 0, cancelled: 0, other: 0 };
}

export function localDate(now: number): string {
	const date = new Date(now);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(dateKey: string, days: number): string {
	const [year, month, day] = dateKey.split("-").map(Number);
	const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
	date.setDate(date.getDate() + days);
	return localDate(date.getTime());
}

function stableHash(value: unknown): string {
	const text = JSON.stringify(value);
	let hash = 5381;
	for (let index = 0; index < text.length; index++) {
		hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
	}
	return (hash >>> 0).toString(36);
}

export function scopeFingerprint(config: IndexConfig): {
	roots: Record<string, string>;
	headingsHash: string;
} {
	return {
		roots: {
			input: config.inputFolder,
			output: config.outputFolder,
			task: config.taskFolder,
			outcome: config.outcomeFolder,
		},
		headingsHash: stableHash(config.headings),
	};
}

function bucketFor(tasks: TaskRecord[], notes = 0): BucketCounts {
	const bucket = emptyBucketCounts();
	bucket.notes = notes;
	for (const task of tasks) {
		bucket.tasks += 1;
		if (task.marker === "open") bucket.open += 1;
		else if (task.marker === "cancelled") bucket.cancelled += 1;
		else if (task.marker !== "done") bucket.other += 1;
	}
	return bucket;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const group = groups.get(key);
		if (group) group.push(item);
		else groups.set(key, [item]);
	}
	return groups;
}

export function buildDailySnapshot(
	snapshot: IndexSnapshot,
	config: IndexConfig,
	now: number,
): DailySnapshot {
	const totals = bucketFor(snapshot.tasks, snapshot.notes.length);
	const byIoType: Record<string, BucketCounts> = {};
	const tasksByIoType = groupBy(snapshot.tasks, (task) => task.ioType);
	const notesByIoType = groupBy(snapshot.notes, (note) => note.ioType);
	for (const [ioType, tasks] of tasksByIoType) {
		byIoType[ioType] = bucketFor(tasks, notesByIoType.get(ioType)?.length ?? 0);
	}
	for (const [ioType, notes] of notesByIoType) {
		if (!(ioType in byIoType)) byIoType[ioType] = bucketFor([], notes.length);
	}

	const bySectionRole: Record<string, BucketCounts> = {};
	for (const [role, tasks] of groupBy(snapshot.tasks, (task) => task.sectionRole)) {
		bySectionRole[role] = bucketFor(tasks);
	}

	const universe = listProjectUniverse(snapshot, config.taskFolder);
	const projects: DailyProjectSnapshot[] = universe.map((project) => {
		const projectTasks = snapshot.tasks.filter(
			(task) => task.project === project.key,
		);
		const fileCount = snapshot.notes.filter((note) =>
			note.path.startsWith(`${project.folder}/`),
		).length;
		const projectByIoType: Record<string, BucketCounts> = {};
		for (const [ioType, tasks] of groupBy(projectTasks, (task) => task.ioType)) {
			projectByIoType[ioType] = bucketFor(tasks);
		}
		const projectBySection: Record<string, BucketCounts> = {};
		for (const [role, tasks] of groupBy(projectTasks, (task) => task.sectionRole)) {
			projectBySection[role] = bucketFor(tasks);
		}
		const names = project.name || project.key;
		return {
			key: project.key,
			name: names,
			fileCount,
			totals: bucketFor(projectTasks, fileCount),
			byIoType: projectByIoType,
			bySectionRole: projectBySection,
		};
	});

	return {
		capturedAt: now,
		scope: scopeFingerprint(config),
		totals,
		byIoType,
		bySectionRole,
		projects,
	};
}

function emptyFile(deviceId: string): SnapshotFile {
	return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, deviceId, days: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshotFile(value: unknown): value is SnapshotFile {
	return (
		isRecord(value) &&
		value.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
		typeof value.deviceId === "string" &&
		isRecord(value.days)
	);
}

function mergeDaily(
	incoming: DailySnapshot,
	incomingDeviceId: string,
	existing: DailySnapshot,
	existingDeviceId: string,
): DailySnapshot {
	const incomingNewer = incoming.capturedAt >= existing.capturedAt;
	const winner = incomingNewer ? incoming : existing;
	const loser = incomingNewer ? existing : incoming;
	const loserDeviceId = incomingNewer ? existingDeviceId : incomingDeviceId;

	const samples = [...(winner.samples ?? [])];
	const seen = (deviceId: string, capturedAt: number) =>
		samples.some(
			(sample) => sample.deviceId === deviceId && sample.capturedAt === capturedAt,
		);
	if (!seen(loserDeviceId, loser.capturedAt)) {
		samples.push({
			deviceId: loserDeviceId,
			capturedAt: loser.capturedAt,
			totals: loser.totals,
		});
	}
	for (const sample of loser.samples ?? []) {
		if (!seen(sample.deviceId, sample.capturedAt)) samples.push(sample);
	}
	samples.sort((a, b) => a.capturedAt - b.capturedAt);
	return { ...winner, samples: samples.slice(-MAX_SAMPLES) };
}

/** Date + device merge: newer `capturedAt` wins, the other side lands in `samples`. */
export function mergeSnapshotFiles(
	local: SnapshotFile,
	remote: SnapshotFile,
): SnapshotFile {
	const days: Record<string, DailySnapshot> = { ...local.days };
	for (const [date, snapshot] of Object.entries(remote.days)) {
		const existing = days[date];
		days[date] = existing
			? mergeDaily(
					snapshot,
					remote.deviceId,
					existing,
					local.deviceId,
				)
			: snapshot;
	}
	return {
		schemaVersion: SNAPSHOT_SCHEMA_VERSION,
		deviceId: local.deviceId,
		days,
	};
}

export class SnapshotStore {
	private readonly adapter: SnapshotAdapter;
	private readonly dir: string;
	private readonly now: () => number;
	private readonly deviceId: string;

	constructor(options: {
		adapter: SnapshotAdapter;
		dir: string;
		deviceId: string;
		now?: () => number;
	}) {
		this.adapter = options.adapter;
		this.dir = options.dir;
		this.deviceId = options.deviceId;
		this.now = options.now ?? Date.now;
	}

	filePath(): string {
		return `${this.dir}/${SNAPSHOT_FILE_NAME}`;
	}

	async load(): Promise<{ file: SnapshotFile; corrupted: boolean }> {
		const path = this.filePath();
		if (!(await this.adapter.exists(path))) {
			return { file: emptyFile(this.deviceId), corrupted: false };
		}
		try {
			const raw = await this.adapter.read(path);
			const parsed: unknown = JSON.parse(raw);
			if (!isSnapshotFile(parsed)) {
				return { file: emptyFile(this.deviceId), corrupted: true };
			}
			return { file: { ...parsed, deviceId: parsed.deviceId || this.deviceId }, corrupted: false };
		} catch (error) {
			console.warn("IOTO Dashboard: snapshot file unreadable, keeping it intact", error);
			return { file: emptyFile(this.deviceId), corrupted: true };
		}
	}

	prune(file: SnapshotFile): SnapshotFile {
		const cutoff = addDays(localDate(this.now()), -(SNAPSHOT_RETENTION_DAYS - 1));
		const days: Record<string, DailySnapshot> = {};
		for (const [date, snapshot] of Object.entries(file.days)) {
			if (date >= cutoff) days[date] = snapshot;
		}
		return { ...file, days };
	}

	async save(file: SnapshotFile): Promise<void> {
		const pruned = this.prune({ ...file, schemaVersion: SNAPSHOT_SCHEMA_VERSION });
		const path = this.filePath();
		const tmp = `${path}.tmp`;
		try {
			await this.adapter.write(tmp, JSON.stringify(pruned, null, 2));
			await this.adapter.rename(tmp, path);
		} catch (error) {
			console.warn("IOTO Dashboard: failed to write snapshot file", error);
		}
	}
}

/**
 * Records today's numbers. Returns `null` when the index is not ready or the
 * existing snapshot file is corrupt (it is never overwritten in that case).
 */
export async function collectDailySnapshot(
	snapshot: IndexSnapshot,
	config: IndexConfig,
	store: SnapshotStore,
	now: number = Date.now(),
): Promise<DailySnapshot | null> {
	if (
		snapshot.notes.length === 0 &&
		snapshot.tasks.length === 0 &&
		snapshot.projects.length === 0
	) {
		return null;
	}
	const loaded = await store.load();
	if (loaded.corrupted) return null;

	const date = localDate(now);
	const fresh = buildDailySnapshot(snapshot, config, now);
	const previous = loaded.file.days[date];
	if (previous) {
		fresh.samples = previous.samples;
		const scopeChanged =
			previous.scope.headingsHash !== fresh.scope.headingsHash ||
			JSON.stringify(previous.scope.roots) !==
				JSON.stringify(fresh.scope.roots);
		if (scopeChanged) fresh.scopeChangedAt = now;
		else if (previous.scopeChangedAt) {
			fresh.scopeChangedAt = previous.scopeChangedAt;
		}
	}
	loaded.file.days[date] = fresh;
	await store.save(loaded.file);
	return fresh;
}

export function dailyPoints(file: SnapshotFile, limit = 30): DailyPoint[] {
	const dates = Object.keys(file.days).sort();
	const selected = dates.slice(-limit);
	return selected.map((date) => {
		const snapshot = file.days[date];
		const totals = snapshot?.totals ?? emptyBucketCounts();
		return {
			date,
			total: totals.tasks,
			completed: totals.tasks - totals.open - totals.cancelled - totals.other,
			open: totals.open,
			cancelled: totals.cancelled,
			other: totals.other,
		};
	});
}
