import { App, ButtonComponent, Modal, TextComponent } from "obsidian";
import { t } from "../lang/helpers";

export class PageNameModal extends Modal {
	constructor(
		app: App,
		private initial: string,
		private onSubmit: (name: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ioto-page-name-modal");
		contentEl.createEl("h2", { text: t("PAGE_RENAME") });

		const input = new TextComponent(contentEl)
			.setPlaceholder(t("PAGE_NAME_PLACEHOLDER"))
			.setValue(this.initial);
		input.inputEl.addClass("ioto-page-name-input");
		input.inputEl.focus();
		input.inputEl.select();

		const submit = (): void => {
			const name = input.getValue().trim();
			if (!name) {
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
