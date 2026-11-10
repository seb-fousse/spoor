import { ArrowButtons } from "@components/ArrowButtons";
import { Tabs } from "@mantine/core";
import { type RouteId, routes } from "@routes";
import classes from "./BottomBar.module.css";

interface BottomBarProps {
  route: RouteId;
  navigate: (route: RouteId) => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Bottom navigation: history back/forward, then one tab per route. */
export function BottomBar({ route, navigate, canGoBack, canGoForward }: BottomBarProps) {
  return (
    <div className={classes.bar}>
      <ArrowButtons
        backLabel="Back"
        forwardLabel="Forward"
        onBack={() => window.history.back()}
        onForward={() => window.history.forward()}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />

      <Tabs
        inverted
        className={classes.tabs}
        value={route}
        onChange={(value) => value && navigate(value as RouteId)}
      >
        <Tabs.List justify="flex-start">
          {routes.map(({ id, label }) => (
            <Tabs.Tab key={id} value={id}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
    </div>
  );
}
