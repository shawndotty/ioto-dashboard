import type {
	InspectorFocus,
	InspectorState,
	PageInspectorState,
} from "../../dashboard/inspector-service";
import {
	ComponentInspector,
	type ComponentInspectorDeps,
} from "./ComponentInspector";
import { PageInspector, type PageInspectorDeps } from "./PageInspector";

export type InspectorPanelState =
	| (Omit<InspectorState, "focus"> & { focus: InspectorFocus | null })
	| (Omit<PageInspectorState, "focus"> & { focus: InspectorFocus | null });

export interface InspectorPanelDeps {
	component: ComponentInspectorDeps;
	page: PageInspectorDeps;
}

/**
 * Hosts the component and page settings renderers side by side and shows the
 * one matching the current selection, so switching kinds keeps each renderer's
 * state (scroll position, query picker memory) intact.
 */
export class InspectorPanel {
	private componentSlot: HTMLElement;
	private pageSlot: HTMLElement;
	private component: ComponentInspector;
	private page: PageInspector;

	constructor(container: HTMLElement, deps: InspectorPanelDeps) {
		this.componentSlot = container.createDiv({
			cls: "ioto-inspector-slot",
		});
		this.pageSlot = container.createDiv({
			cls: "ioto-inspector-slot is-hidden",
		});
		this.component = new ComponentInspector(
			this.componentSlot,
			deps.component,
		);
		this.page = new PageInspector(this.pageSlot, deps.page);
	}

	render(state: InspectorPanelState): void {
		if (!state) {
			this.componentSlot.toggleClass("is-hidden", false);
			this.pageSlot.toggleClass("is-hidden", true);
			this.component.render(null);
			this.page.render(null);
			return;
		}
		const isPage = state.kind === "page";
		this.componentSlot.toggleClass("is-hidden", isPage);
		this.pageSlot.toggleClass("is-hidden", !isPage);
		if (state.kind === "page") {
			this.page.render(state);
			this.component.render(null);
		} else {
			this.component.render(state);
			this.page.render(null);
		}
	}

	destroy(): void {
		this.component.destroy();
		this.page.destroy();
		this.componentSlot.remove();
		this.pageSlot.remove();
	}
}
