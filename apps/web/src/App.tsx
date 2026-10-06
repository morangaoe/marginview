import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./layout/AppShell";
import { PublicLayout } from "./layout/PublicLayout";
import { Admin } from "./pages/Admin";
import { Billing } from "./pages/Billing";
import { Dashboard } from "./pages/Dashboard";
import { Demo } from "./pages/Demo";
import { Home } from "./pages/Home";
import Inventory from "./pages/Inventory";
import { Login } from "./pages/Login";
import { Privacy } from "./pages/Privacy";
import Pricing from "./pages/Pricing";
import { PricingList } from "./pages/PricingList";
import { Procurement } from "./pages/Procurement";
import { Settings } from "./pages/Settings";
import { SignUp } from "./pages/SignUp";
import { Terms } from "./pages/Terms";
import Reports from "./pages/Reports";
import Suppliers from "./pages/Suppliers";
import PurchaseOrders from "./pages/PurchaseOrders";
import SkuDetail from "./pages/SkuDetail";
import PriceHistory from "./pages/PriceHistory";
import CompetitorSources from "./pages/CompetitorSources";
import Notifications from "./pages/Notifications";
import Onboarding from "./pages/Onboarding";
import Contact from "./pages/Contact";
import Competitors from "./pages/Competitors";
import { RequireModule } from "./plan/RequireModule";

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
        <Route path="/contact" element={<Contact />} />
      </Route>

      {/* Authenticated app: glass over nature */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/app" element={<Dashboard />} />
          <Route element={<RequireModule module="inventory" />}>
            <Route path="/app/inventory" element={<Inventory />} />
            <Route path="/app/inventory/:skuId" element={<SkuDetail />} />
          </Route>
          <Route path="/app/pricing" element={<PricingList />} />
          <Route path="/app/pricing/:variantId" element={<Pricing />} />
          <Route path="/app/pricing/:productId/history" element={<PriceHistory />} />
          <Route path="/app/competitors" element={<Competitors />} />
          <Route element={<RequireModule module="procurement" />}>
            <Route path="/app/procurement" element={<Procurement />} />
            <Route path="/app/procurement/orders" element={<PurchaseOrders />} />
            <Route path="/app/procurement/suppliers" element={<Suppliers />} />
          </Route>
          <Route path="/app/reports" element={<Reports />} />
          <Route path="/app/notifications" element={<Notifications />} />
          <Route path="/app/onboarding" element={<Onboarding />} />
          <Route path="/app/billing" element={<Billing />} />
          <Route path="/app/settings" element={<Settings />} />
          <Route path="/app/settings/competitor-sources" element={<CompetitorSources />} />
          <Route path="/app/admin" element={<Admin />} />
        </Route>
      </Route>
    </Routes>
  );
}