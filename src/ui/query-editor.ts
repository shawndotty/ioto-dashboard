import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { t } from "../lang/helpers";
import { createDefaultFilterState } from "../data/saved-query-adapter";
import type { FilterState } from "../data/types";
import type { QueryDefinition, QueryTarget } from "../query/types";
import {
	type CollectionAction,
	type CollectionItem,
	type CollectionLayout,
	renderCollection,
} from "./collection-view";
import { applyModalShell, createLayoutToggle } from "./modal-shell";
import { FolderPickerModal } from "./pickers/folder-picker";

export interface DuplicatedQuery {
	queries: QueryDefinition[];
	created: QueryDefinition;
}

export interface QueryManagerActions {
	onNew(): void;
	onEdit(query: QueryDefinition): void;
	/** Persists a copy and returns the fresh list; null means the write failed. */
	onDuplicate(query: QueryDefinition): Promise<DuplicatedQuery | null>;
	onDelete(query: QueryDefinition): void;
}

export interface QueryManagerPreferences {
	layout: CollectionLayout;
	onLayoutChange(layout: CollectionLayout): void;
}

function displayName(query: QueryDefinition): string {
	return query.nameKey
		? t(query.nameKey as Parameters<typeof t>[0])
		: query.name;
}

export class QueryManagerModal extends Modal {
	private layout: CollectionLayout;
	private collectionEl: HTMLElement | null = null;
	private duplicating = false;

	constructor(
		app: App,
		private queries: QueryDefinition[],
		private referenceCount: (queryId: string) => number,
		private actions: QueryManagerActions,
		private preferences?: QueryManagerPreferences,
	) {
		super(app);
		this.layout = preferences?.layout ?? "list";
	}

	onOpen(): void {
		const { contentEl } = this;
		applyModalShell(this, {
			kind: "query-manager",
			restore: true,
			title: t("QUERY_MANAGER_TITLE"),
		});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(t("QUERY_MANAGER_NEW"))
				.setCta()
				.onClick(() => {
					this.close();
					this.actions.onNew();
				}),
		);

		const body = contentEl.createDiv({ cls: "ioto-modal-body" });
		this.collectionEl = body.createDiv({ cls: "ioto-modal-collection" });
		this.renderItems();

		if (this.preferences) {
			createLayoutToggle(this, this.layout, (layout) => {
				this.layout = layout;
				this.preferences?.onLayoutChange(layout);
				this.renderItems();
			});
		}
	}

	private renderItems(): void {
		if (!this.collectionEl) return;

		const items: CollectionItem[] = this.queries.map((query) => {
			const isUser = query.id.startsWith("user:");
			const references = this.referenceCount(query.id);
			const meta = `${
				query.target === "task"
					? t("QUERY_TARGET_TASK")
					: t("QUERY_TARGET_NOTE")
			} · ${t("QUERY_MANAGER_REFERENCES")} ${references}`;

			const actions: CollectionAction[] = [
				{
					icon: "copy",
					label: t("QUERY_MANAGER_DUPLICATE"),
					onClick: () => void this.duplicate(query),
				},
			];

			if (isUser) {
				actions.push(
					{
						icon: "pencil",
						label: t("QUERY_MANAGER_EDIT"),
						onClick: () => {
							this.close();
							this.actions.onEdit(query);
						},
					},
					{
						icon: "trash",
						label: t("QUERY_MANAGER_DELETE"),
						danger: true,
						onClick: () => {
							this.close();
							this.actions.onDelete(query);
						},
					},
				);
			}

			return {
				id: query.id,
				icon: "filter",
				title: displayName(query),
				meta,
				actions,
			};
		});

		renderCollection(this.collectionEl, items, this.layout);
	}

	private async duplicate(query: QueryDefinition): Promise<void> {
		if (this.duplicating) return;
		this.duplicating = true;
		try {
			const result = await this.actions.onDuplicate(query);
			if (!result) {
				new Notice(t("QUERY_DUPLICATE_FAILED"));
				return;
			}
			this.queries = result.queries;
			this.renderItems();
			this.revealItem(result.created.id);
			new Notice(t("QUERY_DUPLICATED", [result.created.name]));
		} finally {
			this.duplicating = false;
		}
	}

	private revealItem(id: string): void {
		const el = this.collectionEl?.querySelector<HTMLElement>(
			`[data-id="${id}"]`,
		);
		if (!el) return;
		el.scrollIntoView({ block: "nearest" });
		el.addClass("is-newly-copied");
		window.setTimeout(() => el.removeClass("is-newly-copied"), 1600);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Query editor for `user:*` definitions; builtins/saved are duplicated first. */
export class QueryEditModal extends Modal {
	private draft: QueryDefinition;

	constructor(
		app: App,
		initial: QueryDefinition | null,
		private onSave: (query: QueryDefinition) => void,
	) {
		super(app);
		this.draft = initial
			? structuredClone(initial)
			: {
					id: `user:${Date.now()}`,
					name: "",
					target: "task",
					scope: { folders: [], includeSubfolders: true },
					filters: createDefaultFilterState(),
				};
	}

	onOpen(): void {
		const { contentEl } = this;
		applyModalShell(this, {
			kind: "query-editor",
			restore: true,
			title: t(
				this.draft.name
					? "QUERY_EDITOR_TITLE_EDIT"
					: "QUERY_EDITOR_TITLE_NEW",
			),
		});

		const body = contentEl.createDiv({ cls: "ioto-modal-body" });
		let saveButton: ButtonComponent | null = null;

		body.createEl("h3", {
			cls: "setting-item-heading",
			text: t("QUERY_SECTION_BASIC"),
		});

		new Setting(body)
			.setName(t("QUERY_NAME"))
			.addText((text) =>
				text
					.setValue(this.draft.name)
					.onChange((value) => {
						this.draft.name = value;
						const empty = value.trim().length === 0;
						saveButton?.setDisabled(empty);
						nameHint.hidden = !empty;
					}),
			);

		const nameHint = body.createDiv({
			cls: "ioto-modal-hint",
			text: t("QUERY_NAME_REQUIRED"),
		});
		nameHint.hidden = true;

		new Setting(body)
			.setName(t("QUERY_TARGET"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("task", t("QUERY_TARGET_TASK"))
					.addOption("note", t("QUERY_TARGET_NOTE"))
					.addOption("file", t("QUERY_TARGET_FILE"))
					.addOption("folder", t("QUERY_TARGET_FOLDER"))
					.setValue(this.draft.target)
					.onChange((value) => {
						this.draft.target = value as QueryTarget;
						this.contentEl.empty();
						this.onOpen();
					}),
			);

		body.createEl("h3", {
			cls: "setting-item-heading",
			text: t("QUERY_SECTION_SCOPE"),
		});

		const foldersSetting = new Setting(body)
			.setName(t("QUERY_FOLDERS"))
			.setDesc(t("QUERY_FOLDERS_DESC"));
		foldersSetting.addText((text) =>
			text
				.setPlaceholder(t("QUERY_FOLDERS_PLACEHOLDER"))
				.setValue(this.draft.scope.folders.join(", "))
				.onChange((value) => {
					this.draft.scope.folders = value
						.split(",")
						.map((item) => item.trim())
						.filter((item) => item.length > 0);
				}),
		);
		foldersSetting.addButton((button) =>
			button
				.setIcon("folder")
				.setTooltip(t("QUERY_BROWSE_FOLDER"))
				.onClick(() => {
					new FolderPickerModal(this.app, (folder) => {
						if (!this.draft.scope.folders.includes(folder.path)) {
							this.draft.scope.folders.push(folder.path);
						}
						this.contentEl.empty();
						this.onOpen();
					}).open();
				}),
		);

		new Setting(body)
			.setName(t("QUERY_INCLUDE_SUBFOLDERS"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.draft.scope.includeSubfolders)
					.onChange((value) => {
						this.draft.scope.includeSubfolders = value;
					}),
			);

		if (this.draft.target === "task" || this.draft.target === "note") {
			body.createEl("h3", {
				cls: "setting-item-heading",
				text: t("QUERY_SECTION_FILTERS"),
			});

			const filters = body.createDiv({ cls: "ioto-modal-filters" });
			this.addFilterInput(
				filters,
				t("QUERY_FILTER_NAME"),
				"name",
				this.draft.filters.name,
			);
			this.addFilterInput(
				filters,
				t("QUERY_FILTER_PROJECT"),
				"project",
				this.draft.filters.project,
			);
			this.addFilterInput(
				filters,
				t("QUERY_FILTER_SUBJECT"),
				"subject",
				this.draft.filters.subject,
			);

			new Setting(body)
				.setName(t("QUERY_FILTER_DATE_PRESET"))
				.addDropdown((dropdown) => {
					const options: Array<[FilterState["datePreset"], string]> = [
						["all", t("FILTER_DATE_PRESET_ALL")],
						["last1day", t("FILTER_DATE_PRESET_LAST_1_DAY")],
						["last7days", t("FILTER_DATE_PRESET_LAST_7_DAYS")],
						["last30days", t("FILTER_DATE_PRESET_LAST_30_DAYS")],
						["custom", t("FILTER_DATE_PRESET_CUSTOM")],
					];
					for (const [value, label] of options)
						dropdown.addOption(value, label);
					dropdown
						.setValue(this.draft.filters.datePreset)
						.onChange((value) => {
							this.draft.filters.datePreset =
								value as FilterState["datePreset"];
						});
				});
		}

		const footer = contentEl.createDiv({ cls: "ioto-modal-footer" });
		new Setting(footer)
			.addButton((button) =>
				button
					.setButtonText(t("BTN_CANCEL"))
					.onClick(() => this.close()),
			)
			.addButton((button) => {
				saveButton = button;
				button
					.setButtonText(t("QUERY_SAVE"))
					.setCta()
					.setDisabled(this.draft.name.trim().length === 0)
					.onClick(() => {
						if (!this.draft.name.trim()) {
							nameHint.hidden = false;
							return;
						}
						this.onSave(this.draft);
						this.close();
					});
				return button;
			});
	}

	private addFilterInput(
		container: HTMLElement,
		label: string,
		field: "name" | "project" | "subject",
		value: string,
	): void {
		const fieldEl = container.createDiv({ cls: "ioto-modal-filter" });
		fieldEl.createEl("label", { text: label });
		const input = fieldEl.createEl("input", { attr: { type: "text" } });
		input.value = value;
		input.addEventListener("input", () => {
			this.draft.filters[field] = input.value;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
