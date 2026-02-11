import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	TFolder,
	debounce,
	Notice,
} from "obsidian";
import { NOTE_VIEW_TYPE } from "../models/constants";
import IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { SavedQuery } from "../settings";
import {
	Category,
	FilterState,
	TaskItem,
	SortOption,
	SortOrder,
	GroupOption,
	PaginationInfo,
} from "../models/types";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { MiddleSection } from "./components/MiddleSection";
import { SaveQueryModal } from "../ui/SaveQueryModal";
import { ConfirmModal } from "../ui/ConfirmModal";

export class NoteView extends ItemView {
	plugin: IotoDashboardPlugin;
	activeCategory: Category = "Notes";
	activeTab: "Notes" | "Tasks" = "Notes";
	activeQueryId: string | null = null;
	activeQueryName: string | null = null;
	sortOption: SortOption = "modified";
	sortOrder: SortOrder = "desc";
	groupOption: GroupOption = "type";
	leftPanelCollapsed = false;
	rightPanelCollapsed = false;
	isZenMode = false;
	isQuickSearchVisible = false;

	// Data
	files: TFile[] = [];
	filteredFiles: TFile[] = [];
	tasks: TaskItem[] = []; // Empty
	filteredTasks: TaskItem[] = []; // Empty

	// Pagination
	pagination: PaginationInfo = {
		currentPage: 1,
		totalItems: 0,
		pageSize: 20,
		totalPages: 0,
		onPageChange: (page: number) => {
			this.pagination.currentPage = page;
			this.renderMiddleColumn();
		},
	};

	// Filters
	filters: FilterState = {
		name: "",
		project: "",
		dateType: "created",
		dateStart: "",
		dateEnd: "",
		datePreset: "all",
		status: "all",
		fileStatus: "",
		taskType: [],
		noteType: ["Input", "Output", "Outcome"], // Default to all
		custom: {},
	};

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;
	middleSection: MiddleSection | null = null;
	leftSidebar: LeftSidebar | null = null;
	rightSidebar: RightSidebar | null = null;

	// Caches
	projectCache: string[] | null = null;
	statusCache: string[] | null = null;

	// Debounced refresh for file changes
	requestRefresh = debounce(
		async (file: TFile) => {
			if (this.isFileInIOO(file)) {
				// Invalidate caches
				this.projectCache = null;
				this.statusCache = null;

				await this.refreshFiles();
				this.renderMiddleColumn();
			}
		},
		500,
		true,
	);

	// Debounced refresh for file deletion
	debouncedDeleteRefresh = debounce(
		() => {
			// Invalidate caches
			this.projectCache = null;
			this.statusCache = null;

			this.refreshFiles().then(() => {
				this.renderMiddleColumn();
			});
		},
		500,
		true,
	);

	constructor(leaf: WorkspaceLeaf, plugin: IotoDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return NOTE_VIEW_TYPE;
	}

	getDisplayText() {
		return t("NAV_NOTES");
	}

	getIcon() {
		return "sticky-note";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass("ioto-dashboard-view");
		container.setAttr("tabindex", "0");

		const grid = container.createDiv({ cls: "dashboard-grid" });
		if (this.leftPanelCollapsed) grid.addClass("usages-collapsed");
		if (this.rightPanelCollapsed) grid.addClass("right-collapsed");
		if (this.isZenMode) grid.addClass("zen-mode");

		// Left Column: Navigation
		const leftCol = grid.createDiv({ cls: "dashboard-left" });
		this.renderLeftColumn(leftCol);

		// Middle Column: Content
		this.middleContainer = grid.createDiv({ cls: "dashboard-middle" });

		// Right Column: Filters
		this.rightContainer = grid.createDiv({ cls: "dashboard-right" });

		// Initial Load
		await this.refreshFiles();
		this.renderMiddleColumn();
		this.renderRightColumn();

		// Register file change listener
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file instanceof TFile) this.requestRefresh(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && this.isFileInIOO(file)) {
					this.debouncedDeleteRefresh();
				}
			}),
		);
	}

	async onClose() {
		if (this.middleSection) {
			this.middleSection.unload();
		}
	}

	getState() {
		return {
			isZenMode: this.isZenMode,
			activeCategory: this.activeCategory,
			activeTab: this.activeTab,
			activeQueryId: this.activeQueryId,
			sortOption: this.sortOption,
			sortOrder: this.sortOrder,
			groupOption: this.groupOption,
		};
	}

	async setState(state: any, result: any) {
		if (state) {
			if (typeof state.isZenMode === "boolean") {
				this.isZenMode = state.isZenMode;
				const grid = this.contentEl.querySelector(".dashboard-grid");
				if (grid) {
					if (this.isZenMode) grid.addClass("zen-mode");
					else grid.removeClass("zen-mode");
				}
			}
			if (state.activeCategory)
				this.activeCategory = state.activeCategory;
			if (state.activeTab) this.activeTab = state.activeTab;
			if (state.activeQueryId !== undefined)
				this.activeQueryId = state.activeQueryId;
			if (state.sortOption) this.sortOption = state.sortOption;
			if (state.sortOrder) this.sortOrder = state.sortOrder;
			if (state.groupOption) this.groupOption = state.groupOption;
		}
		await super.setState(state, result);

		// Restore filters from saved query if active
		if (this.activeQueryId) {
			const query = this.plugin.settings.savedQueries.find(
				(q) => q.id === this.activeQueryId,
			);
			if (query) {
				this.filters = { ...this.filters, ...query.filters };
				this.activeQueryName = query.name;
			}
		}

		// Refresh UI
		const leftCol = this.contentEl.querySelector(".dashboard-left");
		if (leftCol) {
			await this.refreshFiles();
			this.renderLeftColumn(leftCol as HTMLElement);
			this.renderMiddleColumn();
			this.renderRightColumn();
		}
	}

	toggleQuickSearch() {
		this.isQuickSearchVisible = !this.isQuickSearchVisible;
		this.renderMiddleColumn();
	}

	isFileInIOO(file: TFile): boolean {
		const path = file.path;
		const settings = this.plugin.settings;
		return (
			path.startsWith(settings.inputFolder) ||
			path.startsWith(settings.outputFolder) ||
			path.startsWith(settings.outcomeFolder)
		);
	}

	async refreshFiles() {
		const settings = this.plugin.settings;
		const inputFiles = this.getFilesInFolder(settings.inputFolder);
		const outputFiles = this.getFilesInFolder(settings.outputFolder);
		const outcomeFiles = this.getFilesInFolder(settings.outcomeFolder);

		this.files = [...inputFiles, ...outputFiles, ...outcomeFiles];
		this.applyFilters();
	}

	getFilesInFolder(folderPath: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (folder && folder instanceof TFolder) {
			return this.getAllFiles(folder);
		}
		return [];
	}

	getAllFiles(folder: TFolder): TFile[] {
		let files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				if (child.extension === "md") {
					files.push(child);
				}
			} else if (child instanceof TFolder) {
				files.push(...this.getAllFiles(child));
			}
		}
		return files;
	}

	getAllProjects(): string[] {
		if (this.projectCache) return this.projectCache;

		const projects = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];
			if (project) {
				projects.add(String(project));
			}
		}
		this.projectCache = Array.from(projects).sort();
		return this.projectCache;
	}

	getAllStatuses(): string[] {
		if (this.statusCache) return this.statusCache;

		const statuses = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const status = cache?.frontmatter?.["Status"];
			if (status) {
				statuses.add(String(status));
			}
		}
		this.statusCache = Array.from(statuses).sort();
		return this.statusCache;
	}

	applyFilters(render = true) {
		this.filteredFiles = this.files.filter((file) => {
			// 1. Note Type Filter
			let typeMatch = false;
			const settings = this.plugin.settings;
			if (file.path.startsWith(settings.inputFolder))
				typeMatch = this.filters.noteType?.includes("Input") ?? false;
			else if (file.path.startsWith(settings.outputFolder))
				typeMatch = this.filters.noteType?.includes("Output") ?? false;
			else if (file.path.startsWith(settings.outcomeFolder))
				typeMatch = this.filters.noteType?.includes("Outcome") ?? false;

			if (!typeMatch) return false;

			// 2. Name Filter
			if (this.filters.name) {
				if (
					!file.basename
						.toLowerCase()
						.includes(this.filters.name.toLowerCase())
				)
					return false;
			}

			// 3. Custom Filters (Frontmatter)
			if (
				this.filters.custom &&
				Object.keys(this.filters.custom).length > 0
			) {
				const cache = this.app.metadataCache.getFileCache(file);
				const frontmatter = cache?.frontmatter;

				for (const [key, value] of Object.entries(
					this.filters.custom,
				)) {
					if (!value) continue;
					if (!frontmatter || !frontmatter[key]) return false;
					const valStr = String(frontmatter[key]).toLowerCase();
					if (!valStr.includes(value.toLowerCase())) return false;
				}
			}

			return true;
		});

		// Sort
		this.sortFiles(this.filteredFiles);

		// Pagination
		this.pagination.totalItems = this.filteredFiles.length;
		this.pagination.totalPages = Math.ceil(
			this.pagination.totalItems / this.pagination.pageSize,
		);

		const maxPage = this.pagination.totalPages || 1;
		if (this.pagination.currentPage > maxPage) {
			this.pagination.currentPage = 1;
		}

		if (render) this.renderMiddleColumn();
	}

	sortFiles(files: TFile[]) {
		files.sort((a, b) => {
			let result = 0;
			if (this.sortOption === "modified") {
				result = a.stat.mtime - b.stat.mtime;
			} else if (this.sortOption === "created") {
				result = a.stat.ctime - b.stat.ctime;
			} else if (this.sortOption === "name") {
				result = a.basename.localeCompare(b.basename);
			} else if (this.sortOption === "size") {
				result = a.stat.size - b.stat.size;
			}
			return this.sortOrder === "asc" ? result : -result;
		});
	}

	renderLeftColumn(container: HTMLElement) {
		this.leftSidebar = new LeftSidebar(
			container,
			this.activeCategory,
			this.activeQueryId,
			this.leftPanelCollapsed,
			this.plugin.settings.savedQueries.filter(
				(q) => q.category === "Notes" || q.type === "NoteView",
			),
			(category) => {
				if (category === "Notes") {
					this.activeCategory = category;
					this.activeQueryId = null;
					this.activeQueryName = null;
					this.filters = {
						name: "",
						project: "",
						dateType: "created",
						dateStart: "",
						dateEnd: "",
						datePreset: "all",
						status: "all",
						fileStatus: "",
						taskType: [],
						noteType: ["Input", "Output", "Outcome"],
						custom: {},
					};
					this.applyFilters();
					this.renderLeftColumn(container);
					this.renderRightColumn();
					this.app.workspace.requestSaveLayout();
				}
			},
			(query) => {
				this.loadSavedQuery(query);
			},
			["Notes"],
		);
		this.leftSidebar.render();
	}

	renderMiddleColumn() {
		if (this.middleSection) {
			this.removeChild(this.middleSection);
		}

		// Pagination Logic
		const pageSize = this.plugin.settings.pageSize;
		const totalNotes = this.filteredFiles.length;
		const maxNotePage = Math.max(1, Math.ceil(totalNotes / pageSize));

		if (this.pagination.currentPage > maxNotePage)
			this.pagination.currentPage = maxNotePage;

		const noteStart = (this.pagination.currentPage - 1) * pageSize;
		const noteEnd = noteStart + pageSize;
		const paginatedFiles = this.filteredFiles.slice(noteStart, noteEnd);

		this.middleSection = new MiddleSection(
			this.app,
			this.middleContainer,
			this.activeCategory,
			this.activeTab,
			this.activeQueryId,
			this.activeQueryName,
			paginatedFiles,
			this.filteredTasks,
			this.isZenMode,
			this.sortOption,
			this.sortOrder,
			this.groupOption,
			(tab) => {
				this.activeTab = tab;
				this.renderMiddleColumn();
				this.app.workspace.requestSaveLayout();
			},
			(option, order) => {
				this.sortOption = option;
				this.sortOrder = order;
				this.applyFilters();
				this.app.workspace.requestSaveLayout();
			},
			(option) => {
				this.groupOption = option;
				this.renderMiddleColumn();
				this.app.workspace.requestSaveLayout();
			},
			(id) => {
				// On Edit Query
				// For now, we can just open the save modal again to rename?
				// Or implementing edit name logic if needed.
				// But typically edit means changing filters and clicking update.
				// This callback seems to be for renaming.
				const query = this.plugin.settings.savedQueries.find(
					(q) => q.id === id,
				);
				if (query) {
					new SaveQueryModal(
						this.app,
						t("MODAL_SAVE_TITLE"),
						query.name,
						async (newName) => {
							query.name = newName;
							await this.plugin.saveSettings();
							this.activeQueryName = newName;
							this.renderMiddleColumn();
							const leftCol =
								this.contentEl.querySelector(".dashboard-left");
							if (leftCol instanceof HTMLElement)
								this.renderLeftColumn(leftCol);
						},
					).open();
				}
			},
			(id) => {
				this.deleteSavedQuery(id);
			},
			async () => {},
			async () => {},
			() => {
				this.isZenMode = !this.isZenMode;
				const grid = this.contentEl.querySelector(".dashboard-grid");
				if (grid) {
					if (this.isZenMode) grid.addClass("zen-mode");
					else grid.removeClass("zen-mode");
				}
				this.renderMiddleColumn();
				this.app.workspace.requestSaveLayout();
			},
			this.isQuickSearchVisible,
			this.filters.name,
			(val) => {
				this.filters.name = val;
				this.applyFilters(true);
			},
			() => {
				this.isQuickSearchVisible = false;
				this.filters.name = "";
				this.applyFilters(true);
			},
			this.pagination,
			true, // hideTabs
			{
				input: this.plugin.settings.inputFolder,
				output: this.plugin.settings.outputFolder,
				outcome: this.plugin.settings.outcomeFolder,
			},
		);
		this.addChild(this.middleSection);
		this.middleSection.render();
	}

	renderRightColumn() {
		this.rightContainer.empty();
		this.rightSidebar = new RightSidebar(
			this.rightContainer,
			this.filters,
			this.activeTab,
			this.activeQueryId,
			this.getAllProjects(), // allProjects
			this.getAllStatuses(), // allStatuses
			this.plugin.settings.customFilters,
			(filters) => {
				this.filters = filters;
				this.applyFilters();
			},
			() => {
				// Reset
				this.filters = {
					name: "",
					project: "",
					dateType: "created",
					dateStart: "",
					dateEnd: "",
					datePreset: "all",
					status: "all",
					fileStatus: "",
					taskType: [],
					noteType: ["Input", "Output", "Outcome"],
					custom: {},
				};
				this.applyFilters();
				this.renderRightColumn();
			},
			async () => {
				// On Save Query
				new SaveQueryModal(
					this.app,
					t("MODAL_SAVE_TITLE"),
					"",
					async (name) => {
						const existing = this.plugin.settings.savedQueries.find(
							(q) => q.name === name,
						);
						if (existing) {
							new Notice(t("NOTICE_QUERY_EXISTS"));
							return;
						}

						const newQuery: SavedQuery = {
							id: Date.now().toString(),
							name,
							category: "Notes",
							tab: "Notes",
							type: "NoteView",
							sortOption: this.sortOption,
							sortOrder: this.sortOrder,
							groupOption: this.groupOption,
							filters: { ...this.filters },
						};

						this.plugin.settings.savedQueries.push(newQuery);
						await this.plugin.saveSettings();

						this.loadSavedQuery(newQuery);
						new Notice(t("NOTICE_QUERY_SAVED"));
					},
				).open();
			},
			async () => {
				// On Update Query
				if (!this.activeQueryId) return;
				const queryIndex = this.plugin.settings.savedQueries.findIndex(
					(q) => q.id === this.activeQueryId,
				);
				if (queryIndex !== -1) {
					const existing =
						this.plugin.settings.savedQueries[queryIndex];
					if (!existing) return;
					this.plugin.settings.savedQueries[queryIndex] = {
						...existing,
						sortOption: this.sortOption,
						sortOrder: this.sortOrder,
						groupOption: this.groupOption,
						filters: { ...this.filters },
					};
					await this.plugin.saveSettings();
					new Notice(t("NOTICE_QUERY_UPDATED"));
				}
			},
			true, // showTaskTypeFilter (which actually controls note type filter here)
		);
		this.rightSidebar.render();
	}

	loadSavedQuery(query: SavedQuery) {
		this.activeQueryId = query.id;
		this.activeQueryName = query.name;

		const defaultFilters: FilterState = {
			name: "",
			project: "",
			dateType: "created",
			dateStart: "",
			dateEnd: "",
			datePreset: "all",
			status: "all",
			fileStatus: "",
			taskType: [],
			noteType: ["Input", "Output", "Outcome"],
			custom: {},
		};

		this.filters = {
			...defaultFilters,
			...query.filters,
		};

		this.sortOption = query.sortOption;
		this.sortOrder = query.sortOrder;
		this.groupOption = query.groupOption;

		this.applyFilters();
		const leftCol = this.contentEl.querySelector(".dashboard-left");
		if (leftCol instanceof HTMLElement) {
			this.renderLeftColumn(leftCol);
		}
		this.renderRightColumn();
		this.app.workspace.requestSaveLayout();
	}

	async deleteSavedQuery(id: string) {
		new ConfirmModal(
			this.app,
			t("MODAL_DELETE_QUERY_TITLE"),
			t("MODAL_DELETE_QUERY_MESSAGE"),
			async () => {
				const newQueries = this.plugin.settings.savedQueries.filter(
					(q) => q.id !== id,
				);
				this.plugin.settings.savedQueries = newQueries;
				await this.plugin.saveSettings();

				if (this.activeQueryId === id) {
					this.activeQueryId = null;
					this.activeQueryName = null;
					// Reset filters to default when deleting active query
					this.filters = {
						name: "",
						project: "",
						dateType: "created",
						dateStart: "",
						dateEnd: "",
						datePreset: "all",
						status: "all",
						fileStatus: "",
						taskType: [],
						noteType: ["Input", "Output", "Outcome"],
						custom: {},
					};
					this.applyFilters();
					this.renderRightColumn();
				}

				const leftCol = this.contentEl.querySelector(".dashboard-left");
				if (leftCol instanceof HTMLElement) {
					this.renderLeftColumn(leftCol);
				}
				new Notice(t("NOTICE_QUERY_DELETED"));
				this.app.workspace.requestSaveLayout();
			},
		).open();
	}
}
