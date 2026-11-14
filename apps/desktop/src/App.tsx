import { BottomBar } from "@components/BottomBar";
import { useHistoryRoute } from "@hooks/useHistoryRoute";
import { Alert, AppShell, Box, Center, Loader } from "@mantine/core";
import { Analytics } from "@pages/Analytics";
import { Home, HomeStateProvider } from "@pages/Home";
import { Logs } from "@pages/Logs";
import { Observations } from "@pages/Observations";
import { Settings } from "@pages/Settings";
import { Things } from "@pages/Things";
import { Timelines } from "@pages/Timelines";
import { DatabaseProvider } from "@platform/DatabaseProvider";
import { createTauriDatabase } from "@platform/database";
import type { RouteId } from "@routes";
import { migrate } from "@spoor/core";
import { useEffect, useState } from "react";

const db = createTauriDatabase();
// Started once at module load, not in the effect: StrictMode runs effects
// twice, and two migration runs would interleave on the one shared connection.
const migrated = migrate(db);

function Page({ route }: { route: RouteId }) {
  switch (route) {
    case "home":
      return <Home />;
    case "analytics":
      return <Analytics />;
    case "timelines":
      return <Timelines />;
    case "observations":
      return <Observations />;
    case "logs":
      return <Logs />;
    case "things":
      return <Things />;
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
          <DatabaseProvider db={db}>
            {/* Above the routes, so Home's active day and window survive navigation. */}
            <HomeStateProvider>
              {/* Home fills the whole area edge to edge; other pages get padding. */}
              <Box p={route === "home" ? 0 : "md"}>
                <Page route={route} />
              </Box>
            </HomeStateProvider>
          </DatabaseProvider>
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
