import { App, Modal, Notice, setIcon } from "obsidian";
import { t } from "../lang/helpers";
import {
	fetchTemplateJson,
	listTemplates,
	reload,
	TemplateHttpError,
	type TemplateMeta,
	type TemplateSource,
} from "../dashboard/template-center";
import { applyModalShell } from "./modal-shell";

export type TemplateImportHandler = (json: string, name: string) => void;

const SOURCES: readonly TemplateSource[] = ["gitee", "github"];

function kindLabel(kind: string): string {
	switch (kind) {
		case "ioto-dashboard-page":
			return t("TEMPLATE_CENTER_KIND_PAGE");
		case "ioto-dashboard":
			return t("TEMPLATE_CENTER_KIND_DASHBOARD");
		case "ioto-dashboard-query":
			return t("TEMPLATE_CENTER_KIND_QUERY");
		default:
			return kind;
	}
}

/** Browse remote templates and hand the chosen bundle JSON to the caller. */
export class TemplateCenterModal extends Modal {
	private source: TemplateSource = "gitee";
	private state: "loading" | "ready" | "error" = "loading";
	private templates: TemplateMeta[] = [];
	private error = "";
	private rateLimited = false;
	private cooldownUntil = 0;
	private listEl: HTMLElement | null = null;
	private loadSeq = 0;
	private readonly sourceButtons = new Map<TemplateSource, HTMLButtonElement>();

	constructor(
		app: App,
		private readonly onImport: TemplateImportHandler,
	) {
		super(app);
	}

	onOpen(): void {
		applyModalShell(this, {
			kind: "template-center",
			title: t("TEMPLATE_CENTER_TITLE"),
			allowFullscreen: true,
		});
		this.source = "gitee";
		this.error = "";
		this.rateLimited = false;
		this.cooldownUntil = 0;
		this.templates = [];
		this.state = "loading";

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ioto-template-center");

		this.renderSourceSwitch();
		this.listEl = contentEl.createDiv({
			cls: "ioto-template-center__list",
		});
		this.renderSource();
		this.renderList();
		void this.loadList();
	}

	private renderSourceSwitch(): void {
		const group = this.titleEl.createDiv({
			cls: "ioto-template-center__source",
		});
		group.setAttribute("role", "group");
		group.setAttribute("aria-label", t("TEMPLATE_CENTER_SOURCE_LABEL"));

		for (const source of SOURCES) {
			const button = group.createEl("button", {
				cls: "clickable-icon",
				attr: { type: "button" },
			});
			button.addEventListener("click", () => {
				if (this.source === source) return;
				this.source = source;
				this.renderSource();
				void this.loadList();
			});
			this.sourceButtons.set(source, button);
		}

		const reloadButton = group.createEl("button", {
			cls: "clickable-icon ioto-template-center__reload",
			attr: { type: "button" },
		});
		setIcon(reloadButton, "refresh-cw");
		const reloadLabel = t("TEMPLATE_CENTER_RELOAD");
		reloadButton.setAttribute("aria-label", reloadLabel);
		reloadButton.setAttribute("title", reloadLabel);
		reloadButton.addEventListener("click", () => {
			reload(this.source);
			void this.loadList();
		});

		const tools = this.titleEl.querySelector(
			".ioto-dashboard-modal__tools",
		);
		if (tools) tools.prepend(group);
	}

	private renderSource(): void {
		for (const [source, button] of this.sourceButtons) {
			const label =
				source === "gitee"
					? t("TEMPLATE_CENTER_SOURCE_GITEE")
					: t("TEMPLATE_CENTER_SOURCE_GITHUB");
			button.setText(source === "gitee" ? "Gitee" : "GitHub");
			button.setAttribute("aria-label", label);
			button.setAttribute("title", label);
			button.setAttribute("aria-pressed", source === this.source ? "true" : "false");
			button.toggleClass("is-active", source === this.source);
		}
	}

	private async loadList(): Promise<void> {
		const seq = ++this.loadSeq;
		this.state = "loading";
		this.renderList();
		try {
			const templates = await listTemplates(this.source);
			if (seq !== this.loadSeq) return;
			this.templates = templates;
			this.error = "";
			this.rateLimited = false;
			this.cooldownUntil = 0;
			this.state = "ready";
		} catch (error) {
			if (seq !== this.loadSeq) return;
			this.error =
				error instanceof Error ? error.message : t("TEMPLATE_CENTER_ERROR");
			this.rateLimited =
				error instanceof TemplateHttpError && error.rateLimited;
			if (
				this.rateLimited &&
				error instanceof TemplateHttpError &&
				error.retryAfterSec != null
			) {
				this.cooldownUntil = Date.now() + error.retryAfterSec * 1000;
			} else {
				this.cooldownUntil = 0;
			}
			this.state = "error";
		}
		this.renderList();
	}

	private renderList(): void {
		const root = this.listEl;
		if (!root) return;
		root.empty();
		if (this.state === "loading") {
			root.createDiv({
				cls: "ioto-template-center__placeholder",
				text: t("TEMPLATE_CENTER_LOADING"),
			});
			return;
		}
		if (this.state === "error") {
			const box = root.createDiv({ cls: "ioto-template-center__placeholder is-error" });
			const remaining = Math.max(
				0,
				Math.ceil((this.cooldownUntil - Date.now()) / 1000),
			);
			if (this.rateLimited) {
				const other = this.source === "gitee" ? "GitHub" : "Gitee";
				box.createSpan({
					text: t("TEMPLATE_CENTER_ERROR_RATE_LIMITED", [other]),
				});
				if (this.cooldownUntil > 0 && remaining > 0) {
					box.createSpan({
						cls: "ioto-template-center__retry-after",
						text: t("TEMPLATE_CENTER_ERROR_RETRY_AFTER", [
							String(remaining),
						]),
					});
				}
				const switchButton = box.createEl("button", {
					cls: "ioto-template-center__switch-source",
					text: t("TEMPLATE_CENTER_ERROR_SWITCH_SOURCE", [other]),
					attr: { type: "button" },
				});
				switchButton.addEventListener("click", () => {
					this.source = this.source === "gitee" ? "github" : "gitee";
					this.renderSource();
					void this.loadList();
				});
			} else {
				box.createSpan({ text: t("TEMPLATE_CENTER_ERROR") });
				if (this.error) {
					box.createEl("small", { text: this.error });
				}
			}
			const retry = box.createEl("button", {
				cls: "ioto-template-center__retry",
				text: t("TEMPLATE_CENTER_RETRY"),
				attr: { type: "button" },
			});
			if (this.rateLimited && remaining > 0) {
				retry.disabled = true;
				retry.setAttribute(
					"title",
					t("TEMPLATE_CENTER_ERROR_RETRY_AFTER", [String(remaining)]),
				);
			} else {
				retry.addEventListener("click", () => void this.loadList());
			}
			return;
		}
		if (this.templates.length === 0) {
			root.createDiv({
				cls: "ioto-template-center__placeholder",
				text: t("TEMPLATE_CENTER_EMPTY"),
			});
			return;
		}
		for (const meta of this.templates) {
			this.renderCard(root, meta);
		}
	}

	private renderCard(root: HTMLElement, meta: TemplateMeta): void {
		const card = root.createDiv({ cls: "ioto-template-center__card" });
		if (!meta.supported) card.addClass("is-disabled");

		const info = card.createDiv({ cls: "ioto-template-center__card-info" });
		info.createDiv({ cls: "ioto-template-center__card-name", text: meta.name });
		if (meta.description) {
			info.createDiv({
				cls: "ioto-template-center__card-description",
				text: meta.description,
			});
		} else if (meta.subtitle) {
			info.createDiv({
				cls: "ioto-template-center__card-subtitle",
				text: meta.subtitle,
			});
		}
		info.createSpan({
			cls: "ioto-template-center__badge",
			text: kindLabel(meta.kind),
		});

		const importButton = card.createEl("button", {
			cls: "ioto-template-center__import",
			text: t("TEMPLATE_CENTER_IMPORT"),
			attr: { type: "button" },
		});
		if (!meta.supported) {
			importButton.disabled = true;
			importButton.setAttribute("title", t("TEMPLATE_CENTER_UNSUPPORTED"));
		} else {
			importButton.addEventListener("click", () => {
				void this.importTemplate(meta);
			});
		}
	}

	private async importTemplate(meta: TemplateMeta): Promise<void> {
		try {
			const json = await fetchTemplateJson(this.source, meta.key);
			this.onImport(json, meta.name);
		} catch (error) {
			console.warn("IOTO Dashboard: template fetch failed", error);
			new Notice(t("TEMPLATE_CENTER_FETCH_FAILED"));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
