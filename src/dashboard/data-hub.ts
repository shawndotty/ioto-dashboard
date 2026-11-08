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

export interface DataHubOptions {
	index: VaultIndex;
	getQueries: () => QueryRepository;
	getIndexConfig: () => IndexConfig;
	getCustomFilters: () => CustomFilterDef[];
	snapshotStore?: SnapshotStore;
	now?: () => number;
}

/**
 * One snapshot per refresh, batched metric evaluation, debounced refresh.
 * Components only ever see results, never the index.
 */
export class DataHub {
	private requests: MetricRequest[] = [];
	private results = new Map<string, MetricResult>();
	private snapshot: IndexSnapshot | null = null;
	private points: DailyPoint[] = [];
	private loading = true;
	private visible = true;
	private dirty = false;
	private timer: number | null = null;
	private listeners = new Set<() => void>();
	private lastCollectDate = "";
	private lastCollectAt = 0;

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

	getSnapshot(): IndexSnapshot | null {
		return this.snapshot;
	}

	isLoading(): boolean {
		return this.loading;
	}

	setRequests(requests: MetricRequest[]): void {
		if (sameRequests(this.requests, requests)) return;
		this.requests = requests;
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
		this.loading = true;
		this.notify();

		const config = this.options.getIndexConfig();
		const snapshot = await this.options.index.getSnapshot();
		if (this.needsSeries()) {
			this.points = await this.loadPoints();
		}
		const queries = this.options.getQueries();
		this.results = evaluateMetrics(this.requests, {
			snapshot,
			taskFolder: config.taskFolder,
			getQuery: (id) => queries.get(id),
			customFilters: this.options.getCustomFilters(),
			now: this.options.now,
			dailySeries: (limit) => this.points.slice(-limit),
		});
		this.snapshot = snapshot;
		this.loading = false;
		this.notify();
		void this.collect(snapshot, config);
	}

	private needsSeries(): boolean {
		return this.requests.some((request) => request.kind === "daily-series");
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
		this.listeners.clear();
	}
}
