import { Plugin, WorkspaceLeaf } from "obsidian";
import { DashboardView } from "./views/DashboardView";
import { DASHBOARD_VIEW_TYPE } from "./models/constants";
import { t } from "./lang/helpers";
import {
	DEFAULT_SETTINGS,
	IotoDashboardSettings,
	DashboardSettingTab,
} from "./settings";

import { IotoSettingsService } from "./services/ioto-settings-services";

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
			"columns-3",
			t("RIBBON_ICON_TITLE"),
			(evt: MouseEvent) => {
				this.activateView(evt.shiftKey);
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

		this.addCommand({
			id: "toggle-dashboard-quick-search",
			name: t("COMMAND_TOGGLE_QUICK_SEARCH"),
			checkCallback: (checking: boolean) => {
				const dashboardLeaf =
					this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
				if (
					dashboardLeaf &&
					dashboardLeaf.view instanceof DashboardView
				) {
					// Also check if it's the active view to avoid overriding when not focused?
					// But user wants global shortcut behavior when in dashboard.
					// Obsidian's "active view" is usually what we want.
					// checkCallback is called often.
					// If we want to restrict to when dashboard is ACTIVE, use app.workspace.getActiveViewOfType.

					const activeView =
						this.app.workspace.getActiveViewOfType(DashboardView);
					if (activeView) {
						if (!checking) {
							activeView.toggleQuickSearch();
						}
						return true;
					}
				}
				return false;
			},
		});

		// Settings Tab
		this.addSettingTab(new DashboardSettingTab(this.app, this));
	}

	onunload() {
		// View automatically unloads
	}

	async activateView(newWindow = false) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;

		if (newWindow) {
			leaf = workspace.getLeaf("window");
			await leaf.setViewState({
				type: DASHBOARD_VIEW_TYPE,
				active: true,
			});
		} else {
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

		const iotoSettingsService = new IotoSettingsService(this.app);

		// 统一获取 IOTO 设置，避免重复调用
		if (iotoSettingsService.isAvailable()) {
			const iotoSettings = iotoSettingsService.getSettings();
			const base = iotoSettings?.extraFolder;
			if (base) {
				const paths = {
					inputFolder:
						iotoSettings.inputFolder ||
						DEFAULT_SETTINGS.inputFolder,
					outputFolder:
						iotoSettings.outputFolder ||
						DEFAULT_SETTINGS.outputFolder,
					taskFolder:
						iotoSettings.taskFolder || DEFAULT_SETTINGS.taskFolder,
					outcomeFolder:
						iotoSettings.outcomeFolder ||
						DEFAULT_SETTINGS.outcomeFolder,
				} as const;

				(Object.keys(paths) as Array<keyof typeof paths>).forEach(
					(key) => {
						if (!this.settings[key]) {
							this.settings[key] = paths[key];
						}
					},
				);
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
