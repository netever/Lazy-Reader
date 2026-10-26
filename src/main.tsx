import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { perfMark } from "./api";
import "./styles.css";

perfMark("js_start");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
