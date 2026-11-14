import type { VaultIndex } from "../data/vault-index";
import type {
	CustomFilterDef,
	IndexConfig,
	IndexSnapshot,
} from "../data/types";
import { evaluateMetrics } from "../metrics/evaluate";
import {
	SnapshotStore,
	collectDailySnapshot,
	dailyPoints,
	localDate,
} from "../metrics/snapshot-store";
import {
	metricKey,
	type DailyPoint,
	type MetricRequest,
	type MetricResult,
} from "../metrics/types";
import type { QueryRepository } from "../query/repository";
import { collectExtraRoots } from "../query/extra-roots";
import { adapterFor } from "./dataset/adapter-registry";
import {
	datasetKey,
	type Dataset,
	type DatasetRequest,
} from "./dataset/types";

const REFRESH_DEBOUNCE_MS = 500;
const COLLECT_THROTTLE_MS = 30 * 60 * 1000;

/** Rendering republishes requests; skip refresh unless the set actually changed. */
function sameRequests(left: MetricRequest[], right: MetricRequest[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((request, index) => {
		const other = right[index];
		return other !== undefined && metricKey(request) === metricKey(other);
	});
}

function sameDatasetRequests(
	left: DatasetRequest[],
	right: DatasetRequest[],
): boolean {
	if (left.length !== right.length) return false;
	return left.every((request, index) => {
		const other = right[index];
		return other !== undefined && datasetKey(request) === datasetKey(other);
	});
}

function readableError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The metric an adapter needs internally. `MetricRequest` stays an
 * implementation detail of the adapter layer.
 */
function metricRequestFor(request: DatasetRequest): MetricRequest | null {
	if (request.measure === "timeline") return null;
	if (request.measure === "series") {
		return {
			kind: "daily-series",
			queryId: request.queryId,
			limit: request.range ?? 30,
		};
	}
	switch (request.object) {
		case "task": {
			const measure =
				request.measure === "count" ||
				request.measure === "completed" ||
				request.measure === "open" ||
				request.measure === "ratio"
					? request.measure
					: undefined;
			return {
				kind: "task-count",
				queryId: request.queryId,
				basis: request.basis ?? "file",
				measure,
			};
		}
		case "note":
			return { kind: "note-count", queryId: request.queryId };
		case "project":
			return {
				kind: "project-progress",
				queryId: request.queryId,
				basis: request.basis ?? "section",
			};
		default:
			return null;
	}
}

export interface DataHubOptions {
	index: VaultIndex;
	getQueries: () => QueryRepository;
	getIndexConfig: () => IndexConfig;
	getCustomFilters: () => CustomFilterDef[];
	snapshotStore?: SnapshotStore;
	now?: () => number;
	/** Backoff schedule for automatic retries; injectable for tests. */
	retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS_MS = [500, 1500];

/**
 * One snapshot per refresh, batched metric evaluation, debounced refresh.
 * Components only ever see results, never the index.
 */
export class DataHub {
	private requests: MetricRequest[] = [];
	private datasetRequests: DatasetRequest[] = [];
	private results = new Map<string, MetricResult>();
	private datasets = new Map<string, Dataset>();
	private snapshot: IndexSnapshot | null = null;
	private points: DailyPoint[] = [];
	private loading = true;
	private visible = true;
	private dirty = false;
	private timer: number | null = null;
	private listeners = new Set<() => void>();
	private lastCollectDate = "";
	private lastCollectAt = 0;
	private runId = 0;
	private lastError: string | null = null;
	private retryAttempt = 0;
	private retryTimer: number | null = null;
	private pendingKeys = new Set<string>();
	private failedKeys = new Map<string, string>();

	constructor(private options: DataHubOptions) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getResults(): Map<string, MetricResult> {
		return this.results;
	}

	getDataset(key: string): Dataset | undefined {
		return this.datasets.get(key);
	}

	getDatasets(): Map<string, Dataset> {
		return this.datasets;
	}

	getSnapshot(): IndexSnapshot | null {
		return this.snapshot;
	}

	isLoading(): boolean {
		return this.loading;
	}

	getLastError(): string | null {
		return this.lastError;
	}

	isDatasetPending(key: string): boolean {
		return this.pendingKeys.has(key);
	}

	getDatasetError(key: string): string | undefined {
		return this.failedKeys.get(key);
	}

	isMetricPending(key: string): boolean {
		return this.pendingKeys.has(key);
	}

	getMetricError(key: string): string | undefined {
		return this.failedKeys.get(key);
	}

	setRequests(requests: MetricRequest[]): void {
		if (sameRequests(this.requests, requests)) return;
		this.requests = requests;
		this.scheduleRefresh(0);
	}

	setDatasetRequests(requests: DatasetRequest[]): void {
		if (sameDatasetRequests(this.datasetRequests, requests)) return;
		this.datasetRequests = requests;
		this.scheduleRefresh(0);
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (visible && this.dirty) this.scheduleRefresh(0);
	}

	scheduleRefresh(delay = REFRESH_DEBOUNCE_MS): void {
		this.dirty = true;
		if (!this.visible) return;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.refresh();
		}, delay);
	}

	async refresh(): Promise<void> {
		if (!this.visible) {
			this.dirty = true;
			return;
		}
		this.dirty = false;

		const runId = ++this.runId;
		const derived = this.derivedMetricRequests();
		const metricRequests = [...this.requests, ...derived];
		this.pendingKeys = new Set([
			...metricRequests.map(metricKey),
			...this.datasetRequests.map(datasetKey),
		]);
		this.pruneFailedKeys();
		this.loading = true;
		this.lastError = null;
		this.notify();

		try {
			const config = this.options.getIndexConfig();
			const queries = this.options.getQueries();
			const extraRoots = collectExtraRoots(queries.list(), config);
			const snapshot = await this.options.index.getSnapshot({
				withTree: this.needsTree(),
				extraRoots,
			});
			if (runId !== this.runId) return;
			if (this.needsSeries()) {
				this.points = await this.loadPoints();
				if (runId !== this.runId) return;
			}
			const ctx = {
				snapshot,
				taskFolder: config.taskFolder,
				getQuery: (id: string) => queries.get(id),
				customFilters: this.options.getCustomFilters(),
				now: this.options.now,
				dailySeries: (limit: number) => this.points.slice(-limit),
			};
			this.results = evaluateMetrics(metricRequests, ctx);
			for (const request of metricRequests) {
				this.failedKeys.delete(metricKey(request));
			}
			this.datasets = this.evaluateDatasets(snapshot, queries);
			this.snapshot = snapshot;
			this.retryAttempt = 0;
			// Daily metrics keep the four-root scope: extra query roots must not
			// shift the persisted totals.
			const baseSnapshot =
				extraRoots.length > 0
					? await this.options.index.getSnapshot({ withTree: false })
					: snapshot;
			if (runId !== this.runId) return;
			void this.collect(baseSnapshot, config).catch((error) => {
				console.warn("IOTO Dashboard: snapshot collect failed", error);
			});
		} catch (error) {
			if (runId !== this.runId) return;
			const message = readableError(error);
			this.lastError = message;
			console.error("IOTO Dashboard: refresh failed", error);
			for (const key of this.pendingKeys) this.failedKeys.set(key, message);
			this.scheduleRetry();
		} finally {
			if (runId === this.runId) {
				this.pendingKeys.clear();
				this.loading = false;
				this.notify();
			}
		}
	}

	/** Manual retry: forget failure records and rerun immediately. */
	refreshNow(): void {
		if (this.retryTimer !== null) {
			window.clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		this.retryAttempt = 0;
		this.failedKeys.clear();
		this.dirty = false;
		void this.refresh();
	}

	private pruneFailedKeys(): void {
		for (const key of [...this.failedKeys.keys()]) {
			if (!this.pendingKeys.has(key)) this.failedKeys.delete(key);
		}
	}

	private scheduleRetry(): void {
		const delays = this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
		if (this.retryAttempt >= delays.length || !this.visible) return;
		const delay = delays[this.retryAttempt] ?? 0;
		this.retryAttempt += 1;
		if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
		this.retryTimer = window.setTimeout(() => {
			this.retryTimer = null;
			void this.refresh();
		}, delay);
	}

	private derivedMetricRequests(): MetricRequest[] {
		const requests: MetricRequest[] = [];
		for (const request of this.datasetRequests) {
			const metric = metricRequestFor(request);
			if (metric) requests.push(metric);
		}
		return requests;
	}

	private evaluateDatasets(
		snapshot: IndexSnapshot,
		queries: QueryRepository,
	): Map<string, Dataset> {
		const datasets = new Map<string, Dataset>();
		for (const request of this.datasetRequests) {
			const key = datasetKey(request);
			if (datasets.has(key)) continue;
			const metricRequest = metricRequestFor(request);
			const metric = metricRequest
				? this.results.get(metricKey(metricRequest))
				: undefined;
			try {
				datasets.set(
					key,
					adapterFor(request.object)({
						request,
						query: queries.get(request.queryId),
						snapshot,
						metric,
						dailySeries: (limit) => this.points.slice(-limit),
						customFilters: this.options.getCustomFilters(),
						now: this.options.now,
					}),
				);
				this.failedKeys.delete(key);
			} catch (error) {
				const message = readableError(error);
				this.failedKeys.set(key, message);
				console.error(
					"IOTO Dashboard: dataset evaluation failed",
					key,
					error,
				);
			}
		}
		return datasets;
	}

	private needsSeries(): boolean {
		return (
			this.requests.some((request) => request.kind === "daily-series") ||
			this.datasetRequests.some((request) => request.measure === "series")
		);
	}

	private needsTree(): boolean {
		return this.datasetRequests.some(
			(request) => request.object === "file" || request.object === "folder",
		);
	}

	private async loadPoints(): Promise<DailyPoint[]> {
		const store = this.options.snapshotStore;
		if (!store) return [];
		const { file } = await store.load();
		return dailyPoints(file, 180);
	}

	private async collect(
		snapshot: IndexSnapshot,
		config: IndexConfig,
	): Promise<void> {
		const store = this.options.snapshotStore;
		if (!store) return;
		const now = this.options.now?.() ?? Date.now();
		const today = localDate(now);
		if (
			today === this.lastCollectDate &&
			now - this.lastCollectAt < COLLECT_THROTTLE_MS
		) {
			return;
		}
		this.lastCollectDate = today;
		this.lastCollectAt = now;
		await collectDailySnapshot(snapshot, config, store, now);
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				console.warn("IOTO Dashboard: data hub listener failed", error);
			}
		}
	}

	destroy(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.retryTimer !== null) {
			window.clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		this.listeners.clear();
	}
}
