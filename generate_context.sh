#!/bin/bash

OUTPUT="marginview_context_2.txt"
echo "=== MARGINVIEW CONTEXT DUMP 2 ===" > "$OUTPUT"
echo "Generated: $(date)" >> "$OUTPUT"
echo "" >> "$OUTPUT"

FILES=(
  "apps/api/package.json"
  "apps/api/src/index.ts"
  "apps/api/src/routes/procurement.ts"
  "apps/api/src/routes/billing.ts"
  "apps/api/src/routes/competitors.ts"
  "apps/api/src/routes/onboarding.ts"
  "apps/api/src/routes/scraper.ts"
  "apps/api/src/routes/search.ts"
  "apps/api/src/services/billingOverview.ts"
  "apps/api/src/services/procurementAdvisor.ts"
  "apps/api/src/services/serpService.ts"
  "apps/api/src/services/scraper/brightDataClient.ts"
  "apps/api/src/services/scraper/jsonLdParser.ts"
  "apps/api/src/services/scraper/scraperEngine.ts"
  "apps/api/src/services/scraper/zenrowsClient.ts"
  "apps/api/src/queues/scrapeQueue.ts"
  "apps/api/src/utils/http.ts"
  "apps/api/src/db/migrations/002_modules.sql"
  "apps/api/.env.example"
  "apps/web/src/components/ProductFormModal.tsx"
  "apps/web/src/components/billing/OrgBillingOverview.tsx"
  "apps/web/src/components/billing/WorkspaceChoice.tsx"
  "apps/web/src/components/inventory/CompetitorSearchBar.tsx"
  "apps/web/src/components/inventory/CompetitorTargetsModal.tsx"
  "apps/web/src/components/inventory/CompetitorUrlInput.tsx"
  "apps/web/src/components/procurement/ProcurementAdvisorTable.tsx"
  "apps/web/src/components/procurement/ProcurementSummaryCards.tsx"
  "apps/web/src/pages/Inventory.tsx"
  "apps/web/src/pages/Procurement.tsx"
  "apps/web/src/pages/Billing.tsx"
  "apps/web/src/pages/SignUp.tsx"
  "apps/web/src/lib/mv.ts"
  "apps/web/src/styles/modules.css"
)

FOUND=0
MISSING=0

for file in "${FILES[@]}"; do
  echo "=== $file ===" >> "$OUTPUT"
  if [ -f "$file" ]; then
    cat "$file" >> "$OUTPUT"
    echo -e "\n" >> "$OUTPUT"
    ((FOUND++))
  else
    echo "(missing)" >> "$OUTPUT"
    echo -e "\n" >> "$OUTPUT"
    ((MISSING++))
  fi
done

echo "---------------------------------"
echo "Dump Complete!"
echo "Files Found  : $FOUND"
echo "Files Missing: $MISSING"
echo "Saved to     : $OUTPUT"
echo "File Size    : $(du -h "$OUTPUT" | cut -f1)"
echo "---------------------------------"
