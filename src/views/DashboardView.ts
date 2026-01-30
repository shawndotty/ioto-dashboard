import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	TFolder,
	Notice,
	debounce,
	TAbstractFile,
} from "obsidian";
import { DASHBOARD_VIEW_TYPE } from "../models/constants";
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

export class DashboardView extends ItemView {
	plugin: IotoDashboardPlugin;
	activeCategory: Category = "Input";
	activeTab: "Notes" | "Tasks" = "Notes";
	activeQueryId: string | null = null;
	sortOption: SortOption = "modified";
	sortOrder: SortOrder = "desc";
	groupOption: GroupOption = "none";
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
	};

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;
	middleSection: MiddleSection | null = null;

	// Debounced refresh for file changes
	requestRefresh = debounce(
		async (file: TFile, isTaskFile: boolean) => {
			if (isTaskFile) {
				await this.updateTasksForFile(file);
			}
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
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText() {
		return t("DASHBOARD_TITLE");
	}

	getIcon() {
		return "columns-3";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass("ioto-dashboard-view");
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
		// 1. Fetch Notes
		let folderPath = "";
		switch (this.activeCategory) {
			case "Input":
				folderPath = this.plugin.settings.inputFolder;
				break;
			case "Output":
				folderPath = this.plugin.settings.outputFolder;
				break;
			case "Outcome":
				folderPath = this.plugin.settings.outcomeFolder;
				break;
		}

		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (folder && folder instanceof TFolder) {
			this.files = this.getAllFiles(folder);
		} else {
			this.files = [];
		}

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
		const projects = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];
			if (project) {
				projects.add(String(project));
			}
		}
		return Array.from(projects).sort();
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
		const targetHeader = this.getTargetHeader(this.activeCategory);

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache || !cache.headings) return tasks;

		const headings = cache.headings;

		// Find the target header
		const headingIndex = headings.findIndex(
			(h) => h.heading === targetHeader,
		);
		if (headingIndex === -1) return tasks;

		const targetHeading = headings[headingIndex];
		if (!targetHeading) return tasks;

		const startLine = targetHeading.position.start.line;

		// Find end line
		let endLine = Infinity;
		for (let i = headingIndex + 1; i < headings.length; i++) {
			const h = headings[i];
			if (!h) continue;
			if (h.level <= targetHeading.level) {
				endLine = h.position.start.line;
				break;
			}
		}

		// Get list items in range
		if (!cache.listItems) return tasks;
		const relevantItems = cache.listItems.filter(
			(item) =>
				item.position.start.line > startLine &&
				item.position.start.line < endLine &&
				item.task !== undefined,
		);

		if (relevantItems.length > 0) {
			// Read file content
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split("\n");

			for (const item of relevantItems) {
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

	getTargetHeader(category: Category): string {
		const iotoServices = new IotoSettingsService(this.app);
		const iotoSettings = iotoServices.getSettings();
		switch (category) {
			case "Input":
				return (
					iotoSettings?.LTDListInputSectionHeading ||
					t("TDL_INPUT_HEADING")
				);
			case "Output":
				return (
					iotoSettings?.LTDListOutputSectionHeading ||
					t("TDL_OUTPUT_HEADING")
				);
			case "Outcome":
				return (
					iotoSettings?.LTDListOutcomeSectionHeading ||
					t("TDL_OUTCOME_HEADING")
				);
		}
	}

	applyFilters(resetPage = true) {
		if (resetPage) {
			this.noteCurrentPage = 1;
			this.taskCurrentPage = 1;
		}

		// Filter Files
		this.filteredFiles = this.files.filter((file) => {
			return this.matchesFilter(file, file.basename);
		});
		this.sortFiles(this.filteredFiles);

		// Filter Tasks
		this.filteredTasks = this.tasks.filter((task) => {
			if (!this.matchesFilter(task.file, task.content)) return false;

			// Status Filter
			if (this.filters.status !== "all") {
				const isCompleted = task.status !== " ";
				if (this.filters.status === "completed" && !isCompleted)
					return false;
				if (this.filters.status === "incomplete" && isCompleted)
					return false;
			}

			return true;
		});
		this.sortTasks(this.filteredTasks);
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
				// Sort by task file size
				result = a.file.stat.size - b.file.stat.size;
			}
			return this.sortOrder === "asc" ? result : -result;
		});
	}

	matchesFilter(file: TFile, textContent: string): boolean {
		// 1. Name Filter (applies to File Name or Task Content)
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
				this.activeCategory = category;
				this.activeQueryId = null; // Reset active query when switching main category
				// Update active class manually or re-render?
				// renderLeftColumn re-renders the whole list, so it handles active class.
				this.renderLeftColumn(container);

				await this.refreshFiles();
				this.renderMiddleColumn();
				this.renderRightColumn();
			},
			async (query) => {
				this.loadSavedQuery(query);
			},
		).render();
	}

	async loadSavedQuery(query: SavedQuery) {
		this.activeQueryId = query.id;
		this.activeCategory = query.category;
		this.activeTab = query.tab;
		// Clone filters to avoid reference issues
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
			this.removeChild(this.middleSection);
		}

		// Pagination Logic
		const pageSize = this.plugin.settings.pageSize;
		const totalNotes = this.filteredFiles.length;
		const totalTasks = this.filteredTasks.length;

		// Clamp pages
		const maxNotePage = Math.max(1, Math.ceil(totalNotes / pageSize));
		const maxTaskPage = Math.max(1, Math.ceil(totalTasks / pageSize));

		if (this.noteCurrentPage > maxNotePage)
			this.noteCurrentPage = maxNotePage;
		if (this.taskCurrentPage > maxTaskPage)
			this.taskCurrentPage = maxTaskPage;

		const noteStart = (this.noteCurrentPage - 1) * pageSize;
		const noteEnd = noteStart + pageSize;
		const paginatedFiles = this.filteredFiles.slice(noteStart, noteEnd);

		const taskStart = (this.taskCurrentPage - 1) * pageSize;
		const taskEnd = taskStart + pageSize;
		const paginatedTasks = this.filteredTasks.slice(taskStart, taskEnd);

		this.middleSection = new MiddleSection(
			this.app,
			this.middleContainer,
			this.activeCategory,
			this.activeTab,
			this.activeQueryId,
			activeQueryName,
			paginatedFiles,
			paginatedTasks,
			this.isZenMode,
			this.sortOption,
			this.sortOrder,
			this.groupOption,
			(tab: "Notes" | "Tasks") => {
				this.activeTab = tab;
				this.renderMiddleColumn();
				this.renderRightColumn();
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
				currentPage:
					this.activeTab === "Notes"
						? this.noteCurrentPage
						: this.taskCurrentPage,
				totalPages:
					this.activeTab === "Notes" ? maxNotePage : maxTaskPage,
				totalItems:
					this.activeTab === "Notes" ? totalNotes : totalTasks,
				pageSize: pageSize,
				onPageChange: (page: number) => {
					if (this.activeTab === "Notes") this.noteCurrentPage = page;
					else this.taskCurrentPage = page;
					this.renderMiddleColumn();
				},
			},
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

			// Re-apply filters to update lists (e.g. hide if completed)
			// Do NOT call refreshFiles() here because metadataCache update is async and might be stale,
			// which would revert the status in the UI.
			this.applyFilters();
			this.renderMiddleColumn();
		}
	}

	renderRightColumn() {
		new RightSidebar(
			this.rightContainer,
			this.filters,
			this.activeTab,
			this.activeQueryId,
			this.getAllProjects(),
			(newFilters, shouldReRender) => {
				this.filters = newFilters;
				this.applyFilters();
				this.renderMiddleColumn();
				// Only re-render right column if structural changes are needed (e.g. Custom date fields)
				if (shouldReRender) {
					this.renderRightColumn();
				}
			},
			() => {
				// onReset
				this.filters = {
					name: "",
					project: "",
					dateType: "created",
					dateStart: "",
					dateEnd: "",
					datePreset: "all",
					status: "all",
				};
				this.activeQueryId = null;
				this.applyFilters();
				this.renderMiddleColumn();
				this.renderRightColumn();
				this.renderLeftColumn(
					this.contentEl.querySelector(
						".dashboard-left",
					) as HTMLElement,
				);
			},
			() => {
				// onSaveQuery
				new SaveQueryModal(
					this.app,
					t("MODAL_SAVE_TITLE"),
					"",
					async (name) => {
						await this.saveCurrentQuery(name);
					},
				).open();
			},
			async () => {
				// onUpdateQuery
				await this.updateSavedQuery(this.activeQueryId!);
			},
		).render();
	}

	async saveCurrentQuery(name: string) {
		const newQuery: SavedQuery = {
			id: Date.now().toString(),
			name,
			category: this.activeCategory,
			tab: this.activeTab,
			filters: JSON.parse(JSON.stringify(this.filters)),
		};
		this.plugin.settings.savedQueries.push(newQuery);
		await this.plugin.saveSettings();
		new Notice(`Query "${name}" saved.`);
		this.activeQueryId = newQuery.id;
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
		this.renderRightColumn();
	}

	async updateSavedQuery(id: string) {
		const query = this.plugin.settings.savedQueries.find(
			(q) => q.id === id,
		);
		if (!query) return;

		// Update query details
		query.category = this.activeCategory;
		query.tab = this.activeTab;
		query.filters = JSON.parse(JSON.stringify(this.filters));

		await this.plugin.saveSettings();
		new Notice(`Query "${query.name}" updated.`);
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
			},
		).open();
	}

	async deleteSavedQuery(id: string) {
		this.plugin.settings.savedQueries =
			this.plugin.settings.savedQueries.filter((q) => q.id !== id);
		await this.plugin.saveSettings();
		new Notice("Query deleted.");
		if (this.activeQueryId === id) {
			this.activeQueryId = null;
		}
		this.renderLeftColumn(
			this.contentEl.querySelector(".dashboard-left") as HTMLElement,
		);
		this.renderMiddleColumn();
	}

	onFileChange(file: TFile) {
		const isNoteFile = this.files.includes(file);

		const taskFolderPath = this.plugin.settings.taskFolder;
		const isInTaskFolder = file.path.startsWith(
			taskFolderPath === "/" ? "" : taskFolderPath,
		);

		if (!isNoteFile && !isInTaskFolder) return;

		this.requestRefresh(file, isInTaskFolder);
	}

	onFileDelete(file: TAbstractFile) {
		if (!(file instanceof TFile)) return;

		// Check if it's in our lists
		const isNoteFile = this.files.some((f) => f.path === file.path);
		const hasTasks = this.tasks.some((t) => t.file.path === file.path);

		if (!isNoteFile && !hasTasks) return;

		// Remove from source lists
		if (isNoteFile) {
			this.files = this.files.filter((f) => f.path !== file.path);
		}
		if (hasTasks) {
			this.tasks = this.tasks.filter((t) => t.file.path !== file.path);
		}

		// Apply filters (which will update filtered lists)
		this.applyFilters(false);
		this.renderMiddleColumn();
	}
}
