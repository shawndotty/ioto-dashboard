import { App, PluginSettingTab, Setting } from "obsidian";
import IotoDashboardPlugin from "./main";
import { t } from "./lang/helpers";
import { FolderPickerModal } from "./ui/pickers/folder-picker";
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
	};
}

export interface IotoDashboardSettings {
	inputFolder: string;
	outputFolder: string;
	taskFolder: string;
	outcomeFolder: string;
	savedQueries: SavedQuery[];
}

export const DEFAULT_SETTINGS: IotoDashboardSettings = {
	inputFolder: t("INPUT_FOLDER"),
	outputFolder: t("OUTPUT_FOLDER"),
	taskFolder: t("TASK_FOLDER"),
	outcomeFolder: t("OUTCOME_FOLDER"),
	savedQueries: [],
};

export class DashboardSettingTab extends PluginSettingTab {
	plugin: IotoDashboardPlugin;

	constructor(app: App, plugin: IotoDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

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
	}
}
