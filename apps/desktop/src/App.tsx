import { isNonEmptyString } from "@spoor/core";
import "./App.css";

function App() {
  // A deliberately trivial call into @spoor/core. Its only job is to prove that
  // the app actually resolves and runs code from the shared core package.
  // Real features arrive later, behind the platform seams defined in core.
  const coreLinked = isNonEmptyString("spoor");

  return (
    <main className="container">
      <h1>Spoor</h1>
      <p>A local-first personal data tracker. Your data stays on your device.</p>
      <p>
        <code>@spoor/core</code> linked: <strong>{coreLinked ? "yes" : "no"}</strong>
      </p>
      <p>
        <small>Early development — this is a scaffold, not a usable app yet.</small>
      </p>
    </main>
  );
}

export default App;
