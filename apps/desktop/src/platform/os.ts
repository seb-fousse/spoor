/**
 * Whether the app is running on macOS, read once at startup. The webview's
 * user agent follows the OS it runs on, so this is reliable in the desktop
 * app; it is false outside a browser (tests in Node).
 */
export const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
