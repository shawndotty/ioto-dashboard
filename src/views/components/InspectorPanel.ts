import type {
	InspectorFocus,
	InspectorState,
	PageInspectorState,
	PagesInspectorState,
} from "../../dashboard/inspector-service";
import {
	ComponentInspector,
	type ComponentInspectorDeps,
} from "./ComponentInspector";
import { PageInspector, type PageInspectorDeps } from "./PageInspector";
import { PagesInspector, type PagesInspectorDeps } from "./PagesInspector";

export type InspectorPanelState =
	| (Omit<InspectorState, "focus"> & { focus: InspectorFocus | null })
	| (Omit<PageInspectorState, "focus"> & { focus: InspectorFocus | null })
	| (Omit<PagesInspectorState, "focus"> & { focus: InspectorFocus | null });

export interface InspectorPanelDeps {
	component: ComponentInspectorDeps;
	page: PageInspectorDeps;
	pages: PagesInspectorDeps;
}

/**
 * Hosts the component, page and pages renderers side by side and shows the one
 * matching the current selection, so switching kinds keeps each renderer's
 * state (scroll position, query picker memory) intact.
 */
export class InspectorPanel {
	private componentSlot: HTMLElement;
	private pageSlot: HTMLElement;
	private pagesSlot: HTMLElement;
	private component: ComponentInspector;
	private page: PageInspector;
	private pages: PagesInspector;

	constructor(container: HTMLElement, deps: InspectorPanelDeps) {
		this.componentSlot = container.createDiv({
			cls: "ioto-inspector-slot",
		});
		this.pageSlot = container.createDiv({
			cls: "ioto-inspector-slot is-hidden",
		});
		this.pagesSlot = container.createDiv({
			cls: "ioto-inspector-slot is-hidden",
		});
		this.component = new ComponentInspector(
			this.componentSlot,
			deps.component,
		);
		this.page = new PageInspector(this.pageSlot, deps.page);
		this.pages = new PagesInspector(this.pagesSlot, deps.pages);
	}

	render(state: InspectorPanelState): void {
		if (!state) {
			this.componentSlot.toggleClass("is-hidden", false);
			this.pageSlot.toggleClass("is-hidden", true);
			this.pagesSlot.toggleClass("is-hidden", true);
			this.component.render(null);
			this.page.render(null);
			this.pages.render(null);
			return;
		}
		const kind = state.kind;
		this.componentSlot.toggleClass("is-hidden", kind !== "component");
		this.pageSlot.toggleClass("is-hidden", kind !== "page");
		this.pagesSlot.toggleClass("is-hidden", kind !== "pages");
		if (kind === "page") {
			this.page.render(state);
			this.component.render(null);
			this.pages.render(null);
		} else if (kind === "pages") {
			this.pages.render(state);
			this.component.render(null);
			this.page.render(null);
		} else {
			this.component.render(state);
			this.page.render(null);
			this.pages.render(null);
		}
	}

	destroy(): void {
		this.component.destroy();
		this.page.destroy();
		this.pages.destroy();
		this.componentSlot.remove();
		this.pageSlot.remove();
		this.pagesSlot.remove();
	}
}
