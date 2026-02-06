import { App, FuzzySuggestModal } from "obsidian";
import { t } from "../../lang/helpers";

export class PropertyPickerModal extends FuzzySuggestModal<string> {
	private onChoose: (property: string) => void;

	constructor(app: App, onChoose: (property: string) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder(t("FILTER_NAME_PLACEHOLDER"));
	}

	getItems(): string[] {
		const allProperties = new Set<string>();
		
		// Try to use the new API if available
		// @ts-ignore
		if (this.app.metadataCache.getAllPropertyInfos) {
			// @ts-ignore
			const infos = this.app.metadataCache.getAllPropertyInfos();
			Object.keys(infos).forEach(key => allProperties.add(key));
			return Array.from(allProperties).sort((a, b) => a.localeCompare(b));
		}

		// Fallback: iterate all markdown files
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter) {
				Object.keys(cache.frontmatter).forEach((key) => {
					if (key !== "position") {
						allProperties.add(key);
					}
				});
			}
		}
		return Array.from(allProperties).sort((a, b) => a.localeCompare(b));
	}

	getItemText(item: string): string {
		return item;
	}

	onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(item);
	}
}
