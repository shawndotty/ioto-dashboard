import { App, setIcon, TFile, MarkdownRenderer, Component } from "obsidian";
import { t } from "../../lang/helpers";
import { Category, TaskItem } from "../../models/types";
import { DASHBOARD_VIEW_TYPE } from "../../models/constants";

export class MiddleSection {
	constructor(
		private app: App,
		private container: HTMLElement,
		private parentComponent: Component,
		private activeCategory: Category,
		private activeTab: "Notes" | "Tasks",
		private activeQueryId: string | null,
		private filteredFiles: TFile[],
		private filteredTasks: TaskItem[],
		private onTabChange: (tab: "Notes" | "Tasks") => void,
		private onEditQuery: (id: string) => void,
		private onDeleteQuery: (id: string) => void,
		private onTaskToggle: (task: TaskItem) => Promise<void>,
	) {}

	render() {
		this.container.empty();

		// Header
		const header = this.container.createDiv({
			cls: "content-header",
		});
		header.style.display = "flex";
		header.style.justifyContent = "space-between";
		header.style.alignItems = "center";

		const count =
			this.activeTab === "Notes"
				? this.filteredFiles.length
				: this.filteredTasks.length;

		const title = header.createEl("h2", {
			text: `${this.activeCategory} (${count})`,
			cls: "view-header-title",
		});
		title.style.margin = "0";

		// Query Actions
		if (this.activeQueryId) {
			const actionsDiv = header.createDiv({ cls: "header-actions" });
			actionsDiv.style.display = "flex";
			actionsDiv.style.alignItems = "center";
			actionsDiv.style.paddingBottom = "10px";

			const editBtn = actionsDiv.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(editBtn, "pencil");
			editBtn.setAttribute("aria-label", t("BTN_EDIT_QUERY"));
			editBtn.onclick = () => {
				this.onEditQuery(this.activeQueryId!);
			};

			const deleteBtn = actionsDiv.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(deleteBtn, "trash");
			deleteBtn.setAttribute("aria-label", t("BTN_DELETE_QUERY"));
			deleteBtn.style.marginLeft = "8px";
			deleteBtn.onclick = () => {
				this.onDeleteQuery(this.activeQueryId!);
			};
		}

		// Tabs
		const tabs = this.container.createDiv({ cls: "content-tabs" });
		const notesTab = tabs.createDiv({
			cls: "content-tab",
			text: t("TAB_NOTES"),
		});
		const tasksTab = tabs.createDiv({
			cls: "content-tab",
			text: t("TAB_TASKS"),
		});

		if (this.activeTab === "Notes") notesTab.addClass("is-active");
		else tasksTab.addClass("is-active");

		notesTab.onclick = () => {
			this.onTabChange("Notes");
		};
		tasksTab.onclick = () => {
			this.onTabChange("Tasks");
		};

		// List
		const list = this.container.createDiv({ cls: "file-list" });

		if (this.activeTab === "Notes") {
			this.renderNoteList(list);
		} else {
			this.renderTaskList(list);
		}
	}

	renderNoteList(container: HTMLElement) {
		if (this.filteredFiles.length === 0) {
			container.createEl("p", { text: t("NO_NOTES_FOUND") });
			return;
		}

		this.filteredFiles.forEach((file) => {
			const item = container.createDiv({ cls: "file-item" });
			item.createEl("h6", { text: file.basename });

			item.addEventListener("mouseenter", (e) => {
				this.app.workspace.trigger("hover-link", {
					event: e,
					source: DASHBOARD_VIEW_TYPE,
					hoverParent: item,
					targetEl: item,
					linktext: file.path,
					sourcePath: file.path,
				});
			});

			const meta = item.createDiv({ cls: "file-meta" });
			const cache = this.app.metadataCache.getFileCache(file);
			const project = cache?.frontmatter?.["Project"];

			if (project) {
				const projectSpan = meta.createEl("p", {
					cls: "file-project",
				});
				// Use Lucide icon 'folder'
				const iconSpan = projectSpan.createSpan({ cls: "meta-icon" });
				setIcon(iconSpan, "folder");
				projectSpan.createSpan({ text: ` ${project}` });
			}

			const dateSpan = meta.createEl("p", { cls: "file-date" });
			// Use Lucide icon 'calendar'
			const dateIconSpan = dateSpan.createSpan({ cls: "meta-icon" });
			setIcon(dateIconSpan, "calendar");
			const date = new Date(file.stat.ctime).toLocaleDateString();
			dateSpan.createSpan({ text: ` ${date}` });

			item.onclick = () => {
				this.app.workspace.getLeaf(false).openFile(file);
			};
		});
	}

	renderTaskList(container: HTMLElement) {
		if (this.filteredTasks.length === 0) {
			container.createEl("p", { text: t("NO_TASKS_FOUND") });
			return;
		}

		this.filteredTasks.forEach((task) => {
			const item = container.createDiv({ cls: "task-item" });

			const header = item.createDiv({ cls: "task-item-header" });
			header.createEl("span", { text: task.file.basename });
			const date = new Date(task.file.stat.ctime).toLocaleDateString();
			header.createEl("span", { text: date });

			const content = item.createDiv({ cls: "task-content" });
			const checkbox = content.createEl("input", {
				type: "checkbox",
				cls: "task-checkbox",
			});
			// Explicitly allow pointer events to ensure click is captured
			checkbox.style.pointerEvents = "auto";
			checkbox.checked = task.status !== " ";
			checkbox.onclick = async (e) => {
				e.stopPropagation();
				await this.onTaskToggle(task);
			};

			const textSpan = content.createEl("span", {
				cls: "task-markdown-content",
			});
			MarkdownRenderer.render(
				this.app,
				task.content,
				textSpan,
				task.file.path,
				this.parentComponent,
			).then(() => {
				// Remove paragraph margins to keep it inline-like
				const p = textSpan.querySelector("p");
				if (p) {
					p.style.margin = "0";
					p.style.display = "inline";
				}

				// Handle internal links (preview and navigation)
				const internalLinks =
					textSpan.querySelectorAll("a.internal-link");
				internalLinks.forEach((link) => {
					// Hover preview
					link.addEventListener("mouseenter", (e) => {
						this.app.workspace.trigger("hover-link", {
							event: e,
							source: DASHBOARD_VIEW_TYPE,
							hoverParent: textSpan,
							targetEl: link,
							linktext: link.getAttribute("data-href"),
							sourcePath: task.file.path,
						});
					});

					// Click navigation
					link.addEventListener("click", (e) => {
						e.preventDefault();
						e.stopPropagation();
						const href = link.getAttribute("data-href");
						if (href) {
							this.app.workspace.openLinkText(
								href,
								task.file.path,
								false, // open in same tab? or true for new tab? usually false for clicking link
							);
						}
					});
				});

				// Handle external links (stop propagation to avoid opening task file)
				const externalLinks =
					textSpan.querySelectorAll("a.external-link");
				externalLinks.forEach((link) => {
					link.addEventListener("click", (e) => {
						e.stopPropagation();
					});
				});
			});

			item.onclick = (e) => {
				const target = e.target as HTMLElement;
				// Prevent triggering if clicking checkbox directly
				if (
					target instanceof HTMLInputElement &&
					target.type === "checkbox"
				) {
					return;
				}
				// Prevent triggering if clicking a link (internal or external)
				if (target.tagName === "A" || target.closest("a")) {
					return;
				}

				this.app.workspace.getLeaf(false).openFile(task.file, {
					eState: { line: task.line },
				});
			};
		});
	}
}
