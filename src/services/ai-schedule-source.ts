import { App, normalizePath } from "obsidian";
import type { IotoSettings } from "./ioto-settings-services";

/**
 * 桥文件（`{IOTOFrameworkPath}/Dashboard/AI-Schedule-Board.md`）的唯一读取处。
 * 与 `AI-Runs-Snapshot.md` 分开：调度数据不塞进指标快照，避免上游服务成环。
 */

export type ScheduleRuleStatus =
	| "ok"
	| "daily-cap"
	| "unverified"
	| "not-whitelisted"
	| "missing"
	| "invalid"
	| "shadowed"
	| "disabled";

export type ScheduleOutcome =
	| "fired"
	| "no-op"
	| "failed"
	| "skipped"
	| "disabled";

export interface ScheduleBoardRule {
	id: string;
	path: string;
	title: string;
	source: "settings" | "frontmatter";
	spec: string;
	description: string;
	agent?: string;
	status: ScheduleRuleStatus;
	issueKey: string | null;
	consecutiveFailures: number;
	lastFireAt?: number;
	lastOutcome?: ScheduleOutcome;
	lastOutcomeTs?: number;
	nextFireAt?: number;
	todayPlan: number[];
}

export interface ScheduleBoardEntry {
	ruleId: string;
	plannedAt: number;
	startedAt?: number;
	durationMs?: number;
	trigger: "tick" | "catch-up";
	outcome: ScheduleOutcome;
	reason?: string;
	completed?: boolean;
	pendingCount?: number;
	mode?: "legacy" | "single" | "orchestrated";
}

export interface ScheduleBoard {
	schemaVersion: 1;
	generatedAt: number;
	day: string;
	enabled: boolean;
	maxPerDay: number;
	graceMinutes: number;
	failureThreshold: number;
	rules: ScheduleBoardRule[];
	today: ScheduleBoardEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isScheduleBoard(raw: unknown): raw is ScheduleBoard {
	if (!isObject(raw)) return false;
	return (
		raw.schemaVersion === 1 &&
		typeof raw.generatedAt === "number" &&
		Number.isFinite(raw.generatedAt) &&
		typeof raw.day === "string" &&
		typeof raw.enabled === "boolean" &&
		Array.isArray(raw.rules) &&
		Array.isArray(raw.today)
	);
}

/** 本地日键 `YYYY-MM-DD`，与上游 localDayKey 同口径。 */
export function localDayKey(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface AiScheduleSourceOptions {
	app: App;
	getSettings: () => IotoSettings | null;
}

export class AiScheduleSource {
	private board: ScheduleBoard | null = null;
	private readonly listeners = new Set<() => void>();
	private reading: Promise<ScheduleBoard | null> | null = null;
	private minuteBucket = Math.floor(Date.now() / 60_000);

	constructor(private readonly options: AiScheduleSourceOptions) {}

	bridgePath(): string | null {
		const base = this.options.getSettings()?.IOTOFrameworkPath;
		if (typeof base !== "string" || base.trim() === "") return null;
		return `${normalizePath(base)}/Dashboard/AI-Schedule-Board.md`;
	}

	matchesPath(path: string): boolean {
		const bridge = this.bridgePath();
		if (!bridge) return false;
		return normalizePath(path) === normalizePath(bridge);
	}

	boardNow(): ScheduleBoard | null {
		return this.board;
	}

	/** 数据版本：generatedAt + 分钟桶。分钟推进要触发卡片重建（过去/未来归属变化）。 */
	version(): string {
		return `${this.board?.generatedAt ?? "none"}:${Math.floor(Date.now() / 60_000)}`;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of Array.from(this.listeners)) {
			try {
				listener();
			} catch (error) {
				console.warn("IOTO Dashboard: AI schedule listener failed", error);
			}
		}
	}

	private setBoard(next: ScheduleBoard | null): void {
		if (this.board === next) return;
		if (next !== null && this.board?.generatedAt === next.generatedAt) {
			return;
		}
		this.board = next;
		this.emit();
	}

	read(): Promise<ScheduleBoard | null> {
		if (this.reading) return this.reading;
		this.reading = this.performRead().finally(() => {
			this.reading = null;
		});
		return this.reading;
	}

	private async performRead(): Promise<ScheduleBoard | null> {
		const path = this.bridgePath();
		if (!path) {
			this.setBoard(null);
			return null;
		}
		try {
			const raw = await this.options.app.vault.adapter.read(path);
			const parsed: unknown = JSON.parse(raw);
			if (!isScheduleBoard(parsed)) {
				this.setBoard(null);
				return null;
			}
			this.setBoard(parsed);
			return parsed;
		} catch {
			this.setBoard(null);
			return null;
		}
	}

	/** 轮询入口；同一份 board 在分钟桶变化时也要广播一次，重排「已运行 ↔ 即将运行」。 */
	async tick(): Promise<ScheduleBoard | null> {
		const result = await this.read();
		const bucket = Math.floor(Date.now() / 60_000);
		if (bucket !== this.minuteBucket) {
			this.minuteBucket = bucket;
			this.emit();
		}
		return result;
	}
}