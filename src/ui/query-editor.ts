import { App, Modal, Setting } from "obsidian";
import { t } from "../lang/helpers";
import { createDefaultFilterState } from "../data/saved-query-adapter";
import type { FilterState } from "../data/types";
import type { QueryDefinition, QueryTarget } from "../query/types";
import { FolderPickerModal } from "./pickers/folder-picker";

export interface QueryManagerActions {
	onNew(): void;
	onEdit(query: QueryDefinition): void;
	onDuplicate(query: QueryDefinition): void;
	onDelete(query: QueryDefinition): void;
}

function displayName(query: QueryDefinition): string {
	return query.nameKey
		? t(query.nameKey as Parameters<typeof t>[0])
		: query.name;
}

export class QueryManagerModal extends Modal {
	constructor(
		app: App,
		private queries: QueryDefinition[],
		private referenceCount: (queryId: string) => number,
		private actions: QueryManagerActions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("QUERY_MANAGER_TITLE") });
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(t("QUERY_MANAGER_NEW"))
				.setCta()
				.onClick(() => {
					this.close();
					this.actions.onNew();
				}),
		);

		for (const query of this.queries) {
			const isUser = query.id.startsWith("user:");
			const references = this.referenceCount(query.id);
			const setting = new Setting(contentEl)
				.setName(displayName(query))
				.setDesc(
					`${query.target === "task" ? t("QUERY_TARGET_TASK") : t("QUERY_TARGET_NOTE")} · ${t("QUERY_MANAGER_REFERENCES")} ${references}`,
				)
				.addExtraButton((button) =>
					button
						.setIcon("copy")
						.setTooltip(t("QUERY_MANAGER_DUPLICATE"))
						.onClick(() => {
							this.close();
							this.actions.onDuplicate(query);
						}),
				);
			if (isUser) {
				setting
					.addExtraButton((button) =>
						button
							.setIcon("pencil")
							.setTooltip(t("QUERY_MANAGER_EDIT"))
							.onClick(() => {
								this.close();
								this.actions.onEdit(query);
							}),
					)
					.addExtraButton((button) =>
						button
							.setIcon("trash")
							.setTooltip(t("QUERY_MANAGER_DELETE"))
							.onClick(() => {
								this.close();
								this.actions.onDelete(query);
							}),
					);
			}
		}
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
		contentEl.createEl("h2", {
			text: t(
				this.draft.name
					? "QUERY_EDITOR_TITLE_EDIT"
					: "QUERY_EDITOR_TITLE_NEW",
			),
		});

		new Setting(contentEl)
			.setName(t("QUERY_NAME"))
			.addText((text) =>
				text
					.setValue(this.draft.name)
					.onChange((value) => {
						this.draft.name = value;
					}),
			);

		new Setting(contentEl)
			.setName(t("QUERY_TARGET"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("task", t("QUERY_TARGET_TASK"))
					.addOption("note", t("QUERY_TARGET_NOTE"))
					.setValue(this.draft.target)
					.onChange((value) => {
						this.draft.target = value as QueryTarget;
					}),
			);

		const foldersSetting = new Setting(contentEl)
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

		new Setting(contentEl)
			.setName(t("QUERY_INCLUDE_SUBFOLDERS"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.draft.scope.includeSubfolders)
					.onChange((value) => {
						this.draft.scope.includeSubfolders = value;
					}),
			);

		this.addFilterInput(
			contentEl,
			t("QUERY_FILTER_NAME"),
			"name",
			this.draft.filters.name,
		);
		this.addFilterInput(
			contentEl,
			t("QUERY_FILTER_PROJECT"),
			"project",
			this.draft.filters.project,
		);
		this.addFilterInput(
			contentEl,
			t("QUERY_FILTER_SUBJECT"),
			"subject",
			this.draft.filters.subject,
		);

		new Setting(contentEl)
			.setName(t("QUERY_FILTER_DATE_PRESET"))
			.addDropdown((dropdown) => {
				const options: Array<[FilterState["datePreset"], string]> = [
					["all", t("FILTER_DATE_PRESET_ALL")],
					["last1day", t("FILTER_DATE_PRESET_LAST_1_DAY")],
					["last7days", t("FILTER_DATE_PRESET_LAST_7_DAYS")],
					["last30days", t("FILTER_DATE_PRESET_LAST_30_DAYS")],
					["custom", t("FILTER_DATE_PRESET_CUSTOM")],
				];
				for (const [value, label] of options) dropdown.addOption(value, label);
				dropdown
					.setValue(this.draft.filters.datePreset)
					.onChange((value) => {
						this.draft.filters.datePreset =
							value as FilterState["datePreset"];
					});
			});

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(t("BTN_CANCEL"))
					.onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText(t("QUERY_SAVE"))
					.setCta()
					.onClick(() => {
						if (!this.draft.name.trim()) return;
						this.onSave(this.draft);
						this.close();
					}),
			);
	}

	private addFilterInput(
		container: HTMLElement,
		label: string,
		field: "name" | "project" | "subject",
		value: string,
	): void {
		new Setting(container).setName(label).addText((text) =>
			text.setValue(value).onChange((next) => {
				this.draft.filters[field] = next;
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
