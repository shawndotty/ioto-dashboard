import { App, Modal, setIcon } from "obsidian";
import { t } from "../lang/helpers";
import type { ChartBucketPayload } from "../dashboard/registry";
import type { TimelineSourceRef } from "../dashboard/dataset/timeline";
import {
	basename,
	bucketTaskChar,
	isCancelledTask,
	isDoneTask,
	isOpenTask,
	matchBucketRef,
	normalizeQuery,
	splitHighlight,
} from "./chart-bucket-search";
import { applyModalShell } from "./modal-shell";

export interface ChartBucketModalOptions {
	payload: ChartBucketPayload;
	openTask(path: string, line: number | undefined, newTab: boolean): void;
	reveal(path: string): void;
}

type TaskFilter = "all" | "done" | "open";

const NON_TASK_ICONS: Record<Exclude<TimelineSourceRef["kind"], "task">, string> =
	{
		note: "file-text",
		file: "file",
	};

function statusLabelKey(
	marker: string | undefined,
): Parameters<typeof t>[0] | null {
	switch (marker) {
		case "in-progress":
			return "PROJECT_TASKS_BADGE_IN_PROGRESS";
		case "forwarded":
			return "PROJECT_TASKS_BADGE_FORWARDED";
		case "other":
			return "PROJECT_TASKS_BADGE_OTHER";
		default:
			return null;
	}
}

export class ChartBucketModal extends Modal {
	private filter: TaskFilter = "all";
	private query = "";
	private listEl: HTMLElement | null = null;
	private searchInput: HTMLInputElement | null = null;
	private clearButton: HTMLButtonElement | null = null;
	private countEl: HTMLElement | null = null;
	private filterButtons: Array<{
		value: TaskFilter;
		button: HTMLButtonElement;
	}> = [];

	constructor(
		app: App,
		private readonly options: ChartBucketModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { payload } = this.options;
		const total = payload.relatedTotal || payload.refs.length;
		const bucketSuffix =
			payload.bucket === "week"
				? ` · ${t("TIMELINE_BUCKET_WEEK")}`
				: payload.bucket === "month"
					? ` · ${t("TIMELINE_BUCKET_MONTH")}`
					: "";
		applyModalShell(this, {
			kind: "chart-bucket",
			restore: true,
			title: t("CHART_BUCKET_MODAL_TITLE", [
				`${payload.bucketKey}${bucketSuffix}`,
				String(total),
			]),
		});
		this.contentEl.addClass("ioto-chart-bucket");
		this.contentEl.addEventListener("keydown", (event) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key.toLowerCase() !== "f") return;
			if (!this.searchInput) return;
			event.preventDefault();
			this.searchInput.focus();
			this.searchInput.select();
		});
		this.render();
		this.searchInput?.focus();
	}
	onClose(): void {
		this.contentEl.empty();
	}

	private filterByMarker(): TimelineSourceRef[] {
		const refs = this.options.payload.refs;
		if (this.options.payload.object !== "task" || this.filter === "all") {
			return refs;
		}
		return refs.filter((ref) =>
			this.filter === "done"
				? isDoneTask(ref.marker)
				: isOpenTask(ref.marker),
		);
	}

	private render(): void {
		const content = this.contentEl;
		content.empty();
		this.listEl = null;
		this.searchInput = null;
		this.clearButton = null;
		this.countEl = null;
		this.filterButtons = [];
		const { payload } = this.options;

		const chips = content.createDiv({ cls: "ioto-chart-bucket-chips" });
		for (const entry of payload.series) {
			const chip = chips.createDiv({ cls: "ioto-chart-bucket-chip" });
			chip.createSpan({ text: t(entry.label as Parameters<typeof t>[0]) });
			chip.createSpan({
				cls: "ioto-chart-bucket-chip-value",
				text: String(entry.value),
			});
		}
		if (payload.cumulative) {
			chips.createDiv({
				cls: "ioto-chart-bucket-chip",
				text: t("CHART_LEGEND_CUMULATIVE"),
			});
		}

		if (payload.cumulative) {
			content.createDiv({
				cls: "ioto-chart-bucket-hint",
				text: t("CHART_BUCKET_CUMULATIVE_HINT"),
			});
		}
		if (payload.source === "project") {
			content.createDiv({
				cls: "ioto-chart-bucket-hint",
				text: t("CHART_BUCKET_PROJECT_HINT"),
			});
		} else if (payload.object === "task") {
			content.createDiv({
				cls: "ioto-chart-bucket-hint",
				text: t("CHART_BUCKET_SOURCE_HINT"),
			});
		}

		if (payload.refs.length > 0) this.renderSearch(content);

		if (payload.object === "task") {
			const hasCancelled = payload.refs.some((ref) =>
				isCancelledTask(ref.marker),
			);
			this.renderFilters(content, hasCancelled);
			if (hasCancelled) {
				content.createDiv({
					cls: "ioto-chart-bucket-hint ioto-chart-bucket-cancelled-hint",
					text: t("CHART_BUCKET_CANCELLED_HINT"),
				});
			}
		}

		this.listEl = content.createDiv({ cls: "ioto-chart-bucket-list" });
		this.renderList();

		if (payload.relatedTotal > payload.refs.length) {
			content.createDiv({
				cls: "ioto-chart-bucket-truncated",
				text: t("CHART_BUCKET_TRUNCATED", [
					String(payload.refs.length),
					String(payload.relatedTotal),
				]),
			});
		}
	}

	private renderSearch(host: HTMLElement): void {
		const row = host.createDiv({ cls: "ioto-chart-bucket-search" });
		const input = row.createEl("input", {
			cls: "ioto-chart-bucket-search-input",
			attr: {
				type: "search",
				placeholder: t("CHART_BUCKET_SEARCH_PLACEHOLDER"),
				"aria-label": t("CHART_BUCKET_SEARCH_PLACEHOLDER"),
			},
		});
		input.value = this.query;
		input.addEventListener("input", (event) => {
			if ((event as InputEvent).isComposing) return;
			this.applyQuery(input.value);
		});
		input.addEventListener("compositionend", () => {
			this.applyQuery(input.value);
		});
		input.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			if (!input.value.trim()) return;
			event.preventDefault();
			event.stopPropagation();
			this.applyQuery("");
		});

		const clear = row.createEl("button", {
			cls: "clickable-icon ioto-chart-bucket-search-clear",
			attr: {
				type: "button",
				"aria-label": t("CHART_BUCKET_SEARCH_CLEAR"),
				title: t("CHART_BUCKET_SEARCH_CLEAR"),
			},
		});
		setIcon(clear, "x");
		clear.addEventListener("click", () => {
			this.applyQuery("");
			input.focus();
		});

		const count = row.createSpan({ cls: "ioto-chart-bucket-search-count" });
		this.searchInput = input;
		this.clearButton = clear;
		this.countEl = count;
		this.updateSearchChrome();
	}

	private applyQuery(raw: string): void {
		this.query = raw;
		if (this.searchInput && this.searchInput.value !== raw) {
			this.searchInput.value = raw;
		}
		this.updateSearchChrome();
		this.renderList();
	}

	private updateSearchChrome(): void {
		const active = normalizeQuery(this.query).length > 0;
		if (this.clearButton) {
			this.clearButton.style.display = active ? "" : "none";
		}
		if (this.countEl) {
			this.countEl.style.display = active ? "" : "none";
		}
	}

	private renderList(): void {
		const host = this.listEl;
		if (!host) return;
		host.empty();
		const base = this.filterByMarker();
		const query = normalizeQuery(this.query);
		const matched = query
			? base.filter((ref) => matchBucketRef(ref, query))
			: base;

		if (base.length === 0) {
			host.createDiv({
				cls: "ioto-chart-bucket-empty",
				text: t("CHART_BUCKET_EMPTY"),
			});
		} else if (matched.length === 0) {
			host.createDiv({
				cls: "ioto-chart-bucket-empty",
				text: t("CHART_BUCKET_NO_MATCH", [this.query.trim()]),
			});
		} else if (this.options.payload.bucket === "month") {
			this.renderGrouped(host, matched);
		} else {
			for (const ref of matched) this.renderRow(host, ref);
		}

		host.scrollTop = 0;
		if (this.countEl && query) {
			this.countEl.setText(
				t("CHART_BUCKET_COUNT", [
					String(matched.length),
					String(base.length),
				]),
			);
		}
	}

	private renderFilters(host: HTMLElement, hasCancelled: boolean): void {
		const filters = host.createDiv({ cls: "ioto-chart-bucket-filters" });
		const entries: Array<{ value: TaskFilter; label: string }> = [
			{ value: "all", label: t("CHART_BUCKET_FILTER_ALL") },
			{ value: "done", label: t("DATASET_COL_COMPLETED") },
			{ value: "open", label: t("DATASET_COL_OPEN") },
		];
		const cancelledHint =
			hasCancelled ? t("CHART_BUCKET_CANCELLED_HINT") : "";
		for (const entry of entries) {
			const button = filters.createEl("button", {
				text: entry.label,
				attr: { type: "button" },
			});
			if (entry.value === "open" && cancelledHint) {
				button.setAttr("title", cancelledHint);
				button.setAttr("aria-label", `${entry.label}: ${cancelledHint}`);
			}
			button.toggleClass("is-active", entry.value === this.filter);
			button.addEventListener("click", () => {
				this.filter = entry.value;
				for (const item of this.filterButtons) {
					item.button.toggleClass(
						"is-active",
						item.value === this.filter,
					);
				}
				this.renderList();
			});
			this.filterButtons.push({ value: entry.value, button });
		}
	}

	private renderGrouped(
		host: HTMLElement,
		refs: TimelineSourceRef[],
	): void {
		let day = "";
		for (const ref of refs) {
			const nextDay = ref.date ?? "";
			if (nextDay !== day) {
				day = nextDay;
				if (day) {
					host.createDiv({
						cls: "ioto-chart-bucket-day",
						text: day,
					});
				}
			}
			this.renderRow(host, ref);
		}
	}

	private renderRow(host: HTMLElement, ref: TimelineSourceRef): void {
		const row = host.createDiv({
			cls: "ioto-chart-bucket-row",
			attr: { tabindex: "0", role: "link" },
		});

		if (ref.kind === "task") {
			row.setAttr("data-task", bucketTaskChar(ref.marker));
			const box = row.createEl("input", {
				cls: "task-list-item-checkbox",
				attr: { type: "checkbox", tabindex: "-1", "aria-hidden": "true" },
			});
			box.disabled = true;
			box.checked = isDoneTask(ref.marker);
		} else {
			const icon = row.createSpan({ cls: "ioto-chart-bucket-icon" });
			setIcon(icon, NON_TASK_ICONS[ref.kind]);
		}

		const badgeKey = statusLabelKey(ref.marker);
		if (badgeKey) {
			const status = t(badgeKey);
			row.setAttr("title", status);
			row.setAttr("aria-label", `${status}: ${ref.label}`);
		}

		this.renderLabel(row, ref.label);
		const source = ref.path ? basename(ref.path) : "";
		if (source && source !== ref.label) {
			row.createSpan({
				cls: "ioto-chart-bucket-source",
				text: source,
			});
		}

		if (!ref.path) {
			row.addClass("is-disabled");
			row.setAttr("aria-disabled", "true");
		}

		const reveal = row.createEl("button", {
			cls: "clickable-icon",
			attr: {
				type: "button",
				"aria-label": t("FOLDER_MODAL_REVEAL"),
				title: t("FOLDER_MODAL_REVEAL"),
			},
		});
		setIcon(reveal, "folder-open");
		reveal.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (ref.path) this.options.reveal(ref.path);
		});

		const activate = (): void => {
			if (!ref.path) return;
			this.options.openTask(
				ref.path,
				ref.kind === "task" ? ref.line : undefined,
				ref.kind !== "task",
			);
		};
		row.addEventListener("click", (event) => {
			if ((event.target as HTMLElement | null)?.closest("button, input")) {
				return;
			}
			activate();
		});
		row.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			activate();
		});
	}

	private renderLabel(row: HTMLElement, text: string): void {
		const label = row.createSpan({ cls: "ioto-chart-bucket-label" });
		for (const segment of splitHighlight(text, this.query)) {
			if (segment.hit) {
				label.createEl("mark", { text: segment.text });
			} else {
				label.appendText(segment.text);
			}
		}
	}
}
