import {
	DropdownComponent,
	TextComponent,
	debounce,
	ToggleComponent,
	Notice,
} from "obsidian";
import { t } from "../../lang/helpers";
import { FilterState } from "../../models/types";
import { CustomFilter } from "../../settings";

export class RightSidebar {
	constructor(
		private container: HTMLElement,
		private filters: FilterState,
		private activeTab: "Notes" | "Tasks",
		private activeQueryId: string | null,
		private allProjects: string[],
		private allStatuses: string[],
		private customFilters: CustomFilter[],
		private onFilterChange: (
			newFilters: FilterState,
			shouldReRender: boolean,
		) => void,
		private onReset: () => void,
		private onSaveQuery: () => void,
		private onUpdateQuery: () => void,
		private showTaskTypeFilter: boolean = false,
	) {}

	render() {
		this.container.empty();
		this.container.createEl("h3", { text: t("FILTER_TITLE") });

		const form = this.container.createDiv({ cls: "filter-form" });

		// Task/Note Type Filter
		if (this.showTaskTypeFilter) {
			const isTask = this.activeTab === "Tasks";
			const labelKey = isTask
				? "FILTER_TASK_TYPE_LABEL"
				: "FILTER_NOTE_TYPE_LABEL";

			const typeDiv = form.createDiv({ cls: "filter-item" });
			typeDiv.createEl("label", { text: t(labelKey as any) });

			const types = ["Input", "Output", "Outcome"];
			const checkboxContainer = typeDiv.createDiv({
				cls: "filter-checkboxes",
			});
			checkboxContainer.style.display = "flex";
			checkboxContainer.style.flexDirection = "column";
			checkboxContainer.style.gap = "10px";
			checkboxContainer.style.marginBottom = "10px";

			types.forEach((type) => {
				let label = "";
				if (type === "Input") label = t("NAV_INPUT");
				else if (type === "Output") label = t("NAV_OUTPUT");
				else if (type === "Outcome") label = t("NAV_OUTCOME");

				const wrapper = checkboxContainer.createDiv();
				wrapper.style.display = "flex";
				wrapper.style.alignItems = "center";
				wrapper.style.justifyContent = "space-between";
				wrapper.style.width = "100%";

				wrapper.createEl("span", {
					text: label,
				});

				const currentTypes = isTask
					? this.filters.taskType || []
					: this.filters.noteType || [];

				const isChecked =
					currentTypes.length === 0 || currentTypes.includes(type);

				const toggle = new ToggleComponent(wrapper)
					.setValue(isChecked)
					.onChange((checked) => {
						let newTypes = isTask
							? this.filters.taskType || []
							: this.filters.noteType || [];

						if (newTypes.length === 0)
							newTypes = ["Input", "Output", "Outcome"];

						if (checked) {
							if (!newTypes.includes(type)) newTypes.push(type);
						} else {
							if (
								newTypes.length === 1 &&
								newTypes.includes(type)
							) {
								const requiredKey = isTask
									? "FILTER_TASK_TYPE_REQUIRED"
									: "FILTER_NOTE_TYPE_REQUIRED";
								new Notice(t(requiredKey as any));
								toggle.setValue(true);
								return;
							}
							newTypes = newTypes.filter((t) => t !== type);
						}

						if (isTask) {
							this.filters.taskType = newTypes;
						} else {
							this.filters.noteType = newTypes;
						}
						this.onFilterChange(this.filters, false);
					});
			});
		}

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
			.onChange(
				debounce(
					(val) => {
						this.filters.name = val;
						this.onFilterChange(this.filters, false);
					},
					300,
					true,
				),
			);

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
			.onChange(
				debounce(
					(val) => {
						this.filters.project = val;
						this.onFilterChange(this.filters, false);
					},
					300,
					true,
				),
			);
		projectInput.inputEl.setAttribute("list", dataListId);

		// File Status Filter (For Notes only)
		if (this.activeTab === "Notes") {
			const fileStatusDiv = form.createDiv({ cls: "filter-item" });
			fileStatusDiv.createEl("label", {
				text: t("FILTER_FILE_STATUS_LABEL"),
			});

			const statusDataListId = "status-list-" + Date.now();
			const statusDataList = fileStatusDiv.createEl("datalist", {
				attr: { id: statusDataListId },
			});
			this.allStatuses.forEach((s) => {
				statusDataList.createEl("option", { attr: { value: s } });
			});

			const statusInput = new TextComponent(fileStatusDiv)
				.setValue(this.filters.fileStatus || "")
				.setPlaceholder(t("FILTER_FILE_STATUS_PLACEHOLDER"))
				.onChange(
					debounce(
						(val) => {
							this.filters.fileStatus = val;
							this.onFilterChange(this.filters, false);
						},
						300,
						true,
					),
				);
			statusInput.inputEl.setAttribute("list", statusDataListId);
		}

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
			.addOption("last1day", t("FILTER_DATE_PRESET_LAST_1_DAY"))
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
						| "last1day"
						| "last3days"
						| "last7days"
						| "last14days"
						| "last30days"
						| "custom",
				) => {
					this.filters.datePreset = val;
					this.onFilterChange(this.filters, true);
				},
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

		// Custom Filters
		if (this.customFilters && this.customFilters.length > 0) {
			this.customFilters.forEach((filter) => {
				const target = filter.target || "all";
				if (this.activeTab === "Notes" && target === "task") return;
				if (this.activeTab === "Tasks" && target === "note") return;

				const div = form.createDiv({ cls: "filter-item" });
				div.createEl("label", { text: filter.name });

				if (!this.filters.custom) this.filters.custom = {};

				const currentValue = this.filters.custom[filter.name];

				if (filter.type === "text" || filter.type === "list") {
					new TextComponent(div)
						.setValue(currentValue || "")
						.setPlaceholder(filter.name)
						.onChange(
							debounce(
								(val) => {
									this.filters.custom![filter.name] = val;
									this.onFilterChange(this.filters, false);
								},
								300,
								true,
							),
						);
				} else if (filter.type === "number") {
					const input = div.createEl("input", { type: "number" });
					input.value = currentValue || "";
					input.style.width = "100%";
					input.onchange = (e) => {
						this.filters.custom![filter.name] = (
							e.target as HTMLInputElement
						).value;
						this.onFilterChange(this.filters, false);
					};
				} else if (filter.type === "boolean") {
					new DropdownComponent(div)
						.addOption("all", t("FILTER_STATUS_ALL"))
						.addOption("true", "True")
						.addOption("false", "False")
						.setValue(currentValue || "all")
						.onChange((val) => {
							this.filters.custom![filter.name] = val;
							this.onFilterChange(this.filters, false);
						});
				} else if (filter.type === "date") {
					const input = div.createEl("input", { type: "date" });
					input.value = currentValue || "";
					input.style.width = "100%";
					input.onchange = (e) => {
						this.filters.custom![filter.name] = (
							e.target as HTMLInputElement
						).value;
						this.onFilterChange(this.filters, false);
					};
				}
			});
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
