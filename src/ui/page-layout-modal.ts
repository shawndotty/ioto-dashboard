import { App, Modal, Setting } from "obsidian";
import { t } from "../lang/helpers";
import { applyModalShell } from "./modal-shell";

export class PageLayoutModal extends Modal {
	private columns: 12 | 24;
	private rowHeight: number;

	constructor(
		app: App,
		initial: { columns?: 12 | 24; rowHeight?: number },
		private onSave: (columns: 12 | 24, rowHeight: number) => void,
	) {
		super(app);
		this.columns = initial.columns === 24 ? 24 : 12;
		this.rowHeight = initial.rowHeight ?? 72;
	}

	onOpen(): void {
		applyModalShell(this, {
			kind: "page-layout",
			restore: true,
			title: t("PAGE_LAYOUT_TITLE"),
		});

		const body = this.contentEl.createDiv({ cls: "ioto-modal-body" });

		new Setting(body)
			.setName(t("PAGE_LAYOUT_COLUMNS"))
			.setDesc(t("PAGE_LAYOUT_COLUMNS_DESC"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("12", t("PAGE_LAYOUT_COLUMNS_12"))
					.addOption("24", t("PAGE_LAYOUT_COLUMNS_24"))
					.setValue(String(this.columns))
					.onChange((value) => {
						this.columns = value === "24" ? 24 : 12;
					}),
			);

		new Setting(body)
			.setName(t("PAGE_LAYOUT_ROW_HEIGHT"))
			.setDesc(t("PAGE_LAYOUT_ROW_HEIGHT_DESC"))
			.addSlider((slider) =>
				slider
					.setLimits(40, 200, 8)
					.setValue(this.rowHeight)
					.setDynamicTooltip()
					.onChange((value) => {
						this.rowHeight = Math.round(value);
					}),
			);

		const footer = this.contentEl.createDiv({ cls: "ioto-modal-footer" });
		new Setting(footer)
			.addButton((button) =>
				button
					.setButtonText(t("BTN_CANCEL"))
					.onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText(t("QUERY_SAVE"))
					.setCta()
					.onClick(() => {
						this.onSave(this.columns, this.rowHeight);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
