import { Command, Plugin, WorkspaceLeaf } from "obsidian";
import { DashboardView } from "./views/DashboardView";
import { TaskView } from "./views/TaskView";
import { NoteView } from "./views/NoteView";
import { CustomDashboardView } from "./views/CustomDashboardView";
import { CustomInspectorView } from "./views/CustomInspectorView";
import {
	CUSTOM_DASHBOARD_VIEW_TYPE,
	CUSTOM_INSPECTOR_VIEW_TYPE,
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
import { restoreMacWindowButtons } from "./ui/macos-window-buttons";
import { VaultIndex } from "./data/vault-index";
import type { IndexConfig, SectionHeadings } from "./data/types";
import { DashboardRepository } from "./dashboard/repository";
import { dashboardCommandId } from "./dashboard/command-ids";
import type {
	DashboardStoreData,
} from "./dashboard/types";
import { DashboardPickerModal } from "./ui/dashboard-picker";
import { DashboardInspectorService } from "./dashboard/inspector-service";
import {
	SnapshotStore,
	collectDailySnapshot,
	localDate,
} from "./metrics/snapshot-store";

function splitHeadingList(value: string | undefined, fallback: string): string[] {
	if (!value) return [fallback];
	const items = value
		.split(/[\r\n,，;；]+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return items.length > 0 ? items : [fallback];
}

export default class IotoDashboardPlugin extends Plugin {
	settings: IotoDashboardSettings;
	index: VaultIndex;
	dashboardRepository: DashboardRepository;
	snapshotStore: SnapshotStore;
	readonly inspectorService = new DashboardInspectorService();
	private indexRebuildTimer: number | null = null;
	private snapshotTimer: number | null = null;
	private lastSnapshotDate = "";
	private lastSnapshotAt = 0;
	private dataQueue: Promise<void> = Promise.resolve();
	private revealingInspector: Promise<void> | null = null;
	private dashboardStore: DashboardStoreData | null = null;
	private readonly dashboardCommands = new Map<
		string,
		{ name: string; command: Command }
	>();
	private dashboardCommandTimer: number | null = null;

	async onload() {
		await this.loadSettings();

		this.index = new VaultIndex(this.app, () => this.getIndexConfig());
		this.index.attach();
		this.register(() => this.index.detach());

		this.dashboardRepository = new DashboardRepository(
			{
				readData: () => this.loadData(),
				updateData: (mutate) => this.updateData(mutate),
			},
			{
				defaultDashboardName: () =>
					t("DASHBOARD_DEFAULT_NAME", ["1"]),
			},
		);
		this.dashboardStore = (await this.dashboardRepository.load()).store;
		this.syncDashboardCommands();
		this.register(
			this.dashboardRepository.onChange((store) => {
				this.dashboardStore = store;
				this.scheduleDashboardCommandSync();
			}),
		);
		this.snapshotStore = new SnapshotStore({
			adapter: this.app.vault.adapter,
			dir:
				this.manifest.dir ??
				`${this.app.vault.configDir}/plugins/ioto-dashboard`,
			deviceId: this.getDeviceId(),
		});

		this.registerView(
			CUSTOM_DASHBOARD_VIEW_TYPE,
			(leaf) => new CustomDashboardView(leaf, this),
		);
		this.registerView(
			CUSTOM_INSPECTOR_VIEW_TYPE,
			(leaf) => new CustomInspectorView(leaf, this),
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				// The user closed the panel: drop stale controllers.
				if (
					this.app.workspace.getLeavesOfType(
						CUSTOM_INSPECTOR_VIEW_TYPE,
					).length === 0
				) {
					this.inspectorService.clear();
				}
			}),
		);
		this.app.workspace.onLayoutReady(() =>
			this.scheduleSnapshotCollect(2000),
		);
		this.register(
			this.index.subscribe(() => this.scheduleSnapshotCollect()),
		);

		// Register View
		this.registerView(
			DASHBOARD_VIEW_TYPE,
			(leaf) => new DashboardView(leaf, this),
		);
		this.registerView(TASK_VIEW_TYPE, (leaf) => new TaskView(leaf, this));
		this.registerView(NOTE_VIEW_TYPE, (leaf) => new NoteView(leaf, this));

		this.registerHoverLinkSource(CUSTOM_DASHBOARD_VIEW_TYPE, {
			display: t("RIBBON_CUSTOM_DASHBOARD_TITLE"),
			defaultMod: true,
		});
		// MiddleSection triggers hover-link with DASHBOARD_VIEW_TYPE as source.
		this.registerHoverLinkSource(DASHBOARD_VIEW_TYPE, {
			display: t("RIBBON_ICON_TITLE"),
			defaultMod: true,
		});

		// Ribbon Icon
		this.addRibbonIcon(
			"columns-3",
			t("RIBBON_ICON_TITLE"),
			(evt: MouseEvent) => {
				void this.activateView({
					newWindow: evt.shiftKey,
					newTab: evt.altKey,
				});
			},
		);

		this.addRibbonIcon(
			"check-square",
			t("RIBBON_TASK_VIEW_TITLE"),
			(evt: MouseEvent) => {
				void this.activateTaskView({
					newWindow: evt.shiftKey,
					newTab: evt.altKey,
				});
			},
		);

		this.addRibbonIcon(
			"sticky-note",
			t("RIBBON_NOTE_VIEW_TITLE"),
			(evt: MouseEvent) => {
				void this.activateNoteView({
					newWindow: evt.shiftKey,
					newTab: evt.altKey,
				});
			},
		);

		this.addRibbonIcon(
			"layout-dashboard",
			t("RIBBON_CUSTOM_DASHBOARD_TITLE"),
			(evt: MouseEvent) => {
				void this.activateCustomDashboardView({
					newWindow: evt.shiftKey,
					newTab: evt.altKey,
				});
			},
		);

		// Command
		this.addCommand({
			// eslint-disable-next-line obsidianmd/commands/no-plugin-id-in-command-id -- 历史 ID，AGENTS.md 要求保持稳定
			id: "open-ioto-dashboard",
			name: t("COMMAND_OPEN_DASHBOARD"),
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "open-ioto-task-view",
			name: t("COMMAND_OPEN_TASK_VIEW"),
			callback: () => {
				void this.activateTaskView();
			},
		});

		this.addCommand({
			id: "open-ioto-note-view",
			name: t("COMMAND_OPEN_NOTE_VIEW"),
			callback: () => {
				void this.activateNoteView();
			},
		});

		this.addCommand({
			id: "open-ioto-custom-dashboard",
			name: t("COMMAND_OPEN_CUSTOM_DASHBOARD"),
			callback: () => {
				void this.activateCustomDashboardView();
			},
		});

		this.addCommand({
			id: "open-ioto-canvas-picker",
			name: t("COMMAND_OPEN_DASHBOARD_PICKER"),
			callback: () => {
				this.openDashboardPicker();
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

		this.addCommand({
			id: "duplicate-ioto-canvas-component",
			name: t("DASHBOARD_DUPLICATE_COMPONENT"),
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(
					CustomDashboardView,
				);
				if (!view?.canDuplicateSelected()) return false;
				if (!checking) void view.duplicateSelectedComponent();
				return true;
			},
		});

		// Settings Tab
		this.addSettingTab(new DashboardSettingTab(this.app, this));
	}

	onunload() {
		if (this.dashboardCommandTimer !== null) {
			window.clearTimeout(this.dashboardCommandTimer);
			this.dashboardCommandTimer = null;
		}
		restoreMacWindowButtons();
		window.activeDocument
			.querySelectorAll(".ioto-dashboard-modal.is-frame-buttons-hidden")
			.forEach((el) => el.classList.remove("is-frame-buttons-hidden"));
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
			void workspace.revealLeaf(leaf);
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
			void workspace.revealLeaf(leaf);
		}
	}

	async activateNoteView(
		options: { newWindow?: boolean; newTab?: boolean } = {},
	) {
		await this.activateCustomView(NOTE_VIEW_TYPE, options);
	}

	async activateCustomDashboardView(
		options: { newWindow?: boolean; newTab?: boolean } = {},
	) {
		await this.activateCustomView(CUSTOM_DASHBOARD_VIEW_TYPE, options);
	}

	/**
	 * Opens one dashboard in its own tab. A leaf already bound to it is
	 * revealed instead (across all windows); otherwise a new tab is spawned.
	 */
	async activateCustomDashboard(
		dashboardId: string,
		options: { newWindow?: boolean } = {},
	): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;

		if (options.newWindow) {
			leaf = workspace.getLeaf("window");
			await leaf.setViewState({
				type: CUSTOM_DASHBOARD_VIEW_TYPE,
				state: { dashboardId },
				active: true,
			});
		} else {
			const existing = this.findDashboardLeaf(dashboardId);
			if (existing) {
				void workspace.revealLeaf(existing);
				await this.markDashboardActive(dashboardId);
				return;
			}
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: CUSTOM_DASHBOARD_VIEW_TYPE,
				state: { dashboardId },
				active: true,
			});
		}

		if (leaf) {
			void workspace.revealLeaf(leaf);
			await this.markDashboardActive(dashboardId);
		}
	}

	isDashboardOpen(dashboardId: string): boolean {
		return this.dashboardLeaves(dashboardId).length > 0;
	}

	openDashboardCount(dashboardId: string): number {
		return this.dashboardLeaves(dashboardId).length;
	}

	/**
	 * Snapshot of leaves showing this dashboard. Call before deleting it: the
	 * repository broadcast makes bound views fall back synchronously, so the
	 * binding is gone by the time `removeDashboard` resolves.
	 */
	getDashboardLeaves(
		dashboardId: string,
		opts: { except?: WorkspaceLeaf } = {},
	): WorkspaceLeaf[] {
		return this.dashboardLeaves(dashboardId).filter(
			(leaf) => leaf !== opts.except,
		);
	}

	detachLeaves(leaves: readonly WorkspaceLeaf[]): void {
		for (const leaf of leaves) leaf.detach();
	}

	private dashboardLeaves(dashboardId: string): WorkspaceLeaf[] {
		const matches: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (
				view instanceof CustomDashboardView &&
				view.getDashboardId() === dashboardId
			) {
				matches.push(leaf);
			}
		});
		return matches;
	}

	private findDashboardLeaf(dashboardId: string): WorkspaceLeaf | null {
		return this.dashboardLeaves(dashboardId)[0] ?? null;
	}

	/** `activeDashboardId` only seeds ribbon / command entry points. */
	private async markDashboardActive(dashboardId: string): Promise<void> {
		if (this.dashboardStore?.activeDashboardId === dashboardId) return;
		await this.dashboardRepository.setActiveDashboard(dashboardId);
	}

	private openDashboardPicker(): void {
		new DashboardPickerModal(
			this.app,
			this.dashboardStore?.dashboards ?? [],
			(dashboard) => {
				void this.activateCustomDashboard(dashboard.id);
			},
		).open();
	}

	private scheduleDashboardCommandSync(): void {
		if (this.dashboardCommandTimer !== null) {
			window.clearTimeout(this.dashboardCommandTimer);
		}
		this.dashboardCommandTimer = window.setTimeout(() => {
			this.dashboardCommandTimer = null;
			this.syncDashboardCommands();
		}, 100);
	}

	/** Keeps one dedicated command per dashboard, keyed by its stable id. */
	private syncDashboardCommands(): void {
		const desired = new Map<string, { id: string; name: string }>();
		for (const dashboard of this.dashboardStore?.dashboards ?? []) {
			desired.set(dashboardCommandId(dashboard.id), {
				id: dashboard.id,
				name: t("COMMAND_OPEN_NAMED_DASHBOARD", [dashboard.name]),
			});
		}
		const commands = this.app.commands as unknown as {
			removeCommand?: (command: Command) => void;
		};
		for (const [commandId, entry] of Array.from(
			this.dashboardCommands,
		)) {
			const want = desired.get(commandId);
			if (want && want.name === entry.name) continue;
			commands.removeCommand?.(entry.command);
			this.dashboardCommands.delete(commandId);
		}
		for (const [commandId, want] of desired) {
			if (this.dashboardCommands.has(commandId)) continue;
			const command = this.addCommand({
				id: commandId,
				name: want.name,
				callback: () => {
					void this.activateCustomDashboard(want.id);
				},
			});
			this.dashboardCommands.set(commandId, {
				name: want.name,
				command,
			});
		}
	}

	/**
	 * Shows the component settings panel in the right sidebar: reuses the
	 * existing leaf when present, otherwise creates it, then reveals it so a
	 * collapsed sidebar expands and another active tab is switched away.
	 */
	async revealInspector(): Promise<void> {
		const { workspace } = this.app;
		if (this.revealingInspector) return this.revealingInspector;
		const run = (async () => {
			let leaf =
				workspace.getLeavesOfType(CUSTOM_INSPECTOR_VIEW_TYPE)[0] ?? null;
			if (!leaf) {
				leaf = await workspace.ensureSideLeaf(
					CUSTOM_INSPECTOR_VIEW_TYPE,
					"right",
					{ active: false, reveal: false },
				);
			}
			await workspace.revealLeaf(leaf);
		})();
		this.revealingInspector = run.finally(() => {
			this.revealingInspector = null;
		});
		return this.revealingInspector;
	}

	private async activateCustomView(
		viewType: string,
		options: { newWindow?: boolean; newTab?: boolean } = {},
	): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;

		if (options.newWindow) {
			leaf = workspace.getLeaf("window");
			await leaf.setViewState({ type: viewType, active: true });
		} else if (options.newTab) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: viewType, active: true });
		} else {
			const leaves = workspace.getLeavesOfType(viewType);
			if (leaves.length > 0) {
				leaf = leaves[0]!;
			} else {
				leaf = workspace.getLeaf(false);
				await leaf.setViewState({ type: viewType, active: true });
			}
		}

		if (leaf) {
			void workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		const loadedData = (await this.loadData()) as Record<
			string,
			unknown
		> | null;
		const settings: IotoDashboardSettings = { ...DEFAULT_SETTINGS };
		if (loadedData) {
			for (const key of Object.keys(
				DEFAULT_SETTINGS,
			) as Array<keyof IotoDashboardSettings>) {
				if (loadedData[key] !== undefined) {
					(settings as unknown as Record<string, unknown>)[key] =
						loadedData[key];
				}
			}
			settings.modalLayout =
				settings.modalLayout === "card" ? "card" : "list";
		} else {
			// No data.json yet: let each modal apply its own default layout.
			delete settings.modalLayout;
		}
		this.settings = settings;

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
		await this.updateData((data) => {
			data.inputFolder = this.settings.inputFolder;
			data.outputFolder = this.settings.outputFolder;
			data.taskFolder = this.settings.taskFolder;
			data.outcomeFolder = this.settings.outcomeFolder;
			data.pageSize = this.settings.pageSize;
			data.savedQueries = this.settings.savedQueries;
			data.customFilters = this.settings.customFilters;
			data.modalLayout = this.settings.modalLayout;
			data.inspectorHost = this.settings.inspectorHost;
		});
		this.scheduleIndexRebuild();
	}

	/**
	 * Serialised read-modify-write of `data.json`. Settings, dashboard store and
	 * any future namespace all go through this queue so none overwrites another.
	 */
	async updateData(
		mutate: (data: Record<string, unknown>) => void,
	): Promise<void> {
		const run = this.dataQueue.then(async () => {
			const data = ((await this.loadData()) ?? {}) as Record<
				string,
				unknown
			>;
			mutate(data);
			await this.saveData(data);
		});
		this.dataQueue = run.catch((error: unknown) => {
			console.warn("IOTO Dashboard: failed to update data.json", error);
		});
		return run;
	}

	getSectionHeadings(): SectionHeadings {
		const iotoSettings = new IotoSettingsService(this.app).getSettings();
		return {
			task: splitHeadingList(
				iotoSettings?.aiTaskSectionHeadings,
				t("TDL_TASK_HEADING"),
			),
			input: splitHeadingList(
				iotoSettings?.LTDListInputSectionHeading,
				t("TDL_INPUT_HEADING"),
			),
			output: splitHeadingList(
				iotoSettings?.LTDListOutputSectionHeading,
				t("TDL_OUTPUT_HEADING"),
			),
			outcome: splitHeadingList(
				iotoSettings?.LTDListOutcomeSectionHeading,
				t("TDL_OUTCOME_HEADING"),
			),
			goal: splitHeadingList(
				iotoSettings?.aiGoalSectionHeadings,
				t("TDL_GOAL_HEADING"),
			),
			review: [
				...splitHeadingList(
					iotoSettings?.aiReviewSectionHeadings,
					t("TDL_REVIEW_HEADING"),
				),
				"复盘",
				"Review",
			],
		};
	}

	getIndexConfig(): IndexConfig {
		return {
			inputFolder: this.settings.inputFolder,
			outputFolder: this.settings.outputFolder,
			taskFolder: this.settings.taskFolder,
			outcomeFolder: this.settings.outcomeFolder,
			headings: this.getSectionHeadings(),
		};
	}

	/** Folder/heading settings changed: rebuild the index after typing settles. */
	scheduleIndexRebuild() {
		if (this.indexRebuildTimer !== null) {
			window.clearTimeout(this.indexRebuildTimer);
		}
		this.indexRebuildTimer = window.setTimeout(() => {
			this.indexRebuildTimer = null;
			this.index?.rebuild();
		}, 600);
	}

	private getDeviceId(): string {
		const key = "ioto-dashboard:device-id";
		try {
			const existing = window.localStorage.getItem(key);
			if (existing) return existing;
			const id = `dev-${Date.now().toString(36)}-${Math.random()
				.toString(36)
				.slice(2, 8)}`;
			window.localStorage.setItem(key, id);
			return id;
		} catch {
			return "dev-local";
		}
	}

	private scheduleSnapshotCollect(delay = 5000): void {
		if (this.snapshotTimer !== null) {
			window.clearTimeout(this.snapshotTimer);
		}
		this.snapshotTimer = window.setTimeout(() => {
			this.snapshotTimer = null;
			void this.collectSnapshot();
		}, delay);
	}

	private async collectSnapshot(): Promise<void> {
		if (!this.snapshotStore) return;
		const now = Date.now();
		const today = localDate(now);
		if (
			today === this.lastSnapshotDate &&
			now - this.lastSnapshotAt < 30 * 60 * 1000
		) {
			return;
		}
		this.lastSnapshotDate = today;
		this.lastSnapshotAt = now;
		try {
			const snapshot = await this.index.getSnapshot();
			await collectDailySnapshot(
				snapshot,
				this.getIndexConfig(),
				this.snapshotStore,
				now,
			);
		} catch (error) {
			console.warn("IOTO Dashboard: daily snapshot failed", error);
		}
	}
}
