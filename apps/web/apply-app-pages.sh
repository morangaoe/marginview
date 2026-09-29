#!/usr/bin/env bash
# Run from apps/web. Edits the EXISTING app pages in place (safe to re-run).
set -e
cd src/pages

# 1. Remove the grey sub-line under each page <h1>
for f in Dashboard Inventory Billing PricingList Procurement Settings Admin Pricing; do
  perl -0pi -e 's/(<h1[^>]*>[^<]*<\/h1>\s*)<p style=\{\{ color: "var\(--slate\)", fontSize: 13, marginBottom: 20 \}\}>.*?<\/p>\s*/$1/s' $f.tsx
done

# 2. Replace "Loading…" text with skeleton loaders
perl -pi -e 's|<p style=\{\{ color: "var\(--slate\)", fontSize: 13 \}\}>Loading…</p>|<SkeletonRows rows={3} />|g; s|<p>Loading…</p>|<SkeletonRows rows={5} />|g' Dashboard.tsx Inventory.tsx PricingList.tsx Procurement.tsx Billing.tsx Pricing.tsx
for f in Dashboard Inventory PricingList Procurement Billing Pricing; do
  grep -q SkeletonRows $f.tsx && ! grep -q 'components/Skeleton' $f.tsx && \
    sed -i '1i import { SkeletonRows } from "../components/Skeleton";' $f.tsx
done

# 3. Old light-theme hex tints -> semantic tokens (dark/glass safe)
perl -pi -e 's/"#EAF3EC"/"var(--success-bg)"/g; s/"#FBF0E4"/"var(--warning-bg)"/g; s/"#FBEAE7"/"var(--critical-bg)"/g; s/"#EAEFF4"/"var(--info-bg)"/g' *.tsx
echo "done"
