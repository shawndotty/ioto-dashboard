import {
	App,
	Modal,
	Notice,
	TAbstractFile,
	TFile,
	TFolder,
	moment,
	setIcon,
} from "obsidian";
import { t } from "../lang/helpers";
import { formatSize } from "../dashboard/dataset/types";
import { applyModalShell } from "./modal-shell";

const MAX_FOLDER_ITEMS = 1000;

export interface FolderContentsModalOptions {
	rootPath: string;
	openFile(path: string): void;
	reveal(path: string): void;
}

interface FolderEntry {
	node: TAbstractFile;
	label: string;
}

interface FolderListing {
	entries: FolderEntry[];
	files: number;
	folders: number;
	total: number;
	truncated: boolean;
}

function compareNodes(left: TAbstractFile, right: TAbstractFile): number {
	const leftFolder = left instanceof TFolder ? 0 : 1;
	const rightFolder = right instanceof TFolder ? 0 : 1;
	if (leftFolder !== rightFolder) return leftFolder - rightFolder;
	return left.name.localeCompare(right.name, undefined, {
		numeric: true,
		sensitivity: "base",
	});
}

export class FolderContentsModal extends Modal {
	private root: TFolder | null = null;
	private current: TFolder | null = null;
	private includeSubfolders = false;

	constructor(
		app: App,
		private readonly options: FolderContentsModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const root = this.app.vault.getAbstractFileByPath(this.options.rootPath);
		if (!(root instanceof TFolder)) {
			new Notice(t("TABLE_LINK_MISSING", [this.options.rootPath]));
			this.close();
			return;
		}
		this.root = root;
		this.current = root;
		applyModalShell(this, {
			kind: "folder-contents",
			restore: true,
			title: t("FOLDER_MODAL_TITLE", [this.folderLabel(root)]),
		});
		this.contentEl.addClass("ioto-folder-contents");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private folderLabel(folder: TFolder): string {
		if (folder.path === "/") return "/";
		return folder.name || folder.path;
	}

	private render(): void {
		const folder = this.current;
		const root = this.root;
		if (!folder || !root) return;

		const content = this.contentEl;
		content.empty();

		const listing = this.loadListing(folder);

		const header = content.createDiv({
			cls: "ioto-folder-contents-header",
		});
		header.createDiv({
			cls: "ioto-folder-contents-path",
			text: folder.path === "/" ? "/" : folder.path,
		});
		header.createDiv({
			cls: "ioto-folder-contents-count",
			text: t("FOLDER_MODAL_COUNT", [
				String(listing.files),
				String(listing.folders),
			]),
		});

		const nav = content.createDiv({ cls: "ioto-folder-contents-nav" });
		const parent = folder.parent;
		if (
			folder.path !== root.path &&
			parent instanceof TFolder
		) {
			const back = nav.createEl("button", {
				cls: "clickable-icon ioto-folder-contents-back",
				attr: { type: "button", "aria-label": t("FOLDER_MODAL_BACK") },
			});
			setIcon(back, "arrow-left");
			back.addEventListener("click", () => this.navigate(parent));
		}

		const crumbs = nav.createDiv({ cls: "ioto-folder-contents-crumbs" });
		for (const crumb of this.crumbs(root, folder)) {
			const button = crumbs.createEl("button", {
				cls: "ioto-folder-contents-crumb",
				text: crumb.label,
				attr: { type: "button" },
			});
			if (crumb.path === folder.path) {
				button.addClass("is-current");
			} else {
				button.addEventListener("click", () => {
					const target =
						this.app.vault.getAbstractFileByPath(crumb.path);
					if (target instanceof TFolder) this.navigate(target);
				});
			}
		}

		const toggle = crumbs.createEl("label", {
			cls: "ioto-folder-contents-subfolders",
		});
		const checkbox = toggle.createEl("input", {
			attr: { type: "checkbox" },
		});
		checkbox.checked = this.includeSubfolders;
		toggle.createSpan({ text: t("QUERY_INCLUDE_SUBFOLDERS") });
		checkbox.addEventListener("change", () => {
			this.includeSubfolders = checkbox.checked;
			this.render();
		});

		const list = content.createDiv({ cls: "ioto-folder-contents-list" });
		if (listing.entries.length === 0) {
			list.createDiv({
				cls: "ioto-folder-contents-empty",
				text: t("FOLDER_MODAL_EMPTY"),
			});
		} else {
			for (const entry of listing.entries) {
				this.renderRow(list, entry);
			}
		}

		if (listing.truncated) {
			content.createDiv({
				cls: "ioto-folder-contents-truncated",
				text: t("FOLDER_MODAL_TRUNCATED", [
					String(MAX_FOLDER_ITEMS),
					String(listing.total),
				]),
			});
		}
	}

	private crumbs(
		root: TFolder,
		folder: TFolder,
	): Array<{ label: string; path: string }> {
		const list: Array<{ label: string; path: string }> = [
			{ label: this.folderLabel(root), path: root.path },
		];
		if (folder.path === root.path) return list;

		const base = root.path === "/" ? "" : root.path;
		const rest = base
			? folder.path.slice(base.length + 1)
			: folder.path;
		let acc = base;
		for (const segment of rest.split("/").filter(Boolean)) {
			acc = acc ? `${acc}/${segment}` : segment;
			list.push({ label: segment, path: acc });
		}
		return list;
	}

	private loadListing(folder: TFolder): FolderListing {
		const entries: FolderEntry[] = [];
		let files = 0;
		let folders = 0;
		let total = 0;

		const walk = (parent: TFolder, prefix: string): void => {
			for (const child of [...parent.children].sort(compareNodes)) {
				total += 1;
				if (child instanceof TFolder) folders += 1;
				else files += 1;
				if (entries.length < MAX_FOLDER_ITEMS) {
					entries.push({
						node: child,
						label: prefix ? `${prefix}${child.name}` : child.name,
					});
				}
				if (this.includeSubfolders && child instanceof TFolder) {
					walk(child, `${prefix}${child.name}/`);
				}
			}
		};
		walk(folder, "");

		return {
			entries,
			files,
			folders,
			total,
			truncated: total > entries.length,
		};
	}

	private renderRow(host: HTMLElement, entry: FolderEntry): void {
		const { node } = entry;
		const isFolder = node instanceof TFolder;
		const row = host.createDiv({
			cls: `ioto-folder-contents-row${isFolder ? " is-folder" : " is-file"}`,
			attr: {
				tabindex: "0",
				role: isFolder ? "button" : "link",
				"aria-label": isFolder
					? entry.label
					: `${entry.label} · ${t("FOLDER_MODAL_OPEN_NEW_TAB")}`,
			},
		});

		const icon = row.createSpan({ cls: "ioto-folder-contents-icon" });
		setIcon(icon, isFolder ? "folder" : "file");
		row.createSpan({
			cls: "ioto-folder-contents-name",
			text: entry.label,
		});

		if (node instanceof TFolder) {
			row.createSpan({
				cls: "ioto-folder-contents-meta",
				text: String(node.children.length),
			});
		} else if (node instanceof TFile) {
			row.createSpan({
				cls: "ioto-folder-contents-meta",
				text: formatSize(node.stat.size),
			});
			row.createSpan({
				cls: "ioto-folder-contents-meta ioto-folder-contents-date",
				text: moment(node.stat.mtime).format("YYYY-MM-DD HH:mm"),
			});
		}

		const reveal = row.createEl("button", {
			cls: "clickable-icon ioto-folder-contents-reveal",
			attr: {
				type: "button",
				"aria-label": t("FOLDER_MODAL_REVEAL"),
				title: t("FOLDER_MODAL_REVEAL"),
			},
		});
		setIcon(reveal, "folder-open");
		reveal.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.options.reveal(node.path);
		});

		const activate = (): void => {
			if (node instanceof TFolder) this.navigate(node);
			else if (node instanceof TFile) this.options.openFile(node.path);
		};
		row.addEventListener("click", (event) => {
			if ((event.target as HTMLElement | null)?.closest("button")) {
				return;
			}
			activate();
		});
		row.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			activate();
		});
	}

	private navigate(folder: TFolder): void {
		this.current = folder;
		this.render();
	}
}
