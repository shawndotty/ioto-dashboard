import { App, ButtonComponent, Modal, TextComponent } from "obsidian";
import { t } from "../lang/helpers";

export interface PageNameModalConfig {
	/** Locale key for the modal title. Defaults to the page rename title. */
	titleKey?: string;
	/** Locale key for the input placeholder. Defaults to the page name one. */
	placeholderKey?: string;
	/** When `true`, an empty value is submitted instead of being rejected. */
	allowEmpty?: boolean;
}

export class PageNameModal extends Modal {
	constructor(
		app: App,
		private initial: string,
		private onSubmit: (name: string) => void,
		private config: PageNameModalConfig = {},
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ioto-page-name-modal");
		contentEl.createEl("h2", {
			text: t(
				(this.config.titleKey ??
					"PAGE_RENAME") as Parameters<typeof t>[0],
			),
		});

		const input = new TextComponent(contentEl)
			.setPlaceholder(
				t(
					(this.config.placeholderKey ??
						"PAGE_NAME_PLACEHOLDER") as Parameters<typeof t>[0],
				),
			)
			.setValue(this.initial);
		input.inputEl.addClass("ioto-page-name-input");
		input.inputEl.focus();
		input.inputEl.select();

		const submit = (): void => {
			const name = input.getValue().trim();
			if (!name && !this.config.allowEmpty) {
				input.inputEl.focus();
				return;
			}
			this.close();
			this.onSubmit(name);
		};

		input.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				submit();
			}
		});

		const buttons = contentEl.createDiv({ cls: "ioto-page-name-buttons" });
		new ButtonComponent(buttons)
			.setButtonText(t("BTN_CANCEL"))
			.onClick(() => this.close());
		new ButtonComponent(buttons)
			.setButtonText(t("BTN_CONFIRM"))
			.setCta()
			.onClick(submit);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
