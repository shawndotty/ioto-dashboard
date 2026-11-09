import type { QueryDefinition } from "../query/types";
import type {
	ComponentDefinition,
	SizeBounds,
} from "./registry";
import type { DashboardComponentConfig } from "./types";

export type InspectorHost = "auto" | "sidebar" | "inline";

export type InspectorFocus = "title" | "first";

export interface InspectorSelection {
	/** The canvas view that made the selection; used to scope `clear()`. */
	leafId: string;
	pageId: string;
	componentId: string;
}

export interface InspectorTarget {
	pageName: string;
	index: number;
	total: number;
	config: Readonly<DashboardComponentConfig>;
	/** `undefined` = unregistered type (renders "unknown component", read-only). */
	definition: ComponentDefinition | undefined;
	bounds: SizeBounds;
	defaults: { w: number; h: number };
}

export interface InspectorController {
	leafId: string;
	isEditable(): boolean;
	getTarget(): InspectorTarget | null;
	listQueries(): QueryDefinition[];
	queriesVersion(): number;
	patch(patch: Partial<DashboardComponentConfig>): void;
	stepSize(axis: "w" | "h", direction: -1 | 1): void;
	resetSize(): void;
	move(offset: -1 | 1): void;
	remove(): void;
}

export interface InspectorState {
	editable: boolean;
	target: InspectorTarget;
	queries: QueryDefinition[];
	queriesVersion: number;
	focus: InspectorFocus | null;
}

export function resolveInspectorHost(
	host: InspectorHost,
	isMobile: boolean,
): "sidebar" | "inline" {
	if (host === "auto") return isMobile ? "inline" : "sidebar";
	return host;
}

/**
 * Session-only selection bus between a dashboard canvas and the inspector panel.
 * Last selection wins; nothing is persisted or written to the workspace layout.
 */
export class DashboardInspectorService {
	private selection: InspectorSelection | null = null;
	private controller: InspectorController | null = null;
	private pendingFocus: InspectorFocus | null = null;
	private listeners = new Set<() => void>();

	select(
		selection: InspectorSelection,
		controller: InspectorController,
		options?: { focus?: InspectorFocus },
	): void {
		this.selection = { ...selection };
		this.controller = controller;
		this.pendingFocus = options?.focus ?? null;
		this.notify();
	}

	/** Re-pushes the current target after the canvas re-rendered its data. */
	refresh(): void {
		if (!this.selection || !this.controller) return;
		if (!this.controller.getTarget()) {
			this.selection = null;
			this.controller = null;
			this.pendingFocus = null;
		}
		this.notify();
	}

	/** Without `leafId` clears everything; with it, only that canvas' selection. */
	clear(leafId?: string): void {
		if (leafId !== undefined && this.selection?.leafId !== leafId) return;
		const hadSelection = this.selection !== null;
		this.selection = null;
		this.controller = null;
		this.pendingFocus = null;
		if (hadSelection || leafId === undefined) this.notify();
	}

	consumeFocus(): InspectorFocus | null {
		const focus = this.pendingFocus;
		this.pendingFocus = null;
		return focus;
	}

	current(): {
		selection: InspectorSelection;
		controller: InspectorController;
	} | null {
		if (!this.selection || !this.controller) return null;
		return { selection: this.selection, controller: this.controller };
	}

	snapshot(): Omit<InspectorState, "focus"> | null {
		if (!this.selection || !this.controller) return null;
		const target = this.controller.getTarget();
		if (!target) return null;
		return {
			editable: this.controller.isEditable(),
			target,
			queries: this.controller.listQueries(),
			queriesVersion: this.controller.queriesVersion(),
		};
	}

	subscribe(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	private notify(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
