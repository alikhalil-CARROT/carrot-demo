# Rabbit Egypt — Finance ERP (Tier 2)
**Product Requirements Document — v0.1**
**Owner:** Ali Khalil · Finance · Rabbit Egypt
**Date:** 28 April 2026

---

## 1. Executive summary

Rabbit Egypt's finance team currently runs the books on Excel (`Rabbit Egypt Actuals 2026.xlsb`) plus a Google Apps Script that reconciles E-Invoices against received POs. This PRD specifies a web application that replaces both, becoming the system of record for the General Ledger and replicating the workbook's structure (sub-account schedules, balance sheet, P&L, cost-center P&L, EBITDA, cash flow).

The system is the **AP module of an ERP** (Tier 2). It is **not** intended to replace any other ERP — there is no existing one. PO creation, GR posting, inventory and AR ledgering remain in Metabase; the new app reads from Metabase and from the ETA portal (via Metabase's existing integration) and turns those signals into reviewable, approvable, postable journal entries.

Single legal entity, single currency (EGP), Cairo timezone, Egyptian fiscal calendar (Jan–Dec).

---

## 2. Goals & non-goals

### Goals (v1)

1. Replace `Rabbit Egypt Actuals 2026.xlsb` as the system of record for the General Ledger and all monthly sub-account schedules.
2. Port the existing Apps Script reconciliation logic (E-Invoices ↔ Closed POs, JE drafting, Hold for PO, GR/IR Aging, supplier email drafts) into the new system, using direct Metabase reads instead of pasted exports.
3. Produce monthly Balance Sheet, P&L (by GL account and by Cost Center), EBITDA waterfall, and Cash Flow statements that tie to the GL.
4. Enforce a JE workflow: **Draft → Review → Approve → Post**, with role-based segregation of duties.
5. Provide a one-time migration tool that imports the entire `Rabbit Egypt Actuals 2026.xlsb` (Mappings, GL, all sub-account schedules) so the cutover is one switch.

### Non-goals (explicit)

- **No PO/GR creation, no inventory.** Those stay in Metabase.
- **No AR module.** Receivables stay an editable schedule, like today's Excel tab.
- **No push to ETA.** Metabase already does that.
- **No automated emails.** All supplier comms are drafts in the user's Gmail; humans send them.
- **No multi-currency, multi-entity, or intercompany.** Single EGP entity.
- **No payroll module.** Salary/tax journal entries are posted from external sources.
- **No fixed-asset depreciation engine in v1.** Asset register is a schedule; depreciation is calculated and posted as a manual JE (same as today). v2 candidate.
- **No supplier portal in v1.** Suppliers reply via email.
- **No mobile app.** Desktop web only.

---

## 3. Personas & roles

| Role | Count | Capabilities |
|---|---|---|
| **Admin** | 1–2 | Manage users, roles, mappings (CoA / locations / cost centers / suppliers), close periods, configure system. Posts JEs. |
| **Poster** | 7 | Draft, edit, post (after approval) journal entries. Run reconciliation. Generate email drafts. Edit own sub-schedules. |
| **Approver** | 3 | Review and approve/reject JEs in the queue. Cannot post their own drafts. |
| **Owner / Buyer** | 5 (Mina, Said, Mario, Abdelrahman, Doaa) | Read-only access to the Hold for PO tab and GR/IR Aging tab filtered to their suppliers. Press their own "Generate Drafts" button. |
| **Auditor / Read-only** | as needed | Read access to all GL data, schedules, and statements. No edits. |

**Login.** Google SSO restricted to the `@rabbitmart.com` domain. Roles are granted by an Admin in the user-admin screen.

**Segregation of duties.** A Poster cannot self-approve. The user who drafted a JE is excluded from the Approver list for that JE. An Admin can post but not approve their own drafts.

---

## 4. Architecture overview

### Recommended tech stack (chosen for fit with Claude Code)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 14** (App Router) + React + TypeScript + Tailwind + **shadcn/ui** | Single codebase for UI + API; well-trodden; agent-friendly. |
| API | Next.js Route Handlers + **tRPC** for typed RPC | Type-safe end-to-end; minimal boilerplate. |
| ORM / DB | **Prisma** + **PostgreSQL 16** | Standard, well-documented, easy migrations. |
| Auth | **NextAuth.js** with Google provider, domain-restricted | Native Google SSO; integrates cleanly with Prisma adapter. |
| Background jobs | **BullMQ** + **Redis** | Metabase pulls, email-draft creation, statement rollups. |
| Email | **Gmail API** via OAuth (delegated, per-user) | Drafts land in the user's own mailbox — preserves the existing model. |
| Reporting / pivots | Server-side aggregation in Postgres + **TanStack Table** in UI | No need for OLAP cube at this volume. |
| File parse | **ExcelJS** + **pyxlsb** for the migration tool | xlsb-aware. |
| Hosting | **Vercel** (web/API) + **Supabase** or **Neon** (Postgres) + **Upstash** (Redis) | Or self-host on Hetzner/AWS — single VM is enough at this volume. |
| Observability | **Sentry** (errors), **Axiom** or CloudWatch (logs) | |
| Testing | **Vitest** (unit), **Playwright** (e2e) | |

### High-level flow

```
Metabase (PO, GR, AR data)            ETA portal (e-invoices)
        │                                    │
        ▼                                    ▼
       Metabase warehouse (Postgres-compatible)
                       │
                       ▼  scheduled & on-demand pulls
            ┌──────────────────────────┐
            │   Rabbit Finance ERP     │
            │   (Next.js + Postgres)   │
            └─────────┬────────────────┘
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
Reconciliation engine         JE workflow
  (auto-drafts JEs)         Draft→Review→Approve→Post
        │                           │
        └────────────┬──────────────┘
                     ▼
            General Ledger (Postgres tables)
                     │
                     ▼
       Schedules + Financial Statements
        (BS, P&L, CC P&L, EBITDA, CF)
                     │
                     ▼
          Gmail drafts for missing-PO follow-up
```

### Volumes (sizing inputs)

- **400 suppliers** active.
- **~10,000 invoices/month** ⇒ ~30,000 JE legs/month from the auto-recon flow alone.
- **~85,000 GL legs already** in the import (Jan 2026 YTD).
- ~10 concurrent users at month-end close.

These numbers are tiny by enterprise-ERP standards. A single small Postgres instance handles this comfortably.

---

## 5. Data model

Prisma schema sketch — final names live in `prisma/schema.prisma`. Money is `Decimal(18,2)`. All timestamps `timestamptz` UTC; UI renders in `Africa/Cairo`.

### Core mapping entities

```prisma
model GlAccount {
  id          String   @id @default(cuid())
  number      String   @unique          // "1000000"
  description String                     // "FAB Bank USD"
  nature      AccountNature              // Balance_Sheet | PL
  section     String                     // "Current Assets", "Revenue", etc.
  isActive    Boolean  @default(true)
  legs        JeLeg[]
  bsLines     BsLine[]
  plLines     PlLine[]
}

model Location {
  id          String  @id @default(cuid())
  code        String  @unique             // "100"
  description String                       // "Head Office 1"
  legs        JeLeg[]
}

model CostCenter {
  id          String  @id @default(cuid())
  code        String  @unique             // "2002"
  description String                       // "Finance"
  legs        JeLeg[]
}

model Supplier {
  id           String   @id @default(cuid())
  code         String   @unique           // "10330"
  name         String
  checkName    String?                    // canonical for fuzzy match
  taxId        String?
  paymentTerm  String?
  email        String?                    // multi-address cell allowed; parsed at draft time
  ownerUserId  String?                    // FK to User (the buyer)
  type         SupplierType?              // Goods | Service | null
  isActive     Boolean  @default(true)
  invoices     EInvoice[]
  pos          PurchaseOrder[]
  payables     PayablesLine[]
}
```

### Source data (from Metabase + ETA)

```prisma
model EInvoice {
  id             String    @id @default(cuid())
  metabaseId     String    @unique             // upstream PK
  invoiceNumber  String
  internalId     String?
  invoiceDate    DateTime
  supplierId     String?                       // resolved at ingest
  supplierRaw    String                        // as it came from ETA
  taxCard        String?
  rawPo          String?                       // supplier-supplied PO field, unparsed
  poNormalized   String?                       // numeric PO after prefix-strip; null if invalid
  total          Decimal  @db.Decimal(18,2)
  subtotal       Decimal? @db.Decimal(18,2)
  vat            Decimal? @db.Decimal(18,2)
  status         InvoiceStatus  @default(NEW)  // NEW | POSTED | POSTED_VARIANCE | HOLD_FOR_PO
  reconciledAt   DateTime?
  jeId           String?
  notes          String?
  ingestedAt     DateTime @default(now())
  // ...
}

model PurchaseOrder {
  id              String    @id @default(cuid())
  metabaseId      String    @unique
  poNumber        String    @unique             // "706279"
  supplierId      String?
  supplierRaw     String
  closingDate     DateTime?
  subtotal        Decimal   @db.Decimal(18,2)
  vat             Decimal   @db.Decimal(18,2)
  total           Decimal   @db.Decimal(18,2)
  hasLineTotals   Boolean
  lineCount       Int
  ingestedAt      DateTime  @default(now())
}
```

### General ledger

```prisma
model JournalEntry {
  id           String   @id @default(cuid())
  serial       Int      @unique           // 307068, etc. — same convention as today's GL
  type         JeType                     // AUTO_RECON | MISMATCH_PPV | MANUAL | IMPORT
  status       JeStatus                   // DRAFT | PENDING_APPROVAL | APPROVED | POSTED | REJECTED | VOIDED
  postingDate  DateTime
  txDate       DateTime
  description  String
  createdById  String
  createdAt    DateTime @default(now())
  reviewedById String?
  reviewedAt   DateTime?
  postedById   String?
  postedAt     DateTime?
  rejectedReason String?
  legs         JeLeg[]
  attachments  JeAttachment[]
  sourceInvoiceId String?
  sourcePoNumber  String?
}

model JeLeg {
  id            String   @id @default(cuid())
  journalId     String
  journal       JournalEntry @relation(fields:[journalId], references:[id])
  accountId     String
  locationId    String?
  costCenterId  String?
  debit         Decimal  @db.Decimal(18,2) @default(0)
  credit        Decimal  @db.Decimal(18,2) @default(0)
  supplierId    String?                      // for AP legs
  invoiceNumber String?
  poNumber      String?
  description   String?
  ownerUserId   String?                      // buyer/owner — replicates the new "Owner" column on Auto JEs / Mismatch POs JEs
  // CHECK (debit = 0 OR credit = 0)
  // CHECK (debit + credit > 0)
}
```

### Sub-account schedules

Each schedule is **a typed table linked back to a single GL account**, with a per-row reconciliation back to the GL balance ("BS Check" in the workbook becomes a computed view).

```prisma
model PayablesLine {
  id            String   @id @default(cuid())
  invoiceDate   DateTime
  invoiceNumber String
  poNumber      String?                  // or "Adjustment" / "Rebate" for non-PO entries
  supplierId    String?
  supplierName  String                    // free text for non-mapped suppliers
  type          String?                   // free text
  totalAmount   Decimal  @db.Decimal(18,2)
  dueDate       DateTime?
  balanceDue    Decimal  @db.Decimal(18,2)
  payments      Payment[]
  comment       String?
}

model Payment {
  id              String   @id @default(cuid())
  payablesLineId  String
  amount          Decimal  @db.Decimal(18,2)
  paymentDate     DateTime
  bankClearingId  String?                 // FK if posted via Bank Clearing
}
```

Analogous models for `ReceivablesLine`, `BankClearingLine`, `PrepaymentLine`, `EmployeeAdvance`, `AccrualLine`, `DownpaymentLine`, and `FixedAsset` (with `DepreciationSchedule`).

### GR/IR & Hold for PO

```prisma
model HoldForPo {
  id               String   @id @default(cuid())
  einvoiceId       String   @unique
  supplierId       String?
  rawPoField       String
  reason           HoldReason             // BLANK | INVALID_FORMAT | BELOW_THRESHOLD
  firstSeen        DateTime @default(now())
  reminderCount    Int      @default(0)
  lastDraftAt      DateTime?
  draftHistory     Json     @default("[]")
  status           HoldStatus  @default(OPEN) // OPEN | DRAFTED | REMINDED | ESCALATED | RESOLVED
  resolutionNote   String?
  resolvedAt       DateTime?
}

model GrirAgingRow {
  id             String   @id @default(cuid())
  poNumber       String   @unique
  supplierId     String?
  grDate         DateTime?
  grAmount       Decimal  @db.Decimal(18,2)
  invoiceAmount  Decimal? @db.Decimal(18,2)
  openBalance    Decimal? @db.Decimal(18,2)
  jePosted       Boolean
  reconStatus    String?
  daysOpen       Int?
  bucket         String?                 // "0-30" | "31-60" | "61-90" | "Over 90" | "Cleared" | "Possibly Reversed"
  status         String                  // "Open" | "Cleared" | "Likely Missing Invoice" | "Possibly Reversed"
  lastSeen       DateTime?
  note           String?
  isFromSeed     Boolean   @default(false)
  updatedAt      DateTime  @updatedAt
}
```

### Auth & audit

```prisma
model User {
  id        String  @id @default(cuid())
  email     String  @unique
  name      String?
  roles     UserRole[]
  isActive  Boolean @default(true)
}

model UserRole {
  userId String
  role   Role           // ADMIN | POSTER | APPROVER | OWNER | AUDITOR
  user   User @relation(fields: [userId], references: [id])
  @@id([userId, role])
}

model AuditLog {
  id        String   @id @default(cuid())
  at        DateTime @default(now())
  userId    String?
  action    String                       // "JE.CREATE", "JE.APPROVE", "JE.POST", "JE.VOID", "MAPPING.EDIT", ...
  entity    String                       // table name
  entityId  String
  before    Json?
  after     Json?
  reason    String?
  ipAddress String?
}

model Period {
  id       String  @id @default(cuid())
  year     Int
  month    Int
  status   PeriodStatus               // OPEN | SOFT_CLOSED | CLOSED
  closedAt DateTime?
  closedBy String?
}
```

`AuditLog` is append-only and required for SOX-style trail. `Period.CLOSED` blocks any further posting to that month.

---

## 6. Modules

Each subsection ends with **acceptance criteria** the agent can self-verify against.

### 6.1 Mappings

CRUD over GL Accounts, Locations, Cost Centers, Suppliers. All edits go through the audit log.

- Bulk-import the four lists from the workbook's `Mappings` tab on day-one cutover.
- `GlAccount.number` is immutable once a JE has been posted against it; description is editable.
- Supplier merging: if two suppliers turn out to be the same, an Admin can merge — all FKs migrate to the surviving supplier, the merge event is audited.
- A Suppliers screen surfaces the canonical "Check Name" field used for fuzzy matching, the U/V (Owner/Email) values, and the Goods/Service marker.

**Acceptance.** All 97 GL accounts, 18 locations, 14 cost centers, and 400 suppliers from the workbook load cleanly. Supplier search returns within 200 ms on 5,000-supplier benchmark.

### 6.2 Source data ingestion

Two scheduled pulls + one ad-hoc trigger.

| Source | What | When | Idempotency key |
|---|---|---|---|
| Metabase — `closed_pos` view | New & changed POs | Hourly cron + manual button | `metabaseId` |
| Metabase — `e_invoices` view (ETA-fed) | New & changed invoices | Hourly cron + manual button | `metabaseId` |
| Metabase — `general_entries` (existing manual JEs) | Read-only mirror, used for dedup | Daily | `serial` |

Pulls are **incremental** (`updated_at > last_pulled_at`), wrap each batch in a transaction, write a `SourcePullRun` record (started, finished, rows seen, rows new, rows updated, error). The UI shows the last successful pull and lets a user trigger a manual pull.

**Acceptance.** A manual "Sync now" button completes for the full month's volume (10K invoices, 30K POs) in under 90 s. Idempotent: running twice in a row produces zero changes.

### 6.3 General Ledger & JE workflow

Core of the system.

**Drafting.**
- Auto-drafts: Reconciliation engine (6.4) and Mismatch engine (6.5) emit JEs in `DRAFT` status.
- Manual: a "New Journal Entry" form with leg builder (debit/credit, account picker, location, cost center, supplier, description). Real-time validation: must balance to zero, all debits ≥ 0, all credits ≥ 0, posting date inside an OPEN period.
- Bulk import: paste-from-Excel with header row mapped to fields. Validates each row, shows errors inline, commits in a single transaction.

**Review queue.**
- An Approver sees only JEs where `status = PENDING_APPROVAL` AND `createdById ≠ self`.
- They can: Approve, Approve & Post, Reject (with reason), Edit (which re-routes to PENDING_APPROVAL).

**Posting.**
- Posting requires `status = APPROVED` and `period.status = OPEN`.
- Posting writes `postedAt`, `postedById`, freezes the JE (any further change must be a *Reverse + Re-post* pair).
- Bulk-post: the Apps Script's "post N matched POs in one click" lives here as a list view with checkboxes + "Post Selected".

**Voiding & reversal.**
- Posted JE can be **reversed** — generates a new JE (`type=REVERSAL`, `status=PENDING_APPROVAL`) with negated legs and a link back. Cannot edit a posted JE in place.

**Period close.**
- Admin can `SOFT_CLOSE` a period (warns on post, doesn't block) or `CLOSE` it (blocks all post/edit). Soft-close exists for the cooling-off window between draft cutoff and final sign-off.

**Acceptance.**
- A Poster cannot self-approve. Attempting to does both a UI-level and server-level rejection.
- Bulk-posting 500 JEs (1,500 legs) completes in under 10 s.
- Once a period is `CLOSED`, all post/edit endpoints return 403 with a clear message.
- Audit log records every JE state change.

### 6.4 AP Reconciliation engine

Direct port of the Apps Script's `runReconciliation` flow. Inputs: latest pulled `EInvoice` and `PurchaseOrder` rows. Outputs: `JournalEntry` drafts.

Algorithm (preserve from the script exactly):
1. Group E-Invoices by `poNormalized`. Skip invoices already POSTED.
2. Group POs by `poNumber`. PO total = `SUM(total_cost) + SUM(vat_cost)` across lines, with `supplier_invoice_amount` fallback when line totals are absent.
3. Match by PO number. Tolerance: 1 % of the larger of the two totals.
4. Classify into:
   - **Matched** → 3-leg JE (Dr GR/IR, Dr VAT Receivables, Cr Payables).
   - **Amount Mismatch** → 4-leg JE with PPV plug (account 5000036).
   - **Only in E-Invoices** → leave unposted, surface in dashboard. (Today the script's "Only in EI JEs" tab is intentionally absent. We keep it that way.)
   - **Only in Closed POs** → contributes to GR/IR Aging only.
   - **Hold for PO** → invoice's PO field blank/invalid/below-threshold → routes to Hold for PO module.
5. Dedup against the GL: don't draft a JE if `(supplier, invoiceNumber)` already exists in any posted JE.

Each draft pre-fills:
- Supplier, Invoice #, PO, Tax ID, Payment Term, Due Date, Description (`<Supplier> - Code# … - PO# … - Inv# … - Tax Card# …`), Owner from Mapping.
- The same 22-column shape as today's Auto JEs / Mismatch POs JEs tabs, **with the new `Owner` column** so each buyer can filter to their own.

**Acceptance.** Re-running the reconciliation against the same source data produces zero new drafts (idempotent). Diffing the auto-drafts against the Apps Script output for one historical month must match leg-for-leg.

### 6.5 Hold for PO + Email drafts

Direct port of the Apps Script's Hold for PO module + per-owner Gmail draft generator.

- Build-on-previous-data semantics preserved: rows survive across runs, `firstSeen` / `reminderCount` / `draftHistory` accumulate, resolved invoices flip to `RESOLVED`.
- Per-owner draft generation: 5 owner buttons + "All owners". One email per supplier listing every open invoice. Arabic-only body, RTL-aligned, four bolded lines (header, salutation, list lead-in, ETA reminder). Subject `<supplier> - أرقام أوامر شراء مطلوبة لـ N فاتورة`.
- Drafts created via Gmail API in the **clicking user's** mailbox.
- Multi-address Supplier Email cell is split; `@rabbitmart.com` addresses go to CC, others to To.
- The "Goods/Service" gate is **removed** (per recent product decision). Any supplier with at least one external email gets a draft.

**Acceptance.** A press of "Run for Doaa" creates one Gmail draft per Doaa-owned supplier, with all of that supplier's open invoices listed. Each draft body matches the spec. Re-pressing the button the same day creates zero new drafts (cadence enforced).

### 6.6 GR/IR Aging

Identical analytics to the Apps Script's GR/IR Aging tab.

- One row per PO, joined across `PurchaseOrder`, `EInvoice` (via PO match), and the GL (for the "JE Posted?" flag).
- Aging buckets anchored on `closingDate`: 0–30, 31–60, 61–90, Over 90, Cleared, Possibly Reversed.
- "Cleared" once `JE Posted = Yes AND |Open Balance| ≤ 1 EGP` — Days Open frozen at clearance.
- "Possibly Reversed" once a previously `Open` PO has been absent from the Metabase Closed POs feed for > 30 days.
- Note column is manually editable, preserved across reruns.
- Owner-filter and Supplier-filter on the page header.
- One-time **seed import** from the historical `GRIR.xlsx` — POs not already in the live table are inserted as synthetic prior-run rows; re-imports are idempotent.

**Acceptance.** Open balances by bucket match the Apps Script GR/IR Aging tab on the same input data, to the cent.

### 6.7 BS Sub-Account Schedules

Replicate every schedule tab from the workbook as a typed module:

| Workbook tab | Module | GL account it ties to | Reconciliation rule |
|---|---|---|---|
| Payables | Payables | 2000000 | Σ `balanceDue` = GL balance of 2000000 |
| Bank Clearing | Bank Clearing | 1000017 | Σ `amount` (with status = "In Books") = GL balance |
| Receivables | Receivables | 1000002 | Σ `balanceDue` = GL balance |
| GRIR | GR/IR Aging (6.6) | 2000011 | Σ `openBalance` = GL balance |
| Prepayments | Prepayments | 1000009 + 1000016 | Σ remaining = combined GL balance |
| Asset register V2 | Fixed Assets register | 1100000–1100007 | NBV ties to net of cost − accumulated dep'n |
| Emp. Adv. | Employee Advances | 1000007 | Σ `remaining` = GL balance |
| Accruals | Accruals | (multiple — `Other Payables` etc.) | Σ `amount` = GL balance |
| Downpayments | Downpayments | 1000004 | Σ `amount` = GL balance |

Each module has:
- A list view with filters (date range, supplier, status).
- Inline edit (subject to role).
- Add/Delete (with audit).
- A **"BS Check" widget** at the top of every page showing schedule-total minus GL-balance for the selected period — green when zero, red when not, with a one-click drill-down to the diff.

**Acceptance.** Every schedule's BS Check reads zero on the imported month-end snapshot.

### 6.8 Financial statements

Real-time monthly statements driven by the GL.

- **Balance Sheet (`/reports/bs`).** Account-level rows, monthly columns, configurable date range. Sections: Current Assets, Fixed Assets, Current Liabilities, Long-term Liabilities, Owners' Equity. Auto-totals per section + grand totals.
- **P&L by GL (`/reports/pl-gl`).** Revenue / Expense / Non-Operating / Year Closing sections.
- **P&L by Cost Center (`/reports/pl-cc`).** Same sections, grouped by cost center.
- **EBITDA (`/reports/ebitda`).** Standard waterfall — Revenue → Gross Profit → EBITDA → Net Income, sub-totals per the workbook's structure.
- **Cash Flow (`/reports/cf`).** Indirect method, structured to match the workbook's CF tab line-by-line.
- All statements export to .xlsx with the workbook's exact cell layout (so external auditors recognize them).

**Acceptance.** For Mar 2026, every statement reproduces the workbook to within rounding.

---

## 7. Integrations

### 7.1 Metabase

- **Connection.** Direct read-only Postgres connection to the Metabase warehouse (or REST queries against saved Metabase questions if the warehouse isn't directly reachable).
- **Schemas pulled.**
   - `closed_pos` — fields the script already uses: `purchase_order_id`, `supplier_name`, `supplier_code`, `total_cost`, `vat_cost`, `closing_date`, `supplier_invoice_number`, `inoviced[sic]`, `supplier_invoice_amount`, plus any line-level keys.
   - `e_invoices` — `internal_id`, `invoice_number`, `invoice_date`, `supplier`, `tax_card`, `po`, `subtotal`, `vat`, `total`, `link`.
   - `general_entries_mirror` — for dedup. Read-only.
- **Pull cadence.** Hourly cron + on-demand. A `SourcePullRun` row records each.
- **Failure handling.** If Metabase is unreachable, the UI surfaces a banner with the last successful pull timestamp. Reconciliation can still run on cached data, but is marked "stale — last refresh was N hours ago".

### 7.2 Gmail API (per-user OAuth)

- The user's Google session grants `https://www.googleapis.com/auth/gmail.compose` on first draft generation.
- Drafts are created in the user's own mailbox via `users.drafts.create`. No central service account.
- HTML body (RTL-aligned, four-line bold formatting), plain-text fallback, multi-address To/CC routing as in the current Apps Script.
- Quota: well below Gmail's per-user 1,000 draft / day limit.

### 7.3 Google SSO

- NextAuth.js Google provider, `hd=rabbitmart.com` to lock to the workspace.
- First login creates the user with no roles. An Admin grants roles after.

---

## 8. Migration plan (one-time, hard cutover)

A migration tool inside the app, accessible only to Admins.

### Step 1 — Mappings ingest
Parse the workbook's `Mappings` sheet:
- GL Accounts (cols A–D).
- Locations (cols F–G).
- Cost Centers (cols I–J).
- Suppliers (cols N–O…).

### Step 2 — Historical GL ingest
Parse the `GL` sheet (~85K rows). Group rows by `Serial` → one `JournalEntry` per serial, status = `POSTED`, `postedAt` = `Posting Date`, `postedById` = a synthetic "import" user. Preserve account #, location, cost center, debit, credit, description.

### Step 3 — Schedule ingest
For each schedule tab (Payables, Receivables, GRIR, Prepayments, Asset register V2, Emp. Adv., Accruals, Downpayments, Bank Clearing), parse rows into the corresponding model. The migration tool shows a per-tab BS-check before commit; user must click "Confirm import" only if all checks pass.

### Step 4 — Statements smoke test
The tool computes BS and P&L for the latest month in the workbook and shows a side-by-side diff vs. the workbook's BS / GL P&L tabs. Diff must be zero (or all explained variances) before the tool flips the system from "Migration mode" to "Live".

### Step 5 — Cutover
- Admin closes all periods up to (and including) the last full month in the workbook.
- The current month becomes OPEN.
- Apps Script reconciliation is decommissioned; users start using the new app.
- Workbook becomes read-only archive, kept for audit.

---

## 9. Security & compliance

- **Auth.** Google SSO domain-restricted; sessions JWT-signed; idle timeout 12 h; absolute timeout 7 days.
- **Authorization.** All endpoints guarded by role checks; DB rows for sensitive tables (`JournalEntry`, `JeLeg`, `Period`) carry RLS-style policies enforced server-side.
- **Audit.** Every state change in `JournalEntry`, `Mapping*`, `Period`, and roles writes to `AuditLog`. Audit log is append-only, no edit/delete API.
- **PII.** The system stores supplier names, addresses, emails, tax IDs. No personal data beyond that.
- **Backups.** Daily Postgres logical backups, 90-day retention. Point-in-time recovery via Supabase / Neon.
- **Egypt data residency.** Use a region close to Cairo (Frankfurt or Bahrain). Confirm with legal whether Egypt-only residency is required — flagged as **open question** below.
- **Secrets.** Stored in the hosting provider's secret manager, not in env files. Includes Metabase DB creds, Google OAuth client secret, NextAuth secret.

---

## 10. Acceptance criteria (system-level)

The system is "v1 done" when **all** of the following hold on the production environment, checked by a Finance lead:

1. All workbook data is imported and every BS Check across every schedule reads zero on the cutover snapshot.
2. The Mar 2026 BS, P&L, CC P&L, EBITDA, and CF statements produced by the system match the workbook to within 1 EGP per line.
3. A full month of source data (10K invoices, 30K POs) can be ingested, reconciled, drafted, reviewed, approved, and posted by Finance in under one working day with no spreadsheet involvement.
4. Per-owner Gmail draft buttons produce one batched Arabic draft per supplier that matches the spec'd body verbatim.
5. The audit log captures every JE state change plus mapping edits.
6. Period close blocks edits to a closed month.
7. Two users with conflicting roles cannot self-approve.

---

## 11. Phased build plan (Claude Code milestones)

Designed so each phase ends with a running, testable system.

### Phase 0 — Bootstrap (≈ 1 week)

- Repo scaffold: Next.js 14, Prisma, Postgres (local Docker), NextAuth Google.
- Schema: User, UserRole, AuditLog, Period.
- One-screen admin: invite user, grant role, view audit log.
- CI: lint + typecheck + Vitest + Playwright on PR.

**Done when** an Admin can log in via Google SSO, invite a teammate, grant them a role, and see the action in the audit log.

### Phase 1 — Mappings & data import (≈ 2 weeks)

- Models: GlAccount, Location, CostCenter, Supplier.
- CRUD UIs.
- Migration tool reads the four Mappings ranges from the xlsb and imports.

**Done when** all 97 GL accounts / 18 locations / 14 cost centers / 400 suppliers are visible in the UI, editable, with full audit history.

### Phase 2 — Source data ingestion (≈ 2 weeks)

- Metabase connection (read-only).
- EInvoice + PurchaseOrder models + ingest jobs.
- "Sync now" button.
- Source-pull dashboard.

**Done when** an hourly cron and a manual button both successfully pull 10K invoices and 30K POs idempotently.

### Phase 3 — JE workflow (≈ 3 weeks)

- JournalEntry + JeLeg models, period model.
- Manual JE form + bulk-paste import.
- Draft → Review → Approve → Post state machine.
- Period open/soft-close/close UI.
- GL list, filter, search, drill-down.

**Done when** a Poster can draft a JE, an Approver can approve it, and the Poster can then post it (but not approve their own). Period close blocks edits.

### Phase 4 — Reconciliation engine (≈ 2 weeks)

- Port `runReconciliation`, `validatePO_`, `lookupSupplierFuzzy_` from the Apps Script.
- Auto-drafts land in the JE Draft list.
- Reconciliation Status writeback to EInvoice (Posted / Posted with variance / Hold for PO).
- Side-by-side test: regression against the Apps Script for one historical month.

**Done when** running the reconciliation against Mar 2026 source data produces the same JE drafts (leg-for-leg) as the Apps Script did at the time.

### Phase 5 — Hold for PO + Email drafts (≈ 1.5 weeks)

- HoldForPo model + UI.
- Per-owner draft generation via Gmail API.
- Bilingual body builder (Arabic-only, RTL, bold lines as spec'd).

**Done when** "Run for Doaa" creates one batched Gmail draft per Doaa supplier, matching the spec body, in the clicking user's Drafts folder.

### Phase 6 — GR/IR Aging (≈ 1.5 weeks)

- GrirAgingRow model + UI.
- Seed import from `GRIR.xlsx`.
- Bucket logic, status precedence, Note preservation.

**Done when** the GR/IR Aging page produces the same bucket totals as the Apps Script.

### Phase 7 — Sub-account schedules (≈ 3 weeks, parallelizable)

One module per workbook tab. Each is small but the BS-check ties it back to the GL.

**Done when** every schedule's BS Check reads zero on import.

### Phase 8 — Financial statements (≈ 2 weeks)

- BS, P&L, CC P&L, EBITDA, CF — server-side aggregations + UI tables.
- Excel export matching the workbook layout.

**Done when** the four statements for Mar 2026 reproduce the workbook within 1 EGP per line.

### Phase 9 — Hardening & cutover (≈ 2 weeks)

- Production Postgres + Redis.
- Backups, monitoring, alerting.
- Final reconciliation parity test.
- Cutover rehearsal.

**Total estimate:** ≈ 19 weeks of solo build with Claude Code, less in parallel. v1 in ~5 months is realistic.

---

## 12. Open questions

These are not blockers for starting Phase 0, but need answers before the noted phase.

| # | Question | Needed by |
|---|---|---|
| Q1 | Does Egyptian law require finance data to be hosted on Egyptian soil? Affects hosting choice. | Phase 0 |
| Q2 | Are there other source systems beyond Metabase and ETA we should be aware of (e.g., a payroll system whose JEs also need to import)? | Phase 4 |
| Q3 | Who exactly are the 3 Approvers and 7 Posters? Need a list with email addresses to seed the Users table. | Phase 0 |
| Q4 | What's the closing-day cadence? When does the team expect a month to be `CLOSED`? | Phase 3 |
| Q5 | Asset register depreciation: should the system *post* monthly depreciation JEs automatically (engine), or leave them as manual JEs (status quo)? v1 assumes manual; flag if you want the engine. | Phase 7 |
| Q6 | Bank Clearing: does the team want a bank-statement import (CAMT.053 or CSV) or stay with manual entry? | Phase 7 |
| Q7 | How are Receivables actually generated today? Is there an upstream Metabase view, or are they entered manually like in the workbook? | Phase 7 |
| Q8 | Do auditors need direct DB read access, or is the read-only Auditor role in the app sufficient? | Phase 9 |
| Q9 | Retention policy for source invoices and JEs — Egyptian commercial law typically requires 5 or 10 years; please confirm. | Phase 0 |

---

## Appendix A — Reconciliation logic preserved from Apps Script

Verbatim port required for the following pieces (these are battle-tested):
- `validatePO_` — prefix stripping (Latin and Arabic), digit-extraction fallback, MIN_SERIAL = 60000.
- `lookupSupplierFuzzy_` with `CFG.SUPPLIER_FUZZY_THRESHOLD = 0.90` — substring containment + whitespace-collapse Levenshtein + plain Levenshtein, max-pooled.
- `parseSupplierEmails_` — multi-address splitting on `,;|/`/whitespace + NBSP normalize + internal-domain CC routing.
- `buildJeDescription_` — `<Supplier> - Code# … - PO# … - Inv# … - Tax Card# …`.
- `buildSupplierBatchEmailBodies_` — Arabic-only, RTL HTML, bold on header / salutation / list lead-in / ETA reminder.
- Aging bucket logic (0-30 / 31-60 / 61-90 / Over 90 / Cleared / Possibly Reversed).

---

## Appendix B — Workbook → ERP entity map

| Workbook tab | ERP module | Key entity |
|---|---|---|
| Mappings | Mappings | `GlAccount`, `Location`, `CostCenter`, `Supplier` |
| GL | General Ledger | `JournalEntry`, `JeLeg` |
| Payables | AP Schedule | `PayablesLine`, `Payment` |
| Bank Clearing | Bank Clearing | `BankClearingLine` |
| Receivables | AR Schedule | `ReceivablesLine`, `ReceivablesPayment` |
| GRIR | GR/IR Aging | `GrirAgingRow` |
| Prepayments | Prepayments | `PrepaymentLine` |
| Asset register V2 | Fixed Assets | `FixedAsset`, `DepreciationSchedule` |
| Emp. Adv. | Employee Advances | `EmployeeAdvance` |
| Accruals | Accruals | `AccrualLine` |
| Downpayments | Downpayments | `DownpaymentLine` |
| BS | BS Report | computed from `JournalEntry` |
| GL P&L | P&L Report | computed from `JournalEntry` |
| CC P&L | CC P&L Report | computed from `JournalEntry` (group by CostCenter) |
| EBITDA | EBITDA Report | computed |
| CF | Cash Flow Report | computed (indirect method) |

— end of PRD —
