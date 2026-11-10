import { ActionIcon, Group, Tabs } from "@mantine/core";
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
      <Group gap={0} className={classes.history} wrap="nowrap">
        <ActionIcon
          aria-label="Back"
          className={classes.historyButton}
          disabled={!canGoBack}
          onClick={() => window.history.back()}
        >
          ‹
        </ActionIcon>
        <ActionIcon
          aria-label="Forward"
          className={classes.historyButton}
          disabled={!canGoForward}
          onClick={() => window.history.forward()}
        >
          ›
        </ActionIcon>
      </Group>

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
