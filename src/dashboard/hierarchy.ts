import type { DashboardComponentConfig } from "./types";

/** First version only allows "page → container → child" (three levels). */
export const MAX_CONTAINER_DEPTH = 1;

export interface ComponentLocation {
	config: DashboardComponentConfig;
	/** `null` for page-level components. */
	parent: DashboardComponentConfig | null;
	/** The array the component actually lives in (page list or container). */
	siblings: DashboardComponentConfig[];
	index: number;
	depth: number;
}

function walkInto(
	components: readonly DashboardComponentConfig[],
	depth: number,
	parent: DashboardComponentConfig | null,
	out: ComponentLocation[],
): void {
	const siblings = components as DashboardComponentConfig[];
	for (let index = 0; index < components.length; index += 1) {
		const config = components[index]!;
		out.push({ config, parent, siblings, index, depth });
		if (
			depth < MAX_CONTAINER_DEPTH &&
			Array.isArray(config.children) &&
			config.children.length > 0
		) {
			walkInto(config.children, depth + 1, config, out);
		}
	}
}

/** Depth-first list of every reachable component, parents before children. */
export function walkComponents(
	components: readonly DashboardComponentConfig[],
	depth = 0,
): ComponentLocation[] {
	const out: ComponentLocation[] = [];
	walkInto(components, depth, null, out);
	return out;
}

export function findComponentLocation(
	components: readonly DashboardComponentConfig[],
	id: string,
): ComponentLocation | null {
	for (const location of walkComponents(components)) {
		if (location.config.id === id) return location;
	}
	return null;
}

/** Unique ids across the whole tree (duplicates from dirty data collapse). */
export function collectComponentIds(
	components: readonly DashboardComponentConfig[],
): string[] {
	const ids = new Set<string>();
	for (const location of walkComponents(components)) {
		ids.add(location.config.id);
	}
	return [...ids];
}

/**
 * Deep copy that re-generates every descendant id. `nextId(depth)` must return
 * a globally unique id and register it in the caller's taken set.
 */
export function cloneWithFreshIds(
	component: DashboardComponentConfig,
	nextId: (depth: number) => string,
	depth = 0,
): DashboardComponentConfig {
	const copy = structuredClone(component);
	copy.id = nextId(depth);
	if (Array.isArray(copy.children)) {
		if (depth < MAX_CONTAINER_DEPTH) {
			copy.children = copy.children.map((child) =>
				cloneWithFreshIds(child, nextId, depth + 1),
			);
		} else {
			delete copy.children;
		}
	}
	return copy;
}

/** True when `targetId` is the component itself or inside its subtree. */
export function containsComponent(
	component: DashboardComponentConfig,
	targetId: string,
): boolean {
	if (component.id === targetId) return true;
	if (!Array.isArray(component.children)) return false;
	return component.children.some((child) =>
		containsComponent(child, targetId),
	);
}
