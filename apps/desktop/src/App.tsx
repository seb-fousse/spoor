import { Alert, AppShell, Center, Loader, Text, Title } from "@mantine/core";
import { migrate } from "@spoor/core";
import { useEffect, useState } from "react";
import { Logs } from "./Logs";
import { Observations } from "./Observations";
import { createTauriDatabase } from "./platform/database";
import { Things } from "./Things";
import { Timelines } from "./Timelines";
import "./App.css";

const db = createTauriDatabase();
// Started once at module load, not in the effect: StrictMode runs effects
// twice, and two migration runs would interleave on the one shared connection.
const migrated = migrate(db);

function App() {
  // "migrating", "ready", or the migration error.
  const [status, setStatus] = useState("migrating");

  useEffect(() => {
    migrated.then(() => setStatus("ready")).catch((e: Error) => setStatus(`error: ${e.message}`));
  }, []);

  // A navbar for switching screens goes here once there is more than one.
  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header px="md" style={{ display: "flex", alignItems: "center" }}>
        <Title order={3}>Spoor</Title>
      </AppShell.Header>

      <AppShell.Main>
        <Text c="dimmed" size="sm" mb="md">
          Early development — this is a scaffold, not a usable app yet. Your data stays on your
          device.
        </Text>
        {status === "ready" ? (
          <Timelines db={db} />
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
    </AppShell>
  );
}

export default App;
