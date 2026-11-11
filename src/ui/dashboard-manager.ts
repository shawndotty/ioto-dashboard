import { App, ButtonComponent, Modal, Notice } from "obsidian";
import { t } from "../lang/helpers";
import type {
	DashboardStoreData,
	DashboardWorkspace,
} from "../dashboard/types";
import {
	type CollectionItem,
	type CollectionLayout,
	renderCollection,
	revealCollectionItem,
} from "./collection-view";
import { applyModalShell, createLayoutToggle } from "./modal-shell";
import { ConfirmModal } from "./ConfirmModal";
import { PageNameModal } from "./page-name-modal";

export interface DashboardManagerDeps {
	getStore: () => DashboardStoreData | null;
	isOpen: (dashboardId: string) => boolean;
	openCount: (dashboardId: string) => number;
	onOpen: (dashboardId: string) => void;
	onCreate: (name: string) => Promise<string>;
	onRename: (dashboardId: string, name: string) => Promise<void>;
	onDuplicate: (dashboardId: string, name: string) => Promise<string | null>;
	onDelete: (dashboardId: string) => Promise<void>;
}

export interface DashboardManagerPreferences {
	layout: CollectionLayout;
	onLayoutChange(layout: CollectionLayout): void;
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
	private layout: CollectionLayout;
	private collectionEl: HTMLElement | null = null;

	constructor(
		app: App,
		private deps: DashboardManagerDeps,
		private preferences?: DashboardManagerPreferences,
	) {
		super(app);
		this.layout = preferences?.layout ?? "list";
	}

	onOpen(): void {
		applyModalShell(this, {
			kind: "dashboard-manager",
			restore: true,
			title: t("DASHBOARD_MANAGER_TITLE"),
		});

		const toolbar = this.contentEl.createDiv({ cls: "ioto-query-toolbar" });
		new ButtonComponent(toolbar)
			.setButtonText(t("DASHBOARD_NEW"))
			.setCta()
			.onClick(() => this.promptCreate());

		const body = this.contentEl.createDiv({ cls: "ioto-modal-body" });
		this.collectionEl = body.createDiv({ cls: "ioto-modal-collection" });

		if (this.preferences) {
			createLayoutToggle(this, this.layout, (layout) => {
				this.layout = layout;
				this.preferences?.onLayoutChange(layout);
				this.renderItems();
			});
		}

		this.renderItems();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderItems(): void {
		if (!this.collectionEl?.isConnected) return;
		const dashboards = this.deps.getStore()?.dashboards ?? [];
		const lastOne = dashboards.length <= 1;

		const items: CollectionItem[] = dashboards.map((dashboard) => {
			const open = this.deps.isOpen(dashboard.id);
			const meta = [
				t("DASHBOARD_PAGES_SUMMARY", [
					String(dashboard.pages.length),
					String(componentCount(dashboard)),
				]),
				open ? t("DASHBOARD_STATUS_OPEN") : "",
			]
				.filter(Boolean)
				.join(" · ");

			return {
				id: dashboard.id,
				title: dashboard.name,
				meta,
				onActivate: () => this.openDashboard(dashboard),
				actions: [
					{
						icon: "external-link",
						label: t("DASHBOARD_OPEN"),
						onClick: () => this.openDashboard(dashboard),
					},
					{
						icon: "copy",
						label: t("DASHBOARD_DUPLICATE"),
						onClick: () => this.promptDuplicate(dashboard),
					},
					{
						icon: "pencil",
						label: t("DASHBOARD_RENAME"),
						onClick: () => this.promptRename(dashboard),
					},
					{
						icon: "trash",
						label: t("DASHBOARD_DELETE"),
						danger: true,
						disabled: lastOne,
						tooltip: lastOne
							? t("DASHBOARD_LAST_CANNOT_DELETE")
							: undefined,
						onClick: () =>
							this.confirmDelete(dashboard, dashboards.length),
					},
				],
			};
		});

		renderCollection(this.collectionEl, items, this.layout);
	}

	private openDashboard(dashboard: DashboardWorkspace): void {
		this.deps.onOpen(dashboard.id);
		this.renderItems();
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
				void this.deps.onCreate(name).then((id) => {
					this.renderItems();
					revealCollectionItem(this.collectionEl, id);
					new Notice(t("DASHBOARD_CREATED", [name]));
				});
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
					.then(() => this.renderItems());
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
		void this.deps.onDuplicate(dashboard.id, name).then((id) => {
			this.renderItems();
			if (!id) return;
			revealCollectionItem(this.collectionEl, id);
			new Notice(t("DASHBOARD_DUPLICATED", [name]));
		});
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
					.then(() => this.renderItems());
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
