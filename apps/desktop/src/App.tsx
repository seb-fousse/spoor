import { useEffect, useState } from "react";
import { createTauriDatabase } from "./platform/database";
import "./App.css";

const db = createTauriDatabase();

function App() {
  // A deliberately trivial query through core's `Database` seam. Its only job
  // is to prove the frontend reaches SQLite on the Rust side over IPC.
  // Real features arrive later, behind the platform seams defined in core.
  const [sqlite, setSqlite] = useState("…");

  useEffect(() => {
    db.query<{ v: string }>("SELECT sqlite_version() AS v")
      .then(([row]) => setSqlite(row.v))
      .catch((e: Error) => setSqlite(`error: ${e.message}`));
  }, []);

  return (
    <main className="container">
      <h1>Spoor</h1>
      <p>A local-first personal data tracker. Your data stays on your device.</p>
      <p>
        SQLite: <strong>{sqlite}</strong>
      </p>
      <p>
        <small>Early development — this is a scaffold, not a usable app yet.</small>
      </p>
    </main>
  );
}

export default App;
