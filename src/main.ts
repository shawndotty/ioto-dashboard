import { Plugin, WorkspaceLeaf } from "obsidian";
import { DashboardView } from "./views/DashboardView";
import { TaskView } from "./views/TaskView";
import { NoteView } from "./views/NoteView";
import {
	DASHBOARD_VIEW_TYPE,
	TASK_VIEW_TYPE,
	NOTE_VIEW_TYPE,
} from "./models/constants";
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
		this.registerView(TASK_VIEW_TYPE, (leaf) => new TaskView(leaf, this));
		this.registerView(NOTE_VIEW_TYPE, (leaf) => new NoteView(leaf, this));

		// Ribbon Icon
		this.addRibbonIcon(
			"columns-3",
			t("RIBBON_ICON_TITLE"),
			(evt: MouseEvent) => {
				this.activateView({
					newWindow: evt.shiftKey,
					newTab: evt.altKey,
				});
			},
		);

		this.addRibbonIcon(
			"check-square",
			t("RIBBON_TASK_VIEW_TITLE"),
			(evt: MouseEvent) => {
				this.activateTaskView({
					newWindow: evt.shiftKey,
					newTab: evt.altKey,
				});
			},
		);

		this.addRibbonIcon(
			"sticky-note",
			t("RIBBON_NOTE_VIEW_TITLE"),
			(evt: MouseEvent) => {
				this.activateNoteView({
					newWindow: evt.shiftKey,
					newTab: evt.altKey,
				});
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
			id: "open-ioto-task-view",
			name: t("COMMAND_OPEN_TASK_VIEW"),
			callback: () => {
				this.activateTaskView();
			},
		});

		this.addCommand({
			id: "open-ioto-note-view",
			name: t("COMMAND_OPEN_NOTE_VIEW"),
			callback: () => {
				this.activateNoteView();
			},
		});

		this.addCommand({
			id: "toggle-dashboard-quick-search",
			name: t("COMMAND_TOGGLE_QUICK_SEARCH"),
			checkCallback: (checking: boolean) => {
				const activeDashboard =
					this.app.workspace.getActiveViewOfType(DashboardView);
				if (activeDashboard) {
					if (!checking) {
						activeDashboard.toggleQuickSearch();
					}
					return true;
				}

				const activeTaskView =
					this.app.workspace.getActiveViewOfType(TaskView);
				if (activeTaskView) {
					if (!checking) {
						activeTaskView.toggleQuickSearch();
					}
					return true;
				}

				const activeNoteView =
					this.app.workspace.getActiveViewOfType(NoteView);
				if (activeNoteView) {
					if (!checking) {
						activeNoteView.toggleQuickSearch();
					}
					return true;
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

	async activateView(
		options: { newWindow?: boolean; newTab?: boolean } = {},
	) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;

		if (options.newWindow) {
			leaf = workspace.getLeaf("window");
			await leaf.setViewState({
				type: DASHBOARD_VIEW_TYPE,
				active: true,
			});
		} else if (options.newTab) {
			leaf = workspace.getLeaf("tab");
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

	async activateTaskView(
		options: { newWindow?: boolean; newTab?: boolean } = {},
	) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;

		if (options.newWindow) {
			leaf = workspace.getLeaf("window");
			await leaf.setViewState({
				type: TASK_VIEW_TYPE,
				active: true,
			});
		} else if (options.newTab) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: TASK_VIEW_TYPE,
				active: true,
			});
		} else {
			const leaves = workspace.getLeavesOfType(TASK_VIEW_TYPE);

			if (leaves.length > 0) {
				leaf = leaves[0]!;
			} else {
				leaf = workspace.getLeaf(false);
				await leaf.setViewState({
					type: TASK_VIEW_TYPE,
					active: true,
				});
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateNoteView(
		options: { newWindow?: boolean; newTab?: boolean } = {},
	) {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;

		if (options.newWindow) {
			leaf = workspace.getLeaf("window");
			await leaf.setViewState({
				type: NOTE_VIEW_TYPE,
				active: true,
			});
		} else if (options.newTab) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: NOTE_VIEW_TYPE,
				active: true,
			});
		} else {
			const leaves = workspace.getLeavesOfType(NOTE_VIEW_TYPE);

			if (leaves.length > 0) {
				leaf = leaves[0]!;
			} else {
				leaf = workspace.getLeaf(false);
				await leaf.setViewState({
					type: NOTE_VIEW_TYPE,
					active: true,
				});
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			loadedData as Partial<IotoDashboardSettings>,
		);

		if (!loadedData) {
			const iotoSettingsService = new IotoSettingsService(this.app);

			try {
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
								iotoSettings.taskFolder ||
								DEFAULT_SETTINGS.taskFolder,
							outcomeFolder:
								iotoSettings.outcomeFolder ||
								DEFAULT_SETTINGS.outcomeFolder,
						} as const;

						(
							Object.keys(paths) as Array<keyof typeof paths>
						).forEach((key) => {
							if (!this.settings[key]) {
								this.settings[key] = paths[key];
							}
						});
					}
				}
			} catch (error) {
				console.warn(
					"IOTO Dashboard: Failed to load IOTO Settings",
					error,
				);
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
