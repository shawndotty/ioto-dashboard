import { App, Modal, setIcon } from "obsidian";
import { t } from "../lang/helpers";
import type { ChartBucketPayload } from "../dashboard/registry";
import type { TimelineSourceRef } from "../dashboard/dataset/timeline";
import { applyModalShell } from "./modal-shell";

export interface ChartBucketModalOptions {
	payload: ChartBucketPayload;
	openTask(path: string, line: number | undefined, newTab: boolean): void;
	reveal(path: string): void;
}

type TaskFilter = "all" | "done" | "open";

const KIND_ICONS: Record<TimelineSourceRef["kind"], string> = {
	task: "check-square",
	note: "file-text",
	file: "file",
};

function basename(path: string): string {
	const index = path.lastIndexOf("/");
	return index >= 0 ? path.slice(index + 1) : path;
}

export class ChartBucketModal extends Modal {
	private filter: TaskFilter = "all";

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
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private visibleRefs(): TimelineSourceRef[] {
		const refs = this.options.payload.refs;
		if (this.options.payload.object !== "task" || this.filter === "all") {
			return refs;
		}
		return refs.filter((ref) =>
			this.filter === "done" ? ref.marker === "done" : ref.marker !== "done",
		);
	}

	private render(): void {
		const content = this.contentEl;
		content.empty();
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
		if (payload.object === "task") {
			content.createDiv({
				cls: "ioto-chart-bucket-hint",
				text: t("CHART_BUCKET_SOURCE_HINT"),
			});
		}

		if (payload.object === "task") this.renderFilters(content);

		const refs = this.visibleRefs();
		const list = content.createDiv({ cls: "ioto-chart-bucket-list" });
		if (refs.length === 0) {
			list.createDiv({
				cls: "ioto-chart-bucket-empty",
				text: t("CHART_BUCKET_EMPTY"),
			});
		} else if (payload.bucket === "month") {
			this.renderGrouped(list, refs);
		} else {
			for (const ref of refs) this.renderRow(list, ref);
		}

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

	private renderFilters(host: HTMLElement): void {
		const filters = host.createDiv({ cls: "ioto-chart-bucket-filters" });
		const entries: Array<{ value: TaskFilter; label: string }> = [
			{ value: "all", label: t("CHART_BUCKET_FILTER_ALL") },
			{ value: "done", label: t("DATASET_COL_COMPLETED") },
			{ value: "open", label: t("DATASET_COL_OPEN") },
		];
		for (const entry of entries) {
			const button = filters.createEl("button", {
				text: entry.label,
				attr: { type: "button" },
			});
			button.toggleClass("is-active", entry.value === this.filter);
			button.addEventListener("click", () => {
				this.filter = entry.value;
				this.render();
			});
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
		const icon = row.createSpan({ cls: "ioto-chart-bucket-icon" });
		setIcon(icon, KIND_ICONS[ref.kind]);
		row.createSpan({
			cls: "ioto-chart-bucket-label",
			text: ref.label,
		});
		const source = ref.path ? basename(ref.path) : "";
		if (source && source !== ref.label) {
			row.createSpan({
				cls: "ioto-chart-bucket-source",
				text: source,
			});
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
			if ((event.target as HTMLElement | null)?.closest("button")) return;
			activate();
		});
		row.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			activate();
		});
	}
}
