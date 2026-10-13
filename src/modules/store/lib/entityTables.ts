// Tables the frontend reads or writes through the generic /api/store/entity/:table endpoint. Anything else (user, employee,
// hr_*, doc_*, project_assignments, ...) is refused there: that endpoint used to map ANY snake_case name to ANY Prisma model.
// Derived from every storeApi / apiClient / supabase-shim call in master-frontend/src on 2026-10-07. Add a table here when a
// Store screen genuinely needs it.
export const STORE_ENTITY_TABLES: ReadonlySet<string> = new Set([
  // transactions
  'indent', 'po_master', 'store_in', 'store_in_direct', 'issue', 'inventory', 'stock_transfers',
  'payments', 'payment_history', 'fullkitting', 'tally_entry', 'pc_report', 'quotation_history',
  // masters
  'firm', 'company', 'item', 'vendors', 'group_head', 'uom', 'area_of_use', 'department',
  'default_po_terms', 'terms_and_condition', 'contractor_details', 'site_location_details', 'site_engineer_details',
  // calendar
  'holiday', 'working_day_calendar',
]);
