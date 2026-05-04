import React from "react";
import ReactDOM from "react-dom/client";
import "normalize.css/normalize.css";
import "@blueprintjs/core/lib/css/blueprint.css";
import "./styles.css";
import { App } from "./App";
import { ThemeProvider } from "./context/ThemeContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
