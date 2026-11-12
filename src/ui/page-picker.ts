import { App, FuzzySuggestModal } from "obsidian";
import { t } from "../lang/helpers";
import type { DashboardPage, DashboardWorkspace } from "../dashboard/types";

export interface PageTarget {
	dashboard: DashboardWorkspace;
	page: DashboardPage;
}

/**
 * Target page picker. The caller owns ordering (same dashboard first) and
 * excludes the page the component already lives on.
 */
export class PagePickerModal extends FuzzySuggestModal<PageTarget> {
	constructor(
		app: App,
		private targets: PageTarget[],
		private onChooseTarget: (target: PageTarget) => void,
	) {
		super(app);
		this.setPlaceholder(t("DASHBOARD_MOVE_COMPONENT_PLACEHOLDER"));
	}

	getItems(): PageTarget[] {
		return this.targets;
	}

	getItemText(target: PageTarget): string {
		return `${target.dashboard.name} / ${target.page.name}`;
	}

	onChooseItem(target: PageTarget): void {
		this.onChooseTarget(target);
	}
}
