import { App, ButtonComponent, Modal, Notice, Setting, normalizePath } from "obsidian";
import { t } from "../lang/helpers";
import type { ImportPlan } from "../dashboard/bundle";
import { hasImportErrors } from "../dashboard/bundle";
import { applyModalShell } from "./modal-shell";
import { ConfirmModal } from "./ConfirmModal";

export interface ExportModalOptions {
	json: string;
	summary: string;
	warnings: string[];
	defaultFolder: string;
	filename: string;
}

export class TransferExportModal extends Modal {
	constructor(
		app: App,
		private options: ExportModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		applyModalShell(this, {
			kind: "transfer",
			restore: false,
			allowFullscreen: false,
			title: t("TRANSFER_EXPORT_TITLE"),
		});
		const { contentEl } = this;
		contentEl.empty();

		const body = contentEl.createDiv({ cls: "ioto-modal-body" });
		body.createEl("p", { text: this.options.summary });

		if (this.options.warnings.length > 0) {
			const box = body.createDiv({ cls: "ioto-transfer-warnings" });
			box.createEl("strong", { text: t("TRANSFER_WARNINGS_TITLE") });
			const list = box.createEl("ul");
			for (const warning of this.options.warnings) {
				list.createEl("li", { text: warning });
			}
		}

		const preview = body.createEl("textarea", {
			cls: "ioto-transfer-json",
			attr: { readonly: "true", rows: "12", spellcheck: "false" },
		});
		preview.value = this.options.json;

		let folder = this.options.defaultFolder;
		new Setting(body)
			.setName(t("TRANSFER_FOLDER_NAME"))
			.setDesc(t("TRANSFER_FOLDER_DESC"))
			.addText((text) =>
				text
					.setPlaceholder(this.options.defaultFolder)
					.setValue(folder)
					.onChange((value) => {
						folder = value.trim();
					}),
			);

		const footer = contentEl.createDiv({ cls: "ioto-modal-footer" });
		const actions = footer.createDiv({ cls: "ioto-modal-footer__actions" });
		new ButtonComponent(actions)
			.setButtonText(t("TRANSFER_COPY"))
			.onClick(() => void this.copy(preview));
		new ButtonComponent(actions)
			.setButtonText(t("TRANSFER_SAVE_FILE"))
			.setCta()
			.onClick(() => void this.save(folder));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async copy(preview: HTMLTextAreaElement): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.options.json);
			new Notice(t("TRANSFER_COPIED"));
			return;
		} catch {
			preview.select();
			// eslint-disable-next-line @typescript-eslint/no-deprecated -- clipboard API is unavailable outside secure contexts.
			const copied = document.execCommand("copy");
			new Notice(
				copied
					? t("TRANSFER_COPIED")
					: t("TRANSFER_COPY_FAILED"),
			);
		}
	}

	private async save(folder: string): Promise<void> {
		const target = folder || this.options.defaultFolder;
		const path = normalizePath(
			`${target}/${this.options.filename}`.replace(/\/+/g, "/"),
		);
		try {
			const dir = path.slice(0, path.lastIndexOf("/"));
			if (dir) await this.app.vault.adapter.mkdir(dir).catch(() => undefined);
			await this.app.vault.adapter.write(path, this.options.json);
			new Notice(t("TRANSFER_SAVED", [path]));
			this.close();
		} catch (error) {
			console.warn("IOTO Dashboard: export write failed", error);
			new Notice(t("TRANSFER_SAVE_FAILED"));
		}
	}
}

export interface ImportModalOptions {
	defaultFolder: string;
	/** Parses + plans; returns an error message or a ready plan. */
	plan(text: string): { plan?: ImportPlan; error?: string };
	onApply(plan: ImportPlan): Promise<void>;
	/** Backup restore replaces every dashboard, so it always asks twice. */
	requireConfirm?: boolean;
}

export class TransferImportModal extends Modal {
	private textarea: HTMLTextAreaElement | null = null;
	private previewEl: HTMLElement | null = null;
	private applyButton: ButtonComponent | null = null;
	private folder = "";
	private currentPlan: ImportPlan | null = null;

	constructor(
		app: App,
		private options: ImportModalOptions,
	) {
		super(app);
		this.folder = options.defaultFolder;
	}

	onOpen(): void {
		applyModalShell(this, {
			kind: "transfer",
			restore: false,
			allowFullscreen: false,
			title: t("TRANSFER_IMPORT_TITLE"),
		});
		const { contentEl } = this;
		contentEl.empty();

		const body = contentEl.createDiv({ cls: "ioto-modal-body" });
		body.createEl("p", { text: t("TRANSFER_IMPORT_HINT") });

		this.textarea = body.createEl("textarea", {
			cls: "ioto-transfer-json",
			attr: {
				rows: "8",
				spellcheck: "false",
				placeholder: t("TRANSFER_IMPORT_PLACEHOLDER"),
			},
		});
		this.textarea.addEventListener("input", () => this.resetPreview());

		new Setting(body)
			.setName(t("TRANSFER_FOLDER_NAME"))
			.setDesc(t("TRANSFER_FOLDER_DESC"))
			.addText((text) =>
				text
					.setPlaceholder(this.options.defaultFolder)
					.setValue(this.folder)
					.onChange((value) => {
						this.folder = value.trim();
					}),
			)
			.addButton((button) =>
				button
					.setButtonText(t("TRANSFER_LOAD_FILE"))
					.onClick(() => void this.loadFile()),
			);

		this.previewEl = body.createDiv({ cls: "ioto-transfer-preview" });

		const footer = contentEl.createDiv({ cls: "ioto-modal-footer" });
		const actions = footer.createDiv({ cls: "ioto-modal-footer__actions" });
		new ButtonComponent(actions)
			.setButtonText(t("BTN_CANCEL"))
			.onClick(() => this.close());
		new ButtonComponent(actions)
			.setButtonText(t("TRANSFER_PREVIEW"))
			.onClick(() => this.buildPreview());
		this.applyButton = new ButtonComponent(actions)
			.setButtonText(t("TRANSFER_APPLY"))
			.setCta()
			.onClick(() => void this.apply());
		this.applyButton.setDisabled(true);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private resetPreview(): void {
		this.currentPlan = null;
		this.applyButton?.setDisabled(true);
		this.previewEl?.empty();
	}

	private async loadFile(): Promise<void> {
		const raw = (this.folder || this.options.defaultFolder).trim();
		if (!raw) return;
		const path = normalizePath(raw);
		try {
			let filePath = path;
			if (!path.toLowerCase().endsWith(".json")) {
				const files = this.app.vault
					.getFiles()
					.filter(
						(item) =>
							item.extension === "json" &&
							(item.path === path ||
								item.path.startsWith(`${path}/`)),
					)
					.sort((a, b) => b.stat.mtime - a.stat.mtime);
				const newest = files[0];
				if (!newest) {
					new Notice(t("TRANSFER_NO_FILES"));
					return;
				}
				filePath = newest.path;
			}
			const text = await this.app.vault.adapter.read(filePath);
			if (this.textarea) this.textarea.value = text;
			this.buildPreview();
		} catch (error) {
			console.warn("IOTO Dashboard: import read failed", error);
			new Notice(t("TRANSFER_READ_FAILED"));
		}
	}

	private buildPreview(): void {
		const text = this.textarea?.value ?? "";
		this.resetPreview();
		if (!text.trim()) return;
		const result = this.options.plan(text);
		if (!result.plan) {
			this.renderError(result.error ?? t("TRANSFER_ERROR_INVALID_PAYLOAD"));
			return;
		}
		this.currentPlan = result.plan;
		this.renderPlan(result.plan);
		if (!hasImportErrors(result.plan)) {
			this.applyButton?.setDisabled(false);
		}
	}

	private renderError(message: string): void {
		const box = this.previewEl?.createDiv({
			cls: "ioto-transfer-preview__error",
		});
		box?.createEl("p", { text: message });
	}

	private renderPlan(plan: ImportPlan): void {
		const root = this.previewEl;
		if (!root) return;
		const counts = [
			`${t("TRANSFER_PAGES")}: ${plan.pages.length}`,
			`${t("TRANSFER_DASHBOARDS")}: ${plan.dashboards.length}`,
			`${t("TRANSFER_QUERIES")}: ${plan.queries.length}`,
			`${t("TRANSFER_FILTERS")}: ${plan.customFilters.length}`,
		];
		root.createDiv({
			cls: "ioto-transfer-preview__counts",
			text: counts.join(" · "),
		});
		if (plan.createdPageIds.length > 0) {
			root.createDiv({
				cls: "ioto-transfer-preview__hint",
				text: t("TRANSFER_NEW_PAGES", [String(plan.createdPageIds.length)]),
			});
		}
		if (plan.customFilters.length > 0) {
			const filters = root.createEl("ul");
			for (const filter of plan.customFilters) {
				filters.createEl("li", { text: filter.name });
			}
		}
		if (plan.warnings.length > 0) {
			const box = root.createDiv({ cls: "ioto-transfer-warnings" });
			box.createEl("strong", { text: t("TRANSFER_WARNINGS_TITLE") });
			const list = box.createEl("ul");
			for (const warning of plan.warnings) {
				list.createEl("li", {
					cls: `is-${warning.level}`,
					text: warning.message,
				});
			}
		}
	}

	private async apply(): Promise<void> {
		const plan = this.currentPlan;
		if (!plan) return;
		if (this.options.requireConfirm) {
			new ConfirmModal(
				this.app,
				t("TRANSFER_RESTORE_TITLE"),
				t("TRANSFER_RESTORE_CONFIRM"),
				() => void this.runApply(plan),
			).open();
			return;
		}
		await this.runApply(plan);
	}

	private async runApply(plan: ImportPlan): Promise<void> {
		try {
			await this.options.onApply(plan);
			this.close();
		} catch (error) {
			console.warn("IOTO Dashboard: import failed", error);
			const message =
				error instanceof Error && error.message
					? error.message
					: t("TRANSFER_IMPORT_FAILED");
			new Notice(message);
		}
	}
}
