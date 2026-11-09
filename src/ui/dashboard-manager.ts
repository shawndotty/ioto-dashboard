import { App, Modal, Notice } from "obsidian";
import { t } from "../lang/helpers";
import type {
	DashboardStoreData,
	DashboardWorkspace,
} from "../dashboard/types";
import { ConfirmModal } from "./ConfirmModal";
import { PageNameModal } from "./page-name-modal";

export interface DashboardManagerDeps {
	getStore: () => DashboardStoreData | null;
	isOpen: (dashboardId: string) => boolean;
	openCount: (dashboardId: string) => number;
	onOpen: (dashboardId: string) => void;
	onCreate: (name: string) => Promise<void>;
	onRename: (dashboardId: string, name: string) => Promise<void>;
	onDuplicate: (dashboardId: string, name: string) => Promise<void>;
	onDelete: (dashboardId: string) => Promise<void>;
}

/** Case-insensitive uniqueness; duplicates get ` 2`, ` 3`, … */
export function uniqueDashboardName(
	base: string,
	taken: Iterable<string>,
): string {
	const names = new Set(
		Array.from(taken, (name) => name.toLowerCase()),
	);
	const trimmed = base.trim();
	const root = trimmed.length > 0 ? trimmed : "Dashboard";
	if (!names.has(root.toLowerCase())) return root;
	let index = 2;
	while (names.has(`${root} ${index}`.toLowerCase())) index += 1;
	return `${root} ${index}`;
}

export class DashboardManagerModal extends Modal {
	constructor(
		app: App,
		private deps: DashboardManagerDeps,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("ioto-dashboard-manager-modal");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ioto-dashboard-manager-modal");
		contentEl.createEl("h2", { text: t("DASHBOARD_MANAGER_TITLE") });

		const dashboards = this.deps.getStore()?.dashboards ?? [];
		const list = contentEl.createDiv({
			cls: "ioto-dashboard-manager-list",
		});
		for (const dashboard of dashboards) {
			this.renderRow(list, dashboard, dashboards.length);
		}

		const footer = contentEl.createDiv({
			cls: "ioto-dashboard-manager-footer",
		});
		const create = footer.createEl("button", {
			cls: "mod-cta",
			text: t("DASHBOARD_NEW"),
		});
		create.onClickEvent(() => this.promptCreate());
	}

	private renderRow(
		list: HTMLElement,
		dashboard: DashboardWorkspace,
		total: number,
	): void {
		const open = this.deps.isOpen(dashboard.id);
		const row = list.createDiv({
			cls: `ioto-dashboard-manager-row${open ? " is-open" : ""}`,
		});
		const main = row.createEl("button", {
			cls: "ioto-dashboard-manager-main",
			attr: { type: "button", "aria-label": dashboard.name },
		});
		main.createSpan({
			cls: "ioto-dashboard-manager-name",
			text: dashboard.name,
		});
		if (open) {
			main.createSpan({
				cls: "ioto-dashboard-manager-status",
				text: t("DASHBOARD_STATUS_OPEN"),
			});
		}
		main.createSpan({
			cls: "ioto-dashboard-manager-summary",
			text: t("DASHBOARD_PAGES_SUMMARY", [
				String(dashboard.pages.length),
				String(componentCount(dashboard)),
			]),
		});
		main.onClickEvent(() => {
			this.deps.onOpen(dashboard.id);
			this.render();
		});

		const actions = row.createDiv({
			cls: "ioto-dashboard-manager-actions",
		});
		this.actionButton(actions, t("DASHBOARD_RENAME"), () =>
			this.promptRename(dashboard),
		);
		this.actionButton(actions, t("DASHBOARD_DUPLICATE"), () =>
			this.promptDuplicate(dashboard),
		);
		const remove = this.actionButton(actions, t("DASHBOARD_DELETE"), () =>
			this.confirmDelete(dashboard, total),
		);
		if (total <= 1) {
			remove.disabled = true;
			remove.title = t("DASHBOARD_LAST_CANNOT_DELETE");
		}
	}

	private actionButton(
		container: HTMLElement,
		label: string,
		onClick: () => void,
	): HTMLButtonElement {
		const button = container.createEl("button", {
			cls: "ioto-dashboard-manager-action",
			text: label,
			attr: { type: "button" },
		});
		button.onClickEvent(onClick);
		return button;
	}

	private takenNames(excludeId?: string): string[] {
		return (this.deps.getStore()?.dashboards ?? [])
			.filter((dashboard) => dashboard.id !== excludeId)
			.map((dashboard) => dashboard.name);
	}

	private promptCreate(): void {
		new PageNameModal(
			this.app,
			"",
			(raw) => {
				const name = uniqueDashboardName(raw, this.takenNames());
				void this.deps.onCreate(name).then(() => this.render());
			},
			{
				titleKey: "DASHBOARD_NEW",
				placeholderKey: "DASHBOARD_NAME_PLACEHOLDER",
			},
		).open();
	}

	private promptRename(dashboard: DashboardWorkspace): void {
		new PageNameModal(
			this.app,
			dashboard.name,
			(raw) => {
				const name = uniqueDashboardName(
					raw,
					this.takenNames(dashboard.id),
				);
				void this.deps
					.onRename(dashboard.id, name)
					.then(() => this.render());
			},
			{
				titleKey: "DASHBOARD_RENAME",
				placeholderKey: "DASHBOARD_NAME_PLACEHOLDER",
			},
		).open();
	}

	private promptDuplicate(dashboard: DashboardWorkspace): void {
		const base = `${dashboard.name} ${t("DASHBOARD_COPY_SUFFIX")}`;
		const name = uniqueDashboardName(base, this.takenNames());
		void this.deps
			.onDuplicate(dashboard.id, name)
			.then(() => this.render());
	}

	private confirmDelete(
		dashboard: DashboardWorkspace,
		total: number,
	): void {
		if (total <= 1) {
			new Notice(t("DASHBOARD_LAST_CANNOT_DELETE"));
			return;
		}
		const baseMessage = t("DASHBOARD_DELETE_MSG", [
			dashboard.name,
			String(dashboard.pages.length),
			String(componentCount(dashboard)),
		]);
		const openTabs = this.deps.openCount(dashboard.id);
		const message =
			openTabs > 0
				? `${baseMessage} ${t("DASHBOARD_DELETE_OPEN_HINT", [
						String(openTabs),
					])}`
				: baseMessage;
		new ConfirmModal(
			this.app,
			t("DASHBOARD_DELETE_TITLE"),
			message,
			() => {
				void this.deps
					.onDelete(dashboard.id)
					.then(() => this.render());
			},
		).open();
	}
}

function componentCount(dashboard: DashboardWorkspace): number {
	return dashboard.pages.reduce(
		(total, page) => total + page.components.length,
		0,
	);
}
