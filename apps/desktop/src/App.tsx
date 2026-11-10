import { BottomBar } from "@components/BottomBar";
import { useHistoryRoute } from "@hooks/useHistoryRoute";
import { Alert, AppShell, Box, Center, Loader } from "@mantine/core";
import { Analytics } from "@pages/Analytics";
import { Home } from "@pages/Home";
import { Logs } from "@pages/Logs";
import { Observations } from "@pages/Observations";
import { Settings } from "@pages/Settings";
import { Things } from "@pages/Things";
import { Timelines } from "@pages/Timelines";
import { createTauriDatabase } from "@platform/database";
import type { RouteId } from "@routes";
import { type Database, migrate } from "@spoor/core";
import { useEffect, useState } from "react";

const db = createTauriDatabase();
// Started once at module load, not in the effect: StrictMode runs effects
// twice, and two migration runs would interleave on the one shared connection.
const migrated = migrate(db);

function Page({ route, db }: { route: RouteId; db: Database }) {
  switch (route) {
    case "home":
      return <Home db={db} />;
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
    <AppShell footer={{ height: 44 }} padding={0}>
      <AppShell.Main>
        {status === "ready" ? (
          // Home fills the whole area edge to edge; other pages get padding.
          <Box p={route === "home" ? 0 : "md"}>
            <Page route={route} db={db} />
          </Box>
        ) : status === "migrating" ? (
          <Center p="md">
            <Loader />
          </Center>
        ) : (
          <Alert m="md" color="red" title="Could not open the database">
            {status}
          </Alert>
        )}
      </AppShell.Main>

      <AppShell.Footer>
        <BottomBar
          route={route}
          navigate={navigate}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
        />
      </AppShell.Footer>
    </AppShell>
  );
}

export default App;
