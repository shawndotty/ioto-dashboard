import { App, PluginSettingTab, Setting } from "obsidian";
import IotoDashboardPlugin from "./main";

export interface IotoDashboardSettings {
	inputFolder: string;
	outputFolder: string;
	outcomeFolder: string;
}

export const DEFAULT_SETTINGS: IotoDashboardSettings = {
	inputFolder: "1-输入",
	outputFolder: "2-输出",
	outcomeFolder: "4-成果",
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
			.setName("Input Folder")
			.setDesc("Path to the Input folder (e.g. 1-Input)")
			.addText((text) =>
				text
					.setPlaceholder("1-Input")
					.setValue(this.plugin.settings.inputFolder)
					.onChange(async (value) => {
						this.plugin.settings.inputFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Output Folder")
			.setDesc("Path to the Output folder (e.g. 2-Output)")
			.addText((text) =>
				text
					.setPlaceholder("2-Output")
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Outcome Folder")
			.setDesc("Path to the Outcome folder (e.g. 3-Outcome)")
			.addText((text) =>
				text
					.setPlaceholder("3-Outcome")
					.setValue(this.plugin.settings.outcomeFolder)
					.onChange(async (value) => {
						this.plugin.settings.outcomeFolder = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
