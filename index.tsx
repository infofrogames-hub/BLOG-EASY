import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Se NON vuoi un file CSS, puoi commentare questa riga.
// Se lo vuoi, crea "index.css" nella stessa cartella di questo file.
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
