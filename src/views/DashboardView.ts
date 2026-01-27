import {
	ItemView,
	WorkspaceLeaf,
	setIcon,
	TFile,
	TFolder,
	TextComponent,
	DropdownComponent,
} from "obsidian";
import { DASHBOARD_VIEW_TYPE } from "../models/constants";
import IotoDashboardPlugin from "../main";

type Category = "Input" | "Output" | "Outcome";

interface FilterState {
	name: string;
	project: string;
	dateType: "created" | "modified";
	dateStart: string;
	dateEnd: string;
}

export class DashboardView extends ItemView {
	plugin: IotoDashboardPlugin;
	activeCategory: Category = "Input";
	leftPanelCollapsed = false;
	rightPanelCollapsed = false;

	// Data
	files: TFile[] = [];
	filteredFiles: TFile[] = [];

	// Filters
	filters: FilterState = {
		name: "",
		project: "",
		dateType: "created",
		dateStart: "",
		dateEnd: "",
	};

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: IotoDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText() {
		return "IOTO Dashboard";
	}

	getIcon() {
		return "layout-dashboard";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass("dashboard-container");

		const grid = container.createDiv({ cls: "dashboard-grid" });
		if (this.leftPanelCollapsed) grid.addClass("usages-collapsed");
		if (this.rightPanelCollapsed) grid.addClass("right-collapsed");

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
	}

	async refreshFiles() {
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
			this.files = [];
			WorkspaceLeaf;
			// Recursive get files or just first level? Usually recursive for "folder notes" but let's assume flat or recursive.
			// Let's use a helper to get all files in folder recursively
			this.files = this.getAllFiles(folder);
		} else {
			this.files = [];
		}

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

	applyFilters() {
		this.filteredFiles = this.files.filter((file) => {
			// 1. Name Filter
			if (
				this.filters.name &&
				!file.basename
					.toLowerCase()
					.includes(this.filters.name.toLowerCase())
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

			if (this.filters.dateStart) {
				const startDate = new Date(this.filters.dateStart);
				if (date < startDate) return false;
			}

			if (this.filters.dateEnd) {
				const endDate = new Date(this.filters.dateEnd);
				// Set end date to end of day
				endDate.setHours(23, 59, 59, 999);
				if (date > endDate) return false;
			}

			return true;
		});

		// Sort by date descending (newest first) by default
		this.filteredFiles.sort((a, b) => b.stat.ctime - a.stat.ctime);
	}

	renderLeftColumn(container: HTMLElement) {
		container.empty();

		const header = container.createDiv({ cls: "nav-header" });
		if (!this.leftPanelCollapsed) {
			header.createEl("h3", { text: "Navigation" });
		}

		const toggle = header.createEl("button", { cls: "nav-toggle" });
		setIcon(
			toggle,
			this.leftPanelCollapsed ? "chevrons-right" : "chevrons-left",
		);
		toggle.onclick = () => {
			this.leftPanelCollapsed = !this.leftPanelCollapsed;
			const grid = container.closest(".dashboard-grid");
			if (grid) {
				if (this.leftPanelCollapsed) grid.addClass("usages-collapsed");
				else grid.removeClass("usages-collapsed");
			}
			this.renderLeftColumn(container);
		};

		const navItems: Category[] = ["Input", "Output", "Outcome"];
		const list = container.createEl("ul", { cls: "nav-list" });

		navItems.forEach((item) => {
			const li = list.createEl("li", {
				text: this.leftPanelCollapsed ? item.charAt(0) : item,
				cls: "nav-item",
			});
			if (item === this.activeCategory) li.addClass("is-active");

			li.onclick = async () => {
				this.activeCategory = item;
				container
					.findAll(".nav-item")
					.forEach((el) => el.removeClass("is-active"));
				li.addClass("is-active");

				// Clear filters on category switch? Maybe keep them. Let's keep them for now.
				await this.refreshFiles();
				this.renderMiddleColumn();
				this.renderRightColumn();
			};
		});
	}

	renderMiddleColumn() {
		this.middleContainer.empty();

		// Header
		const header = this.middleContainer.createDiv({
			cls: "content-header",
		});
		header.createEl("h2", {
			text: `${this.activeCategory} (${this.filteredFiles.length})`,
		});

		// List
		const list = this.middleContainer.createDiv({ cls: "file-list" });

		if (this.filteredFiles.length === 0) {
			list.createEl("p", { text: "No files found." });
			return;
		}

		this.filteredFiles.forEach((file) => {
			const item = list.createDiv({ cls: "file-item" });
			item.createEl("h4", { text: file.basename });

			const meta = item.createDiv({ cls: "file-meta" });
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];

			if (project) {
				meta.createEl("span", {
					text: `📂 ${project}`,
					cls: "file-project",
				});
			}

			const date = new Date(file.stat.ctime).toLocaleDateString();
			meta.createEl("span", { text: `📅 ${date}`, cls: "file-date" });

			item.onclick = () => {
				this.app.workspace.getLeaf(false).openFile(file);
			};
		});
	}

	renderRightColumn() {
		this.rightContainer.empty();
		this.rightContainer.createEl("h3", { text: "Filters" });

		const form = this.rightContainer.createDiv({ cls: "filter-form" });

		// Name Filter
		const nameDiv = form.createDiv({ cls: "filter-item" });
		nameDiv.createEl("label", { text: "Note Name" });
		new TextComponent(nameDiv)
			.setValue(this.filters.name)
			.setPlaceholder("Search...")
			.onChange((val) => {
				this.filters.name = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});

		// Project Filter
		const projectDiv = form.createDiv({ cls: "filter-item" });
		projectDiv.createEl("label", { text: "Project" });
		new TextComponent(projectDiv)
			.setValue(this.filters.project)
			.setPlaceholder("Project name...")
			.onChange((val) => {
				this.filters.project = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});

		// Date Type
		const dateTypeDiv = form.createDiv({ cls: "filter-item" });
		dateTypeDiv.createEl("label", { text: "Date Type" });
		new DropdownComponent(dateTypeDiv)
			.addOption("created", "Created")
			.addOption("modified", "Modified")
			.setValue(this.filters.dateType)
			.onChange((val: "created" | "modified") => {
				this.filters.dateType = val;
				this.applyFilters();
				this.renderMiddleColumn();
			});

		// Date Start
		const dateStartDiv = form.createDiv({ cls: "filter-item" });
		dateStartDiv.createEl("label", { text: "From Date" });
		const dateStartInput = dateStartDiv.createEl("input", { type: "date" });
		dateStartInput.value = this.filters.dateStart;
		dateStartInput.onchange = (e) => {
			this.filters.dateStart = (e.target as HTMLInputElement).value;
			this.applyFilters();
			this.renderMiddleColumn();
		};

		// Date End
		const dateEndDiv = form.createDiv({ cls: "filter-item" });
		dateEndDiv.createEl("label", { text: "To Date" });
		const dateEndInput = dateEndDiv.createEl("input", { type: "date" });
		dateEndInput.value = this.filters.dateEnd;
		dateEndInput.onchange = (e) => {
			this.filters.dateEnd = (e.target as HTMLInputElement).value;
			this.applyFilters();
			this.renderMiddleColumn();
		};

		// Reset Button
		const btnDiv = form.createDiv({ cls: "filter-actions" });
		const resetBtn = btnDiv.createEl("button", { text: "Reset Filters" });
		resetBtn.onclick = () => {
			this.filters = {
				name: "",
				project: "",
				dateType: "created",
				dateStart: "",
				dateEnd: "",
			};
			this.applyFilters();
			this.renderMiddleColumn();
			this.renderRightColumn(); // Re-render to clear inputs
		};
	}
}
