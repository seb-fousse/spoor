// Mantine's CSS goes into the `mantine` CSS layer, so the app's own (unlayered)
// CSS always overrides it, whatever the import order or selector specificity.
import "@mantine/core/styles.layer.css";
import "@mantine/dates/styles.layer.css";
import "./theme/global.css";
import { createQueryClient } from "@lib/queryClient";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { cssVariablesResolver, theme } from "@theme";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const queryClient = createQueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        defaultColorScheme="auto"
      >
        <App />
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
