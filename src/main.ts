import { Plugin, WorkspaceLeaf } from "obsidian";
import { DashboardView } from "./views/DashboardView";
import { DASHBOARD_VIEW_TYPE } from "./models/constants";
import { t } from "./lang/helpers";
import {
	DEFAULT_SETTINGS,
	IotoDashboardSettings,
	DashboardSettingTab,
} from "./settings";

export default class IotoDashboardPlugin extends Plugin {
	settings: IotoDashboardSettings;

	async onload() {
		await this.loadSettings();

		// Register View
		this.registerView(
			DASHBOARD_VIEW_TYPE,
			(leaf) => new DashboardView(leaf, this),
		);

		// Ribbon Icon
		this.addRibbonIcon(
			"layout-dashboard",
			t("RIBBON_ICON_TITLE"),
			(evt: MouseEvent) => {
				this.activateView();
			},
		);

		// Command
		this.addCommand({
			id: "open-ioto-dashboard",
			name: t("COMMAND_OPEN_DASHBOARD"),
			callback: () => {
				this.activateView();
			},
		});

		// Settings Tab
		this.addSettingTab(new DashboardSettingTab(this.app, this));
	}

	onunload() {
		// View automatically unloads
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0]!;
		} else {
			leaf = workspace.getLeaf(false);
			await leaf.setViewState({
				type: DASHBOARD_VIEW_TYPE,
				active: true,
			});
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<IotoDashboardSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
