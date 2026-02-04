import { App, PluginSettingTab, Setting } from "obsidian";
import IotoDashboardPlugin from "./main";
import { t } from "./lang/helpers";
import { FolderPickerModal } from "./ui/pickers/folder-picker";
import { TabbedSettings } from "ui/tabbed-settings";
export interface SavedQuery {
	id: string;
	name: string;
	category: "Input" | "Output" | "Outcome";
	tab: "Notes" | "Tasks";
	filters: {
		name: string;
		project: string;
		dateType: "created" | "modified";
		dateStart: string;
		dateEnd: string;
		datePreset:
			| "all"
			| "last3days"
			| "last7days"
			| "last14days"
			| "last30days"
			| "custom";
		status: "all" | "completed" | "incomplete";
		custom?: Record<string, any>;
	};
}

export interface CustomFilter {
	name: string;
	type: "text" | "number" | "boolean" | "date" | "list";
}

export interface IotoDashboardSettings {
	inputFolder: string;
	outputFolder: string;
	taskFolder: string;
	outcomeFolder: string;
	pageSize: number;
	savedQueries: SavedQuery[];
	customFilters: CustomFilter[];
}

export const DEFAULT_SETTINGS: IotoDashboardSettings = {
	inputFolder: t("INPUT_FOLDER"),
	outputFolder: t("OUTPUT_FOLDER"),
	taskFolder: t("TASK_FOLDER"),
	outcomeFolder: t("OUTCOME_FOLDER"),
	pageSize: 100,
	savedQueries: [],
	customFilters: [],
};

export class DashboardSettingTab extends PluginSettingTab {
	plugin: IotoDashboardPlugin;
	private currentTabIndex = 0;

	constructor(app: App, plugin: IotoDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const tabbedSettings = new TabbedSettings(containerEl);

		const tabConfigs = [
			{
				title: "SETTINGS_BASIC_NAME",
				renderMethod: (container: HTMLElement) =>
					this.renderBasicSettings(container),
			},
			{
				title: "SETTINGS_CUSTOM_FILTERS_NAME",
				renderMethod: (container: HTMLElement) =>
					this.renderCustomFiltersSettings(container),
			},
		];

		tabConfigs.forEach((config) => {
			const title =
				t(config.title as any) === config.title
					? config.title
					: t(config.title as any);
			tabbedSettings.addTab(title, config.renderMethod);
		});

		tabbedSettings.activateTab(this.currentTabIndex);
	}

	private renderBasicSettings(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName(t("SETTINGS_INPUT_FOLDER_NAME"))
			.setDesc(t("SETTINGS_INPUT_FOLDER_DESC"))
			.addText((text) =>
				text
					.setPlaceholder("1-Input")
					.setValue(this.plugin.settings.inputFolder)
					.onChange(async (value) => {
						this.plugin.settings.inputFolder = value;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((btn) =>
				btn
					.setIcon("folder")
					.setTooltip(t("CHOOSE_A_FOLDER"))
					.onClick(() => {
						new FolderPickerModal(this.app, async (folder) => {
							this.plugin.settings.inputFolder = folder.path;
							await this.plugin.saveSettings();
							this.display();
						}).open();
					}),
			);

		new Setting(containerEl)
			.setName(t("SETTINGS_OUTPUT_FOLDER_NAME"))
			.setDesc(t("SETTINGS_OUTPUT_FOLDER_DESC"))
			.addText((text) =>
				text
					.setPlaceholder("2-Output")
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((btn) =>
				btn
					.setIcon("folder")
					.setTooltip(t("CHOOSE_A_FOLDER"))
					.onClick(() => {
						new FolderPickerModal(this.app, async (folder) => {
							this.plugin.settings.outputFolder = folder.path;
							await this.plugin.saveSettings();
							this.display();
						}).open();
					}),
			);

		new Setting(containerEl)
			.setName(t("SETTINGS_TASK_FOLDER_NAME"))
			.setDesc(t("SETTINGS_TASK_FOLDER_DESC"))
			.addText((text) =>
				text
					.setPlaceholder("3-Task")
					.setValue(this.plugin.settings.taskFolder)
					.onChange(async (value) => {
						this.plugin.settings.taskFolder = value;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((btn) =>
				btn
					.setIcon("folder")
					.setTooltip(t("CHOOSE_A_FOLDER"))
					.onClick(() => {
						new FolderPickerModal(this.app, async (folder) => {
							this.plugin.settings.taskFolder = folder.path;
							await this.plugin.saveSettings();
							this.display();
						}).open();
					}),
			);

		new Setting(containerEl)
			.setName(t("SETTINGS_OUTCOME_FOLDER_NAME"))
			.setDesc(t("SETTINGS_OUTCOME_FOLDER_DESC"))
			.addText((text) =>
				text
					.setPlaceholder("4-Outcome")
					.setValue(this.plugin.settings.outcomeFolder)
					.onChange(async (value) => {
						this.plugin.settings.outcomeFolder = value;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((btn) =>
				btn
					.setIcon("folder")
					.setTooltip(t("CHOOSE_A_FOLDER"))
					.onClick(() => {
						new FolderPickerModal(this.app, async (folder) => {
							this.plugin.settings.outcomeFolder = folder.path;
							await this.plugin.saveSettings();
							this.display();
						}).open();
					}),
			);

		new Setting(containerEl)
			.setName(t("SETTINGS_PAGE_SIZE_NAME"))
			.setDesc(t("SETTINGS_PAGE_SIZE_DESC"))
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.pageSize))
					.onChange(async (value) => {
						let val = parseInt(value);
						if (isNaN(val)) return;
						if (val < 20) val = 20;
						if (val > 300) val = 300;
						this.plugin.settings.pageSize = val;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderCustomFiltersSettings(containerEl: HTMLElement) {
		containerEl.createEl("p", { text: t("SETTINGS_CUSTOM_FILTERS_DESC") });
		// Add new filter
		let newFilterName = "";
		let newFilterType: CustomFilter["type"] = "text";

		new Setting(containerEl)
			.setName(t("SETTINGS_ADD_FILTER_BTN"))
			.addText((text) =>
				text
					.setPlaceholder(t("SETTINGS_FILTER_NAME_PLACEHOLDER"))
					.onChange((val) => (newFilterName = val)),
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("text", t("SETTINGS_FILTER_TYPE_TEXT"))
					.addOption("number", t("SETTINGS_FILTER_TYPE_NUMBER"))
					.addOption("boolean", t("SETTINGS_FILTER_TYPE_BOOLEAN"))
					.addOption("date", t("SETTINGS_FILTER_TYPE_DATE"))
					.addOption("list", t("SETTINGS_FILTER_TYPE_LIST"))
					.setValue("text")
					.onChange((val) => (newFilterType = val as any)),
			)
			.addButton((btn) =>
				btn
					.setButtonText(t("SETTINGS_ADD_FILTER_BTN"))
					.setCta()
					.onClick(async () => {
						if (newFilterName) {
							// Check for duplicates
							if (
								this.plugin.settings.customFilters.some(
									(f) => f.name === newFilterName,
								)
							) {
								return;
							}

							this.plugin.settings.customFilters.push({
								name: newFilterName,
								type: newFilterType,
							});
							await this.plugin.saveSettings();
							this.currentTabIndex = 1;
							this.display();
						}
					}),
			);
		// List existing filters
		this.plugin.settings.customFilters.forEach((filter, index) => {
			new Setting(containerEl)
				.setName(filter.name)
				.setDesc(
					filter.type === "text"
						? t("SETTINGS_FILTER_TYPE_TEXT")
						: filter.type === "number"
							? t("SETTINGS_FILTER_TYPE_NUMBER")
							: filter.type === "boolean"
								? t("SETTINGS_FILTER_TYPE_BOOLEAN")
								: filter.type === "date"
									? t("SETTINGS_FILTER_TYPE_DATE")
									: t("SETTINGS_FILTER_TYPE_LIST"),
				)
				.addButton((btn) =>
					btn
						.setButtonText(t("SETTINGS_DELETE_FILTER_BTN"))
						.setWarning()
						.onClick(async () => {
							this.plugin.settings.customFilters.splice(index, 1);
							await this.plugin.saveSettings();
							this.currentTabIndex = 1;
							this.display();
						}),
				);
		});
	}
}
