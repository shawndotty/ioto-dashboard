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
		private activeQueryName: string | null,
		private filteredFiles: TFile[],
		private filteredTasks: TaskItem[],
		private isZenMode: boolean,
		private onTabChange: (tab: "Notes" | "Tasks") => void,
		private onEditQuery: (id: string) => void,
		private onDeleteQuery: (id: string) => void,
		private onTaskToggle: (task: TaskItem) => Promise<void>,
		private onDeleteTask: (task: TaskItem) => Promise<void>,
		private onToggleZenMode: () => void,
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

		let titleText = `${this.activeCategory} (${count})`;
		if (this.activeQueryName) {
			titleText = `${this.activeQueryName} - ${titleText}`;
		}

		const title = header.createEl("h2", {
			text: titleText,
			cls: "view-header-title",
		});
		title.style.margin = "0";

		// Actions
		const actionsDiv = header.createDiv({ cls: "header-actions" });
		actionsDiv.style.display = "flex";
		actionsDiv.style.alignItems = "center";
		actionsDiv.style.paddingBottom = "10px";

		// Zen Mode Button
		const zenBtn = actionsDiv.createEl("button", {
			cls: "clickable-icon",
		});
		setIcon(zenBtn, this.isZenMode ? "minimize-2" : "maximize-2");
		zenBtn.setAttribute(
			"aria-label",
			this.isZenMode ? t("ZEN_MODE_OFF") : t("ZEN_MODE_ON"),
		);
		zenBtn.onclick = () => {
			this.onToggleZenMode();
		};

		// Query Actions
		if (this.activeQueryId) {
			const editBtn = actionsDiv.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(editBtn, "pencil");
			editBtn.setAttribute("aria-label", t("BTN_EDIT_QUERY"));
			editBtn.style.marginLeft = "8px";
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

			item.onclick = (e) => {
				let leaf = this.app.workspace.getLeaf(false);
				// Check for modifier keys to open in new split
				// Mac: Cmd+Opt, Windows: Ctrl+Alt
				if ((e.metaKey && e.altKey) || (e.ctrlKey && e.altKey)) {
					leaf = this.app.workspace.getLeaf("split", "vertical");
				}
				leaf.openFile(file);
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
			content.style.display = "flex";
			content.style.justifyContent = "space-between";
			content.style.alignItems = "flex-start";

			const leftContainer = content.createDiv({ cls: "task-left" });
			leftContainer.style.display = "flex";
			leftContainer.style.flex = "1";
			leftContainer.style.alignItems = "flex-start";

			const checkbox = leftContainer.createEl("input", {
				type: "checkbox",
				cls: "task-checkbox",
			});
			// Explicitly allow pointer events to ensure click is captured
			checkbox.style.pointerEvents = "auto";
			checkbox.style.marginTop = "5px"; // Visual alignment
			checkbox.checked = task.status !== " ";
			checkbox.onclick = async (e) => {
				e.stopPropagation();
				await this.onTaskToggle(task);
			};

			const textSpan = leftContainer.createEl("span", {
				cls: "task-markdown-content",
			});
			textSpan.style.flex = "1";
			textSpan.style.marginLeft = "8px";

			const deleteBtn = content.createEl("button", {
				cls: "task-delete-btn clickable-icon",
			});
			setIcon(deleteBtn, "trash");
			deleteBtn.setAttribute(
				"aria-label",
				t("CONFIRM_DELETE_TASK_TITLE"),
			);
			deleteBtn.style.opacity = "0"; // Initially hidden
			deleteBtn.style.transition = "opacity 0.2s ease";
			deleteBtn.style.marginLeft = "8px";
			deleteBtn.style.border = "none";
			deleteBtn.style.background = "transparent";
			deleteBtn.style.cursor = "pointer";

			item.onmouseenter = () => {
				deleteBtn.style.opacity = "0.7";
			};
			item.onmouseleave = () => {
				deleteBtn.style.opacity = "0";
			};
			deleteBtn.onmouseenter = () => {
				deleteBtn.style.opacity = "1";
			};

			deleteBtn.onclick = async (e) => {
				e.stopPropagation();
				await this.onDeleteTask(task);
			};
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

				// Handle selection state
				container.querySelectorAll(".task-item").forEach((el) => {
					el.removeClass("is-selected");
				});
				item.addClass("is-selected");

				let leaf = this.app.workspace.getLeaf(false);
				// Check for modifier keys to open in new split
				// Mac: Cmd+Opt, Windows: Ctrl+Alt
				if ((e.metaKey && e.altKey) || (e.ctrlKey && e.altKey)) {
					leaf = this.app.workspace.getLeaf("split", "vertical");
				}

				leaf.openFile(task.file, {
					eState: { line: task.line },
				});
			};
		});
	}
}
