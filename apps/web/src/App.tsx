import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./layout/AppShell";
import { PublicLayout } from "./layout/PublicLayout";
import { Admin } from "./pages/Admin";
import { Billing } from "./pages/Billing";
import { Dashboard } from "./pages/Dashboard";
import { Demo } from "./pages/Demo";
import { Home } from "./pages/Home";
import { Inventory } from "./pages/Inventory";
import { Login } from "./pages/Login";
import { Privacy } from "./pages/Privacy";
import { Pricing } from "./pages/Pricing";
import { PricingList } from "./pages/PricingList";
import { Procurement } from "./pages/Procurement";
import { Settings } from "./pages/Settings";
import { SignUp } from "./pages/SignUp";
import { Terms } from "./pages/Terms";

export function App() {
  return (
    <Routes>
      {/* Public pages: minimalist black */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/demo" element={<Demo />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
      </Route>

      {/* Authenticated app: glass over nature */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/inventory" element={<Inventory />} />
          <Route path="/app/pricing" element={<PricingList />} />
          <Route path="/app/pricing/:variantId" element={<Pricing />} />
          <Route path="/app/procurement" element={<Procurement />} />
          <Route path="/app/billing" element={<Billing />} />
          <Route path="/app/settings" element={<Settings />} />
          <Route path="/app/admin" element={<Admin />} />
        </Route>
      </Route>
    </Routes>
  );
}
