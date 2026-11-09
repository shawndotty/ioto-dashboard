const SAFE_SLUG_CHAR = /[A-Za-z0-9_]/;

/**
 * Stable command id for one dashboard. Derived from the dashboard id only (never
 * the name), so renaming a dashboard keeps user-bound hotkeys working.
 *
 * Characters outside `[A-Za-z0-9_]` are escaped as `-<codePoint hex>-`, which is
 * injective and reversible. The `open-ioto-canvas-` prefix keeps the id free of
 * the plugin id substring the lint rule forbids.
 */
export function dashboardCommandId(dashboardId: string): string {
	let slug = "";
	for (const char of dashboardId) {
		slug += SAFE_SLUG_CHAR.test(char)
			? char
			: `-${char.codePointAt(0)!.toString(16)}-`;
	}
	return `open-ioto-canvas-${slug}`;
}
