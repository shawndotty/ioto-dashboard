import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "../../lang/helpers";

export class BaseFilePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private onChooseBase: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(t("PICKER_BASE_PLACEHOLDER"));
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((file) => file.extension.toLowerCase() === "base")
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChooseBase(file);
	}

	onNoSuggestion(): void {
		this.resultContainerEl.empty();
		this.resultContainerEl.createDiv({
			cls: "suggestion-empty",
			text: t("PICKER_NO_BASE_FILES"),
		});
	}
}

export interface BaseViewChoice {
	/** Raw `views[].name`; empty string means "follow the file default". */
	name: string;
	label: string;
}

export class BaseViewPickerModal extends FuzzySuggestModal<BaseViewChoice> {
	constructor(
		app: App,
		private choices: BaseViewChoice[],
		private onChooseView: (name: string) => void,
	) {
		super(app);
		this.setPlaceholder(t("PICKER_BASE_VIEW_PLACEHOLDER"));
	}

	getItems(): BaseViewChoice[] {
		return this.choices;
	}

	getItemText(choice: BaseViewChoice): string {
		return choice.label;
	}

	onChooseItem(choice: BaseViewChoice): void {
		this.onChooseView(choice.name);
	}
}