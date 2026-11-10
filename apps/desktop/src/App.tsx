import { useHistoryRoute } from "@hooks/useHistoryRoute";
import {
  ActionIcon,
  Alert,
  AppShell,
  Center,
  Group,
  Loader,
  Tabs,
  Title,
  Tooltip,
} from "@mantine/core";
import { Analytics } from "@pages/Analytics";
import { Home } from "@pages/Home";
import { Logs } from "@pages/Logs";
import { Observations } from "@pages/Observations";
import { Settings } from "@pages/Settings";
import { Things } from "@pages/Things";
import { Timelines } from "@pages/Timelines";
import { createTauriDatabase } from "@platform/database";
import { type RouteId, routes } from "@routes";
import { type Database, migrate } from "@spoor/core";
import { useEffect, useState } from "react";

const db = createTauriDatabase();
// Started once at module load, not in the effect: StrictMode runs effects
// twice, and two migration runs would interleave on the one shared connection.
const migrated = migrate(db);

function Page({ route, db }: { route: RouteId; db: Database }) {
  switch (route) {
    case "home":
      return <Home />;
    case "analytics":
      return <Analytics />;
    case "timelines":
      return <Timelines db={db} />;
    case "observations":
      return <Observations db={db} />;
    case "logs":
      return <Logs db={db} />;
    case "things":
      return <Things db={db} />;
    case "settings":
      return <Settings />;
  }
}

function App() {
  // "migrating", "ready", or the migration error.
  const [status, setStatus] = useState("migrating");
  const { route, navigate, canGoBack, canGoForward } = useHistoryRoute();

  useEffect(() => {
    migrated.then(() => setStatus("ready")).catch((e: Error) => setStatus(`error: ${e.message}`));
  }, []);

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header px="md">
        <Group h="100%" gap="xs">
          <Tooltip label="Back">
            <ActionIcon
              aria-label="Back"
              disabled={!canGoBack}
              onClick={() => window.history.back()}
            >
              ‹
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Forward">
            <ActionIcon
              aria-label="Forward"
              disabled={!canGoForward}
              onClick={() => window.history.forward()}
            >
              ›
            </ActionIcon>
          </Tooltip>
          <Title order={3} ml="xs">
            Spoor
          </Title>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        {status === "ready" ? (
          <Page route={route} db={db} />
        ) : status === "migrating" ? (
          <Center>
            <Loader />
          </Center>
        ) : (
          <Alert color="red" title="Could not open the database">
            {status}
          </Alert>
        )}
      </AppShell.Main>

      <AppShell.Footer>
        <Tabs inverted value={route} onChange={(value) => value && navigate(value as RouteId)}>
          <Tabs.List justify="flex-start">
            {routes.map(({ id, label }) => (
              <Tabs.Tab key={id} value={id}>
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </AppShell.Footer>
    </AppShell>
  );
}

export default App;
