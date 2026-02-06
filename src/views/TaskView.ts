import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	TFolder,
	Notice,
	debounce,
	TAbstractFile,
} from "obsidian";
import { TASK_VIEW_TYPE } from "../models/constants";
import IotoDashboardPlugin from "../main";
import { t } from "../lang/helpers";
import { SaveQueryModal } from "../ui/SaveQueryModal";
import { ConfirmModal } from "../ui/ConfirmModal";
import { SavedQuery } from "../settings";
import {
	Category,
	FilterState,
	TaskItem,
	SortOption,
	SortOrder,
	GroupOption,
} from "../models/types";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { MiddleSection } from "./components/MiddleSection";
import { IotoSettingsService } from "../services/ioto-settings-services";

export class TaskView extends ItemView {
	plugin: IotoDashboardPlugin;
	activeCategory: Category = "Tasks";
	activeTab: "Notes" | "Tasks" = "Tasks";
	activeQueryId: string | null = null;
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
	tasks: TaskItem[] = [];
	filteredTasks: TaskItem[] = [];

	// Pagination
	noteCurrentPage = 1;
	taskCurrentPage = 1;

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
		taskType: [], // Default to all (empty)
		custom: {},
	};

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;
	middleSection: MiddleSection | null = null;

	// Caches
	projectCache: string[] | null = null;
	statusCache: string[] | null = null;

	// Debounced refresh for file changes
	requestRefresh = debounce(
		async (file: TFile, isTaskFile: boolean) => {
			// Invalidate caches
			this.projectCache = null;
			this.statusCache = null;

			if (isTaskFile) {
				await this.updateTasksForFile(file);
			}
			this.applyFilters(false);
			this.renderMiddleColumn();
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

			this.applyFilters(false);
			this.renderMiddleColumn();
		},
		500,
		true,
	);

	constructor(leaf: WorkspaceLeaf, plugin: IotoDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return TASK_VIEW_TYPE;
	}

	getDisplayText() {
		return t("NAV_TASKS");
	}

	getIcon() {
		return "check-square";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass("ioto-dashboard-view"); // Reuse style
		// Allow container to receive focus for keyboard events
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
			this.app.metadataCache.on("changed", this.onFileChange.bind(this)),
		);
		this.registerEvent(
			this.app.vault.on("delete", this.onFileDelete.bind(this)),
		);
	}

	async onClose() {
		if (this.middleSection) {
			this.middleSection.unload();
		}
	}

	toggleQuickSearch() {
		this.isQuickSearchVisible = !this.isQuickSearchVisible;
		this.renderMiddleColumn();
	}

	async refreshFiles() {
		// 1. Fetch Notes (Skipped for TaskView, or we can fetch them if needed but we don't show them)
		// To be safe, let's just set empty.
		this.files = [];

		// 2. Fetch Tasks
		await this.fetchTasks();

		// 3. Apply Filters
		this.applyFilters();
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
		// Only scan task folder? Or all files?
		// Usually projects are global. Let's scan all markdown files like DashboardView does.
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
		// Used for Notes, but we don't show notes. Return empty or scan if we want consistency.
		return [];
	}

	async fetchTasks() {
		this.tasks = [];
		const taskFolderPath = this.plugin.settings.taskFolder;
		const taskFolder = this.app.vault.getAbstractFileByPath(taskFolderPath);

		if (!taskFolder || !(taskFolder instanceof TFolder)) {
			return;
		}

		const files = this.getAllFiles(taskFolder);
		const results = await Promise.all(
			files.map((f) => this.getTasksFromFile(f)),
		);
		this.tasks = results.flat();
	}

	async getTasksFromFile(file: TFile): Promise<TaskItem[]> {
		const tasks: TaskItem[] = [];
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache || !cache.headings) return tasks;

		const headings = cache.headings;
		const iotoServices = new IotoSettingsService(this.app);
		const iotoSettings = iotoServices.getSettings();

		const headersToScan = [
			{
				type: "Input" as const,
				text:
					iotoSettings?.LTDListInputSectionHeading ||
					t("TDL_INPUT_HEADING"),
			},
			{
				type: "Output" as const,
				text:
					iotoSettings?.LTDListOutputSectionHeading ||
					t("TDL_OUTPUT_HEADING"),
			},
			{
				type: "Outcome" as const,
				text:
					iotoSettings?.LTDListOutcomeSectionHeading ||
					t("TDL_OUTCOME_HEADING"),
			},
		];

		// We need to fetch tasks for ALL these headers.
		// Optimized approach: find all relevant headers and their ranges.

		if (relevantItems(cache.listItems).length === 0) return tasks;
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");

		for (const headerConfig of headersToScan) {
			const headingIndex = headings.findIndex(
				(h) => h.heading === headerConfig.text,
			);
			if (headingIndex === -1) continue;

			const targetHeading = headings[headingIndex];
			if (!targetHeading) continue;
			const startLine = targetHeading.position.start.line;

			// Find end line
			let endLine = Infinity;
			for (let i = headingIndex + 1; i < headings.length; i++) {
				const h = headings[i];
				if (h && h.level <= targetHeading.level) {
					endLine = h.position.start.line;
					break;
				}
			}

			const items = (cache.listItems || []).filter(
				(item) =>
					item.position.start.line > startLine &&
					item.position.start.line < endLine &&
					item.task !== undefined,
			);

			for (const item of items) {
				let text = lines[item.position.start.line];
				if (text === undefined) continue;

				// Strip checkbox pattern like "- [ ] " or "* [x] "
				text = text.replace(/^(\s*)[-*+]\s*\[.\]\s*/, "");

				if (!text.trim()) continue;

				tasks.push({
					file: file,
					content: text,
					status: item.task!,
					line: item.position.start.line,
					type: headerConfig.type,
				});
			}
		}

		return tasks;
	}

	async updateTasksForFile(file: TFile) {
		// Remove existing tasks for this file
		this.tasks = this.tasks.filter((t) => t.file.path !== file.path);

		// Fetch new tasks
		const newTasks = await this.getTasksFromFile(file);

		// Add new tasks
		this.tasks.push(...newTasks);
	}

	applyFilters(resetPage = true) {
		if (resetPage) {
			this.taskCurrentPage = 1;
		}

		// Filter Files - Not used in TaskView but needed for consistency if accessed
		this.filteredFiles = [];

		// Filter Tasks
		this.filteredTasks = this.tasks.filter((task) => {
			if (!this.matchesFilter(task.file, task.content, false))
				return false;

			// Status Filter
			if (this.filters.status !== "all") {
				const isCompleted = task.status !== " ";
				if (this.filters.status === "completed" && !isCompleted)
					return false;
				if (this.filters.status === "incomplete" && isCompleted)
					return false;
			}

			// Task Type Filter
			if (
				this.filters.taskType &&
				this.filters.taskType.length > 0 &&
				task.type
			) {
				if (!this.filters.taskType.includes(task.type)) return false;
			}

			return true;
		});
		this.sortTasks(this.filteredTasks);
	}

	sortTasks(tasks: TaskItem[]) {
		tasks.sort((a, b) => {
			let result = 0;
			if (this.sortOption === "modified") {
				result = a.file.stat.mtime - b.file.stat.mtime;
			} else if (this.sortOption === "created") {
				result = a.file.stat.ctime - b.file.stat.ctime;
			} else if (this.sortOption === "name") {
				result = a.file.basename.localeCompare(b.file.basename);
			} else if (this.sortOption === "size") {
				result = a.file.stat.size - b.file.stat.size;
			}
			return this.sortOrder === "asc" ? result : -result;
		});
	}

	matchesFilter(
		file: TFile,
		textContent: string,
		includeFileStatus: boolean = true,
	): boolean {
		// 1. Name Filter
		if (
			this.filters.name &&
			!textContent.toLowerCase().includes(this.filters.name.toLowerCase())
		) {
			return false;
		}

		// 2. Project Filter
		if (this.filters.project) {
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];
			if (
				!project ||
				!String(project)
					.toLowerCase()
					.includes(this.filters.project.toLowerCase())
			) {
				return false;
			}
		}

		// 3. Date Filter
		const dateValue =
			this.filters.dateType === "created"
				? file.stat.ctime
				: file.stat.mtime;
		const date = new Date(dateValue);

		if (
			this.filters.datePreset !== "all" &&
			this.filters.datePreset !== "custom"
		) {
			const now = new Date();
			let days = 0;
			if (this.filters.datePreset === "last3days") days = 3;
			else if (this.filters.datePreset === "last1day") days = 1;
			else if (this.filters.datePreset === "last7days") days = 7;
			else if (this.filters.datePreset === "last14days") days = 14;
			else if (this.filters.datePreset === "last30days") days = 30;

			const startDate = new Date();
			startDate.setDate(now.getDate() - days);
			startDate.setHours(0, 0, 0, 0);

			if (date < startDate) return false;
		} else if (this.filters.datePreset === "custom") {
			if (this.filters.dateStart) {
				const startDate = new Date(this.filters.dateStart);
				if (date < startDate) return false;
			}

			if (this.filters.dateEnd) {
				const endDate = new Date(this.filters.dateEnd);
				endDate.setHours(23, 59, 59, 999);
				if (date > endDate) return false;
			}
		}

		// 4. Custom Filters
		if (
			this.plugin.settings.customFilters &&
			this.plugin.settings.customFilters.length > 0 &&
			this.filters.custom
		) {
			const cache = this.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;

			for (const filter of this.plugin.settings.customFilters) {
				const filterValue = this.filters.custom[filter.name];
				if (
					filterValue === undefined ||
					filterValue === "" ||
					filterValue === "all"
				)
					continue;

				const fileValue = frontmatter
					? frontmatter[filter.name]
					: undefined;

				if (filter.type === "text" || filter.type === "list") {
					if (!fileValue) return false;
					const fileValStr = String(fileValue).toLowerCase();
					const filterValStr = String(filterValue).toLowerCase();
					if (!fileValStr.includes(filterValStr)) return false;
				} else if (filter.type === "number") {
					if (fileValue === undefined) return false;
					if (Number(fileValue) !== Number(filterValue)) return false;
				} else if (filter.type === "boolean") {
					const boolFilter = filterValue === "true";
					const boolFileValue =
						fileValue === true ||
						fileValue === "true" ||
						fileValue === "True";
					if (boolFileValue !== boolFilter) return false;
				} else if (filter.type === "date") {
					if (!fileValue) return false;
					if (String(fileValue) !== String(filterValue)) return false;
				}
			}
		}

		return true;
	}

	renderLeftColumn(container: HTMLElement) {
		new LeftSidebar(
			container,
			this.activeCategory,
			this.activeQueryId,
			this.leftPanelCollapsed,
			this.plugin.settings.savedQueries,
			async (category) => {
				// Should not happen as we only have "Tasks"
				this.activeCategory = category;
				this.activeQueryId = null;
				this.renderLeftColumn(container);
				await this.refreshFiles();
				this.renderMiddleColumn();
				this.renderRightColumn();
			},
			async (query) => {
				this.loadSavedQuery(query);
			},
			["Tasks"], // ONLY Tasks
		).render();
	}

	async loadSavedQuery(query: SavedQuery) {
		this.activeQueryId = query.id;
		this.activeCategory = query.category; // Should be Tasks
		this.activeTab = "Tasks"; // Force Tasks
		this.filters = JSON.parse(JSON.stringify(query.filters));

		await this.refreshFiles();
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
	}

	renderMiddleColumn() {
		let activeQueryName: string | null = null;
		if (this.activeQueryId) {
			const query = this.plugin.settings.savedQueries.find(
				(q) => q.id === this.activeQueryId,
			);
			if (query) {
				activeQueryName = query.name;
			}
		}

		if (this.middleSection) {
			// Clean up previous instance
			// Component.removeChild logic:
			// this.removeChild(this.middleSection);
			// But MiddleSection is a Component, added via addChild.
			// We should unload it or remove it.
			// DashboardView uses this.removeChild(this.middleSection).
			// But super.removeChild(component) removes it from internal children array.
			// It doesn't necessarily remove DOM.
			// DashboardView clears container via this.middleContainer.empty() or similar?
			// DashboardView calls `this.removeChild(this.middleSection)`.
			// Let's check DashboardView.ts again.
			// It says:
			// if (this.middleSection) {
			// 	this.removeChild(this.middleSection);
			// }
			// And `MiddleSection.render` clears the container `this.container.empty()`.
			// So yes.
			this.removeChild(this.middleSection);
		}

		const pageSize = this.plugin.settings.pageSize;
		const totalTasks = this.filteredTasks.length;

		const maxTaskPage = Math.max(1, Math.ceil(totalTasks / pageSize));

		if (this.taskCurrentPage > maxTaskPage)
			this.taskCurrentPage = maxTaskPage;

		const taskStart = (this.taskCurrentPage - 1) * pageSize;
		const taskEnd = taskStart + pageSize;
		const paginatedTasks = this.filteredTasks.slice(taskStart, taskEnd);

		this.middleSection = new MiddleSection(
			this.app,
			this.middleContainer,
			this.activeCategory,
			"Tasks", // Always Tasks
			this.activeQueryId,
			activeQueryName,
			[], // No files
			paginatedTasks,
			this.isZenMode,
			this.sortOption,
			this.sortOrder,
			this.groupOption,
			(tab: "Notes" | "Tasks") => {
				// Should not switch
			},
			(option: SortOption, order: SortOrder) => {
				this.sortOption = option;
				this.sortOrder = order;
				this.applyFilters();
				this.renderMiddleColumn();
			},
			(option: GroupOption) => {
				this.groupOption = option;
				this.renderMiddleColumn();
			},
			(id: string) => {
				this.renameSavedQuery(id);
			},
			(id: string) => {
				new ConfirmModal(
					this.app,
					t("CONFIRM_DELETE_TITLE"),
					t("CONFIRM_DELETE_MSG"),
					async () => {
						await this.deleteSavedQuery(id);
					},
				).open();
			},
			async (task: TaskItem) => {
				await this.toggleTaskStatus(task);
			},
			async (task: TaskItem) => {
				await this.deleteTask(task);
			},
			() => {
				this.toggleZenMode();
			},
			this.isQuickSearchVisible,
			this.filters.name,
			(val: string) => {
				this.filters.name = val;
				this.applyFilters(true);
				this.renderMiddleColumn();
				this.renderRightColumn();
			},
			() => {
				this.toggleQuickSearch();
			},
			{
				currentPage: this.taskCurrentPage,
				totalPages: maxTaskPage,
				totalItems: totalTasks,
				pageSize: pageSize,
				onPageChange: (page: number) => {
					this.taskCurrentPage = page;
					this.renderMiddleColumn();
				},
			},
			true, // Hide Tabs
		);
		this.addChild(this.middleSection);
		this.middleSection.render();
	}

	toggleZenMode() {
		this.isZenMode = !this.isZenMode;
		const grid = this.contentEl.querySelector(".dashboard-grid");
		if (grid) {
			if (this.isZenMode) {
				grid.addClass("zen-mode");
			} else {
				grid.removeClass("zen-mode");
			}
		}
		this.renderMiddleColumn();
	}

	async deleteTask(task: TaskItem) {
		new ConfirmModal(
			this.app,
			t("CONFIRM_DELETE_TASK_TITLE"),
			t("CONFIRM_DELETE_TASK_MSG"),
			async () => {
				const file = task.file;
				const content = await this.app.vault.read(file);
				const lines = content.split("\n");

				if (task.line >= lines.length) return;

				// Remove the line
				lines.splice(task.line, 1);

				await this.app.vault.modify(file, lines.join("\n"));
				new Notice(t("TASK_DELETED"));

				// Refresh UI
				await this.refreshFiles();
				this.renderMiddleColumn();
			},
		).open();
	}

	async toggleTaskStatus(task: TaskItem) {
		const file = task.file;
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");

		if (task.line >= lines.length) return;

		const lineContent = lines[task.line];
		if (!lineContent) return;

		// Regex to match task: - [ ] content
		const taskRegex = /^(\s*[-*]\s*\[)(.)(\]\s*.*)$/;
		const match = lineContent.match(taskRegex);

		if (match) {
			const prefix = match[1];
			const currentStatus = match[2];
			const suffix = match[3];

			const newStatus = currentStatus === " " ? "x" : " ";
			lines[task.line] = `${prefix}${newStatus}${suffix}`;

			await this.app.vault.modify(file, lines.join("\n"));

			// Update local state and UI
			task.status = newStatus;

			this.applyFilters();
			this.renderMiddleColumn();
		}
	}

	renderRightColumn() {
		new RightSidebar(
			this.rightContainer,
			this.filters,
			"Tasks", // Always Tasks
			this.activeQueryId,
			this.getAllProjects(),
			this.getAllStatuses(),
			this.plugin.settings.customFilters,
			(newFilters, shouldReRender) => {
				this.filters = newFilters;
				this.applyFilters(shouldReRender);
				this.renderMiddleColumn();
				// If we need to re-render right column (e.g. state dependent UI), do it.
				// But debounce input handling in RightSidebar handles its own rendering?
				// RightSidebar renders itself once.
				// If we want to persist filter state visual, we might not need to re-render RightSidebar
				// unless the structure changes.
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
					custom: {},
				};
				this.applyFilters(true);
				this.renderMiddleColumn();
				this.renderRightColumn();
			},
			() => {
				new SaveQueryModal(
					this.app,
					t("MODAL_SAVE_TITLE"),
					"",
					(name) => {
						this.saveQuery(name);
					},
				).open();
			},
			() => {
				if (this.activeQueryId) {
					this.updateQuery(this.activeQueryId);
				}
			},
			true, // Show Task Type Filter
		).render();
	}

	async saveQuery(name: string) {
		const newQuery: SavedQuery = {
			id: Date.now().toString(),
			name: name,
			category: this.activeCategory,
			tab: "Tasks",
			filters: JSON.parse(JSON.stringify(this.filters)),
		};
		this.plugin.settings.savedQueries.push(newQuery);
		await this.plugin.saveSettings();
		this.activeQueryId = newQuery.id;

		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
	}

	async updateQuery(id: string) {
		const queryIndex = this.plugin.settings.savedQueries.findIndex(
			(q) => q.id === id,
		);
		if (
			queryIndex !== -1 &&
			this.plugin.settings.savedQueries[queryIndex]
		) {
			this.plugin.settings.savedQueries[queryIndex].filters = JSON.parse(
				JSON.stringify(this.filters),
			);
			await this.plugin.saveSettings();
			new Notice("Query updated");
		}
	}

	async renameSavedQuery(id: string) {
		const query = this.plugin.settings.savedQueries.find(
			(q) => q.id === id,
		);
		if (!query) return;

		new SaveQueryModal(
			this.app,
			t("MODAL_EDIT_TITLE"),
			query.name,
			async (newName) => {
				query.name = newName;
				await this.plugin.saveSettings();
				this.renderLeftColumn(
					this.contentEl.querySelector(
						".dashboard-left",
					) as HTMLElement,
				);
				this.renderMiddleColumn();
			},
		).open();
	}

	async deleteSavedQuery(id: string) {
		this.plugin.settings.savedQueries =
			this.plugin.settings.savedQueries.filter((q) => q.id !== id);
		await this.plugin.saveSettings();

		if (this.activeQueryId === id) {
			this.activeQueryId = null;
			// Reset filters? Or keep them? Usually reset or keep current state.
			// DashboardView keeps current state but removes active ID.
		}

		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
	}

	onFileChange(file: TFile) {
		const taskFolderPath = this.plugin.settings.taskFolder;
		if (file.path.startsWith(taskFolderPath)) {
			this.requestRefresh(file, true);
		}
	}

	onFileDelete(file: TAbstractFile) {
		if (file instanceof TFile) {
			this.debouncedDeleteRefresh();
		}
	}
}

function relevantItems(
	listItems: import("obsidian").ListItemCache[] | undefined,
) {
	return listItems || [];
}
