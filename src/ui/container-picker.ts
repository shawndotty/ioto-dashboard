import { App, FuzzySuggestModal } from "obsidian";
import { t } from "../lang/helpers";

export interface ContainerTarget {
	id: string;
	label: string;
}

/** Picks one page-level container by its display name. */
export class ContainerPickerModal extends FuzzySuggestModal<ContainerTarget> {
	constructor(
		app: App,
		private targets: ContainerTarget[],
		private onChooseTarget: (target: ContainerTarget) => void,
	) {
		super(app);
		this.setPlaceholder(t("DASHBOARD_CONTAINER_PICKER_PLACEHOLDER"));
	}

	getItems(): ContainerTarget[] {
		return this.targets;
	}

	getItemText(target: ContainerTarget): string {
		return target.label;
	}

	onChooseItem(target: ContainerTarget): void {
		this.onChooseTarget(target);
	}
}
