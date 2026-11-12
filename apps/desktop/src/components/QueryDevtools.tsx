import { lazy, Suspense } from "react";
import classes from "./QueryDevtools.module.css";

// Imported dynamically, and only in dev: in a production build
// `import.meta.env.DEV` is `false`, so the bundler drops the import and the
// devtools never ship. A static import would bundle them even if unrendered.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtools })),
    )
  : null;

/**
 * TanStack Query's devtools (each query's key, status and cached data), in dev
 * builds only. Render inside the `QueryClientProvider`.
 */
export function QueryDevtools() {
  if (!ReactQueryDevtools) return null;
  return (
    // The built-in corner positions sit 12px from the window edge, so the
    // bottom ones would overlap the 44px bottom bar and the top ones the
    // headers' arrows. "relative" lets this wrapper place the button instead.
    <div className={classes.button}>
      <Suspense fallback={null}>
        <ReactQueryDevtools buttonPosition="relative" />
      </Suspense>
    </div>
  );
}
