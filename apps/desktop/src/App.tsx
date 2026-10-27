import { migrate } from "@spoor/core";
import { useEffect, useState } from "react";
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

  return (
    <main className="container">
      <h1>Spoor</h1>
      <p>A local-first personal data tracker. Your data stays on your device.</p>
      <p>
        <small>Early development — this is a scaffold, not a usable app yet.</small>
      </p>
      {status === "ready" ? <Timelines db={db} /> : <p>{status}</p>}
      {status === "ready" && <Things db={db} />}
    </main>
  );
}

export default App;
