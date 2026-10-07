import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { PlanProvider } from "./plan/PlanContext";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installErrorReporting } from "./lib/errorReporter";
import "./styles/tokens.css";
import "./styles/layout.css";

installErrorReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PlanProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </PlanProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
