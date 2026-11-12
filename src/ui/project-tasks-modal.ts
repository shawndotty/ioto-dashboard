import {
	App,
	ButtonComponent,
	Component,
	MarkdownRenderer,
	Modal,
	moment,
} from "obsidian";
import { t } from "../lang/helpers";
import {
	displayRatio,
	percentText,
} from "../dashboard/components/project-progress";
import {
	groupPendingByNote,
	markerBadgeKey,
	markerChar,
	visibleChips,
	type MarkerBadgeKey,
} from "../dashboard/components/project-tasks";
import type {
	ProjectPendingTask,
	ProjectProgressGroup,
} from "../metrics/types";
import { applyModalShell } from "./modal-shell";

const MAX_MARKDOWN_ROWS = 100;

const BADGE_HINTS: Record<MarkerBadgeKey, Parameters<typeof t>[0]> = {
	PROJECT_TASKS_BADGE_IN_PROGRESS: "PROJECT_TASKS_BADGE_IN_PROGRESS_HINT",
	PROJECT_TASKS_BADGE_FORWARDED: "PROJECT_TASKS_BADGE_FORWARDED_HINT",
	PROJECT_TASKS_BADGE_OTHER: "PROJECT_TASKS_BADGE_OTHER_HINT",
};

export interface ProjectTasksModalOptions {
	group: ProjectProgressGroup;
	/** Same denominator the progress row uses; keeps both percentages identical. */
	ratioBase: string;
	projectNotePath: string;
	projectNoteExists: boolean;
	/** False for groups without a folder (unclassified), which cannot be revealed. */
	revealable: boolean;
	openTask(path: string, line: number, newTab: boolean): void;
	reveal(path: string): void;
}

function isOverdue(dueDate: string | undefined): boolean {
	if (!dueDate) return false;
	const due = Date.parse(dueDate);
	if (Number.isNaN(due)) return false;
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return due < today.getTime();
}

export class ProjectTasksModal extends Modal {
	private readonly renderHost = new Component();

	constructor(
		app: App,
		private readonly options: ProjectTasksModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { group, ratioBase } = this.options;
		const name = group.nameKey
			? t(group.nameKey as Parameters<typeof t>[0])
			: group.name;

		applyModalShell(this, {
			kind: "project-tasks",
			restore: true,
			title: t("PROJECT_TASKS_MODAL_TITLE", [name]),
		});
		this.renderHost.load();

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ioto-project-tasks");

		const pending = group.pending ?? [];
		const pendingTotal = group.pendingTotal ?? 0;
		const counts = group.pendingCounts ?? {
			open: group.bucket.open,
			inProgress: 0,
			forwarded: 0,
			other: group.bucket.other,
		};
		const ratio = displayRatio(group.bucket, ratioBase);

		const overview = contentEl.createDiv({
			cls: "ioto-project-tasks-overview",
		});
		overview.createDiv({
			cls: "ioto-project-tasks-summary",
			text: t("PROJECT_TASKS_SUMMARY", [
				String(group.bucket.completed),
				String(group.bucket.total),
				percentText(ratio),
				String(pendingTotal),
			]),
		});

		if (group.status || group.dueDate) {
			const meta = overview.createDiv({
				cls: "ioto-project-tasks-meta",
			});
			if (group.status) {
				meta.createSpan({
					text: t("PROJECT_TASKS_STATUS", [group.status]),
				});
			}
			if (group.dueDate) {
				if (group.status) meta.appendText(" · ");
				const due = meta.createSpan({
					text: t("PROJECT_TASKS_DUE", [group.dueDate]),
				});
				if (pendingTotal > 0 && isOverdue(group.dueDate)) {
					due.addClass("is-overdue");
				}
			}
		}

		const chips = visibleChips(counts);
		if (chips.length > 0) {
			const chipRow = overview.createDiv({
				cls: "ioto-project-tasks-chips",
			});
			for (const chip of chips) {
				chipRow.createSpan({
					cls: "ioto-project-tasks-chip",
					text: t(chip.key, [String(chip.count)]),
				});
			}
		}

		const body = contentEl.createDiv({
			cls: "ioto-modal-body ioto-project-tasks-body",
		});
		if (pendingTotal === 0) {
			this.renderEmpty(body, group.bucket.total, ratio);
		} else {
			this.renderGroups(body, pending, pending.length <= MAX_MARKDOWN_ROWS);
		}

		const footer = contentEl.createDiv({ cls: "ioto-modal-footer" });
		const scope = footer.createDiv({ cls: "ioto-project-tasks-scope" });
		scope.createDiv({ text: t("PROJECT_TASKS_SCOPE_HINT") });
		if (pendingTotal > pending.length) {
			scope.createDiv({
				text: t("PROJECT_TASKS_TRUNCATED", [
					String(pending.length),
					String(pendingTotal),
				]),
			});
		}
		if (group.bucket.cancelled > 0) {
			scope.createDiv({
				text: t("PROJECT_TASKS_CANCELLED_NOTE", [
					String(group.bucket.cancelled),
				]),
			});
		}

		const actions = footer.createDiv({
			cls: "ioto-modal-footer__actions",
		});
		const openNote = new ButtonComponent(actions)
			.setButtonText(t("PROJECT_TASKS_OPEN_NOTE"))
			.onClick(() => {
				this.close();
				this.options.openTask(this.options.projectNotePath, 0, false);
			});
		openNote.setDisabled(!this.options.projectNoteExists);
		const reveal = new ButtonComponent(actions)
			.setButtonText(t("PROJECT_TASKS_REVEAL"))
			.onClick(() => {
				this.close();
				this.options.reveal(group.folder);
			});
		reveal.setDisabled(!this.options.revealable);
	}

	onClose(): void {
		this.contentEl.empty();
		this.renderHost.unload();
	}

	private renderEmpty(
		host: HTMLElement,
		total: number,
		ratio: number | null,
	): void {
		const empty = host.createDiv({ cls: "ioto-project-tasks-empty" });
		if (total > 0) {
			empty.createDiv({
				cls: "ioto-project-tasks-empty-ratio",
				text: percentText(ratio),
			});
		}
		empty.createDiv({
			text: t(
				total > 0 ? "PROJECT_TASKS_ALL_DONE" : "PROJECT_TASKS_EMPTY",
			),
		});
	}

	private renderGroups(
		host: HTMLElement,
		pending: ProjectPendingTask[],
		useMarkdown: boolean,
	): void {
		for (const note of groupPendingByNote(pending)) {
			const section = host.createDiv({
				cls: "ioto-project-tasks-note-group",
			});
			const header = section.createDiv({ cls: "ioto-project-tasks-note" });
			const link = header.createEl("a", {
				cls: "internal-link ioto-project-tasks-note-link",
				text: note.basename,
				href: note.path,
			});
			link.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.close();
				this.options.openTask(
					note.path,
					0,
					event.metaKey || event.ctrlKey,
				);
			});
			header
				.createSpan({
					cls: "ioto-project-tasks-note-meta",
					text: moment(note.noteMtime).fromNow(),
				})
				.setAttr(
					"title",
					moment(note.noteMtime).format("YYYY-MM-DD HH:mm"),
				);
			for (const item of note.items) {
				this.renderItem(section, item, useMarkdown);
			}
		}
	}

	private renderItem(
		host: HTMLElement,
		item: ProjectPendingTask,
		useMarkdown: boolean,
	): void {
		const label = item.text.trim() ? item.text : t("PROJECT_TASKS_UNTITLED");
		const badgeKey = markerBadgeKey(item.marker);
		const row = host.createDiv({
			cls: "task-list-item ioto-project-tasks-item",
		});
		row.setAttr("data-task", markerChar(item.marker));
		row.setAttr("role", "button");
		row.setAttr("tabindex", "0");
		row.setAttr(
			"aria-label",
			badgeKey ? `${t(badgeKey)}: ${label}` : label,
		);

		const checkbox = row.createEl("input", {
			cls: "task-list-item-checkbox",
			type: "checkbox",
		});
		checkbox.disabled = true;

		const textEl = row.createDiv({ cls: "ioto-project-tasks-text" });
		if (useMarkdown && item.text.trim()) {
			void MarkdownRenderer.render(
				this.app,
				item.text,
				textEl,
				item.path,
				this.renderHost,
			);
		} else {
			textEl.setText(label);
		}

		if (badgeKey) {
			row.createSpan({
				cls: "ioto-project-tasks-badge",
				text: t(badgeKey),
			}).setAttr("title", t(BADGE_HINTS[badgeKey]));
		}

		const open = (newTab: boolean): void => {
			this.close();
			this.options.openTask(item.path, item.line, newTab);
		};
		const onLink = (target: EventTarget | null): boolean =>
			target instanceof HTMLElement &&
			target.closest("a.internal-link") !== null;
		row.onClickEvent((event: MouseEvent) => {
			if (onLink(event.target)) return;
			open(event.metaKey || event.ctrlKey);
		});
		row.addEventListener("keydown", (event: KeyboardEvent) => {
			if (onLink(event.target)) return;
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				open(false);
			}
		});
	}
}
