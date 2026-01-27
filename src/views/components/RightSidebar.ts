import { DropdownComponent, TextComponent } from "obsidian";
import { t } from "../../lang/helpers";
import { FilterState } from "../../models/types";

export class RightSidebar {
	constructor(
		private container: HTMLElement,
		private filters: FilterState,
		private activeTab: "Notes" | "Tasks",
		private activeQueryId: string | null,
		private allProjects: string[],
		private onFilterChange: (
			newFilters: FilterState,
			shouldReRender: boolean
		) => void,
		private onReset: () => void,
		private onSaveQuery: () => void,
		private onUpdateQuery: () => void
	) {}

	render() {
		this.container.empty();
		this.container.createEl("h3", { text: t("FILTER_TITLE") });

		const form = this.container.createDiv({ cls: "filter-form" });

		// Name Filter
		const nameDiv = form.createDiv({ cls: "filter-item" });
		nameDiv.createEl("label", {
			text:
				this.activeTab === "Notes"
					? t("FILTER_NAME_LABEL_NOTES")
					: t("FILTER_NAME_LABEL_TASKS"),
		});
		new TextComponent(nameDiv)
			.setValue(this.filters.name)
			.setPlaceholder(t("FILTER_NAME_PLACEHOLDER"))
			.onChange((val) => {
				this.filters.name = val;
				this.onFilterChange(this.filters, false);
			});

		// Status Filter (Only for Tasks)
		if (this.activeTab === "Tasks") {
			const statusDiv = form.createDiv({ cls: "filter-item" });
			statusDiv.createEl("label", { text: t("FILTER_STATUS_LABEL") });
			new DropdownComponent(statusDiv)
				.addOption("all", t("FILTER_STATUS_ALL"))
				.addOption("completed", t("FILTER_STATUS_COMPLETED"))
				.addOption("incomplete", t("FILTER_STATUS_INCOMPLETE"))
				.setValue(this.filters.status)
				.onChange((val: "all" | "completed" | "incomplete") => {
					this.filters.status = val;
					this.onFilterChange(this.filters, false);
				});
		}

		// Project Filter
		const projectDiv = form.createDiv({ cls: "filter-item" });
		projectDiv.createEl("label", { text: t("FILTER_PROJECT_LABEL") });

		const dataListId = "project-list-" + Date.now();
		const dataList = projectDiv.createEl("datalist", {
			attr: { id: dataListId },
		});
		this.allProjects.forEach((p) => {
			dataList.createEl("option", { attr: { value: p } });
		});

		const projectInput = new TextComponent(projectDiv)
			.setValue(this.filters.project)
			.setPlaceholder(t("FILTER_PROJECT_PLACEHOLDER"))
			.onChange((val) => {
				this.filters.project = val;
				this.onFilterChange(this.filters, false);
			});
		projectInput.inputEl.setAttribute("list", dataListId);

		// Date Type
		const dateTypeDiv = form.createDiv({ cls: "filter-item" });
		dateTypeDiv.createEl("label", { text: t("FILTER_DATE_TYPE_LABEL") });
		new DropdownComponent(dateTypeDiv)
			.addOption("created", t("FILTER_DATE_TYPE_CREATED"))
			.addOption("modified", t("FILTER_DATE_TYPE_MODIFIED"))
			.setValue(this.filters.dateType)
			.onChange((val: "created" | "modified") => {
				this.filters.dateType = val;
				this.onFilterChange(this.filters, false);
			});

		// Date Preset
		const datePresetDiv = form.createDiv({ cls: "filter-item" });
		datePresetDiv.createEl("label", {
			text: t("FILTER_DATE_PRESET_LABEL"),
		});
		new DropdownComponent(datePresetDiv)
			.addOption("all", t("FILTER_DATE_PRESET_ALL"))
			.addOption("last3days", t("FILTER_DATE_PRESET_LAST_3_DAYS"))
			.addOption("last7days", t("FILTER_DATE_PRESET_LAST_7_DAYS"))
			.addOption("last14days", t("FILTER_DATE_PRESET_LAST_14_DAYS"))
			.addOption("last30days", t("FILTER_DATE_PRESET_LAST_30_DAYS"))
			.addOption("custom", t("FILTER_DATE_PRESET_CUSTOM"))
			.setValue(this.filters.datePreset)
			.onChange(
				(
					val:
						| "all"
						| "last3days"
						| "last7days"
						| "last14days"
						| "last30days"
						| "custom"
				) => {
					this.filters.datePreset = val;
					this.onFilterChange(this.filters, true);
				}
			);

		// Date Start & End (Only if Custom)
		if (this.filters.datePreset === "custom") {
			const dateStartDiv = form.createDiv({ cls: "filter-item" });
			dateStartDiv.createEl("label", {
				text: t("FILTER_DATE_START_LABEL"),
			});
			const dateStartInput = dateStartDiv.createEl("input", {
				type: "date",
			});
			dateStartInput.value = this.filters.dateStart;
			dateStartInput.onchange = (e) => {
				this.filters.dateStart = (e.target as HTMLInputElement).value;
				this.onFilterChange(this.filters, false);
			};

			const dateEndDiv = form.createDiv({ cls: "filter-item" });
			dateEndDiv.createEl("label", { text: t("FILTER_DATE_END_LABEL") });
			const dateEndInput = dateEndDiv.createEl("input", { type: "date" });
			dateEndInput.value = this.filters.dateEnd;
			dateEndInput.onchange = (e) => {
				this.filters.dateEnd = (e.target as HTMLInputElement).value;
				this.onFilterChange(this.filters, false);
			};
		}

		// Reset Button
		const btnDiv = form.createDiv({ cls: "filter-actions" });
		btnDiv.style.display = "flex";
		btnDiv.style.gap = "10px";

		const resetBtn = btnDiv.createEl("button", {
			text: t("FILTER_RESET_BTN"),
		});
		resetBtn.style.flex = "1";
		resetBtn.onclick = () => {
			this.onReset();
		};

		if (this.activeQueryId) {
			const updateBtn = btnDiv.createEl("button", {
				text: t("BTN_UPDATE_QUERY"),
				cls: "mod-cta",
			});
			updateBtn.style.flex = "1";
			updateBtn.onclick = () => {
				this.onUpdateQuery();
			};
		} else {
			const saveBtn = btnDiv.createEl("button", {
				text: t("BTN_SAVE_QUERY"),
				cls: "mod-cta",
			});
			saveBtn.style.flex = "1";
			saveBtn.onclick = () => {
				this.onSaveQuery();
			};
		}
	}
}
