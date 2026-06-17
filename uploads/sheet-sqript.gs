/**
 * Rabbit Finance — AP Reconciliation & Control System v4
 * ────────────────────────────────────────────────────────
 * Key changes in this version:
 *
 * Qty Recon tab:
 *   • Only shows POs where GR Amount > 0 AND Invoice Amount > 0 AND they don't match
 *   • Status clearly says "Price Mismatch" or "Qty Mismatch"
 *   • Excludes matched, no-GR, missing invoice, and qty-diff-amount-OK rows
 *
 * GR/IR Aging tab:
 *   • Purely value-based — no qty involved
 *   • Sources: all POs from GRs tab compared against E-Invoices
 *   • Three statuses:
 *       "No Invoice"   to GR exists, Invoice = 0   to Awaiting Invoice from supplier
 *       "Overbooking"  to Invoice Amount > GR Amount to Awaiting CN from supplier
 *       "Partial GR"   to GR Amount > Invoice Amount to Notify Commercial
 *
 * Supplier name:
 *   • Fixed Arabic column lookup for E-Invoice supplier
 *   • Always shows raw E-Invoice name; Mapped Name blank if not in Mapping
 */

// ═══════════════════════════════════════════════════════════════
// SECTION 1 — CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CFG = {
  EINVOICES_SHEET:        'E-Invoices',
  CLOSED_POS_SHEET:       'GRs',
  OUTPUT_SHEET:           'Reconciliation',
  MATCHED_JES_SHEET:      'Matched POs JEs',
  AP_PAYABLES_SHEET:      'AP Payables',
  MISMATCH_JES_SHEET:     'Mismatch POs JEs',   // legacy — deleted on run
  HOLD_FOR_PO_SHEET:      'Hold for PO',
  GENERAL_ENTRIES_SHEET:  'General Entries',
  SUPPLIERS_SHEET_CANDIDATES: ['Mapping','Supplier Mapping','Suppliers Mapping',
                               'Suppliers','Suppliers Master','Supplier Master','Supplier List'],
  AMOUNT_MATCH_TOLERANCE_EGP: 100,   // Fixed 100 EGP — within this = Matched regardless of qty
  JE: {
    TYPE_CODE:   3,
    GL_GRIR:     { num: '2000011', name: 'GR/IR' },
    GL_VAT:      { num: '1000003', name: 'VAT Receivables' },
    GL_PAYABLES: { num: '2000000', name: 'Payables' },
    GL_PPV:      { num: '5000036', name: 'Purchase Price Variance' },
  },
  VAT_RATE: 0.14,
  STATUS: {
    COL_HEADER:        'Reconciliation Status',
    POSTED:            'Posted',
    POSTED_VARIANCE:   'Posted with variance',
    HOLD_FOR_PO:       'Hold for PO',
    POSTED_MATCH:      'Posted - Match',
    POSTED_PPV:        'Posted - With PPV',
    QTY_MISMATCH:      'Quantity Mismatch',
    PPV_MATCH:         'Posted - PPV (Qty Match)',
    COLOR_POSTED:      '#D9EAD3',   // green
    COLOR_VARIANCE:    '#FFF2CC',   // yellow
    COLOR_HOLD_FOR_PO: '#F4CCCC',   // red
    COLOR_QTY_MISMATCH:'#FCE5CD',   // orange
  },
  PO: {
    MIN_SERIAL:   60000,
    PATTERN:      /^\d{5,}$/,
    PREFIX_REGEX: /^\s*(?:p\s*[\.\/]?\s*o\s*[#:.\-]?|po\s*number|po\s*no|أمر\s*شراء|الأمر|بي\s*و|p\s*[\.\:\-]?)\s*[#:.\-]?\s*/i,
  },
  EMAIL: {
    REMINDER_DAYS: [2, 4, 7],
    CC: ['finance.payables@rabbitmart.com','mahmoud.assem@rabbitmart.com','ali.khalil@rabbitmart.com'],
    SIGNATURE: 'Rabbit Finance Team',
  },
  OWNERS: ['Mina','Said','Mario','Abdelrahman','Doaa'],
  MAPPING_OWNER_COL_LETTER:       'U',
  MAPPING_EMAIL_COL_LETTER:       'V',
  MAPPING_CM_COL_LETTER:          'AG',
  MAPPING_STOCK_CONTROLLER_COL:   'I',   // Stock Controller column in Mapping
  INTERNAL_EMAIL_DOMAIN:    '@rabbitmart.com',
  SUPPLIER_FUZZY_THRESHOLD: 0.72,
  HEADERS: {
    einv_po:          ['مرجع طلب الشراء'],
    einv_po2:         ['وصف طلب الشراء'],
    einv_total:       ['total','total amount','grand total','الإجمالى','الاجمالى'],
    einv_subtotal:    ['subtotal','sub total','total sales','net','amount','القيمة','المبيعات'],
    einv_vat:         ['ضريبة القيمة المضافة'],
    einv_supplier:    ['supplier name','supplier','إسم البائع','اسم البائع','البائع','اسم المورد','إسم المورد'],
    einv_internal_id: ['internal id','الكود الداخلى','الكود الداخلي'],
    einv_invno:       ['invoice number','invoice #','invoice no','invoice','id','doc id','رقم الفاتورة'],
    einv_taxcard:     ['tax card','tax card #','tax card#','tax card number',
                       'tax id','tax number','tax registration','tax #',
                       'الرقم الضريبى للبائع','الرقم الضريبي للبائع'],
    einv_date:        ['date','invoice date','تاريخ الفاتورة','تاريخ الإصدار'],
    einv_link:        ['link'],
    einv_status:      ['reconciliation status','recon status','reconciliation_status'],
    cpo_po:           ['purchase_order_id','purchase order id','po'],
    cpo_total_cost:   ['total_cost','total cost','total_cost (egp)','total cost (egp)','total_cost_(egp)'],
    cpo_vat_cost:     ['vat_cost','vat cost','vat'],
    cpo_amount:       ['supplier_invoice_amount','supplier invoice amount'],
    cpo_supplier:     ['supplier_name','supplier name','supplier'],
    cpo_supplier_code:['supplier_code','supplier code','suppliers code',
                       'vendor_code','vendor code','supplier_id','supplier id'],
    cpo_invno:        ['supplier_invoice_number','supplier invoice number'],
    cpo_invoiced:     ['inoviced','invoiced'],
    cpo_closing_date: ['closing_date','closing date','date_closed','date closed',
                       'closed_date','closed_at','closed at','received_at',
                       'received_date','received date','received_on',
                       'gr_date','gr date','goods_receipt_date','goods receipt date'],
    ge_supplier:      ['supplier name','supplier'],
    ge_invno:         ['invoice #','invoice','invoice number','invoice no'],
    sup_name:         ['supplier_name','supplier name','suppliers name','supplier'],
    sup_code:         ['supplier code','suppliers code','code'],
    sup_taxid:        ['tax id','tax number','suppliers tax id','tax #'],
    sup_term:         ['payment term','payment terms','term'],
    sup_email:        ['supplier email','email','supplier_email','contact email','e-mail'],
    sup_owner:        ['owner','account owner','buyer','category owner','responsible'],
    sup_check_name:   ['check name','check_name','checkname','canonical name','clean name'],
    sup_cm:           ['cm','cm owner','commercial owner'],
    hold_supplier:    ['supplier name','supplier'],
    hold_invno:       ['invoice #','invoice','invoice number'],
  },
};

const CFG_QTY = {
  GRS_SHEET:              'GRs',
  RETURNS_SHEET:          'Returns',
  BRAND_MAPPING_SHEET:    'Brand Mapping',
  QTY_RECON_SHEET:        'Qty Recon',
  QTY_MISMATCH_ANALYSIS_SHEET: 'Qty Mismatch Analysis',
  QTY_MISMATCH_PPV_JES_SHEET:  'Qty Mismatch PPV JEs',
  POST_AS_PPV_COL_HEADER:      'Post as PPV?',
  POST_AS_PPV_YES:             'Yes',
  PPV_MISMATCH_JES_SHEET: 'PPV Mismatch JEs',
  RETURNS_JES_SHEET:      'Returns Postings',
  GRIR_AGING_SHEET:       'GR/IR Aging',
  COMMERCIAL_FU_SHEET:    'Commercial FU',
  GL_STOCKS:              { num: '1000005', name: 'Stocks Inventory' },
  GL_PPV_QTY:             { num: '4000009', name: 'Purchase Price Variance' },
  AMOUNT_TOLERANCE:   0.01,
  QTY_TOLERANCE:      0.001,
  PO_EXTRACT_PATTERN: /\b(\d{6,7})\b/,
  // Arabic column headers in E-Invoices (ETA extraction)
  AR: {
    poRef:          'مرجع طلب الشراء',
    poDesc:         'وصف طلب الشراء',
    itemCode:       'إسم الكود',
    qty:            'الكمية',
    unitPrice:      'السعر',
    totalBeforeVAT: 'القيمة',
    totalAfterVAT:  'الإجمالى',
    // Supplier name — tries multiple Arabic variants
    supplierName:   'إسم البائع',
    invoiceNum:     'رقم الفاتورة',
    invoiceDate:    'تاريخ الإصدار',
    taxId:          'الرقم الضريبي',
  },
  // Alternative Arabic supplier column names to try if primary not found
  AR_SUPPLIER_ALTERNATES: ['اسم البائع','البائع','اسم المورد','إسم المورد'],
  AGING: [
    { label: '0-14 Days',  maxDays: 14,       action: 'Monitor' },
    { label: '15-30 Days', maxDays: 30,       action: 'AP Follow-Up — Contact supplier' },
    { label: '31-60 Days', maxDays: 60,       action: 'Escalate to CM' },
    { label: '61-90 Days', maxDays: 90,       action: '⚠️ Escalate to Commercial Lead' },
    { label: '90+ Days',   maxDays: Infinity, action: '🔴 CFO Approval Required' },
  ],
};


// ═══════════════════════════════════════════════════════════════
// SECTION 2 — SINGLE MENU
// ═══════════════════════════════════════════════════════════════

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const draftMenu = ui.createMenu('Generate Drafts');
  CFG.OWNERS.forEach(o => draftMenu.addItem('Run for ' + o, 'generateDrafts' + o));
  draftMenu.addSeparator().addItem('Run for ALL owners', 'generateDraftsAll');

  ui.createMenu('🐇 Rabbit AP Controls')
    .addItem('▶  Run Full Reconciliation',   'runFullReconciliation')
    .addSeparator()
    .addItem('📦  Post Returns Only',              'runReturnsPosting_qty')
    .addItem('📋  Generate PPV from Qty Selections', 'generatePPVFromQtyMismatch')
    .addSeparator()
    .addSubMenu(draftMenu)
    .addSeparator()
    .addItem('Jump to Reconciliation',       'jumpToReconciliation')
    .addItem('Jump to Matched JEs',          'jumpToMatchedJEs')
    .addItem('Jump to PPV Mismatch JEs', 'jumpToPPVMismatchJEs')
    .addItem('Jump to Qty Recon',            'jumpToQtyRecon')
    .addItem('Jump to Qty Mismatch Analysis',    'jumpToQtyMismatchAnalysis')
    .addItem('Jump to Qty Mismatch PPV JEs',     'jumpToQtyMismatchPPVJEs')
    .addItem('Jump to Returns Postings',     'jumpToReturnsPostings')
    .addItem('Jump to Hold for PO',          'jumpToHoldForPO')
    .addItem('Jump to GR/IR Aging',          'jumpToGRIRAging')
    .addItem('Jump to AP Payables',           'jumpToAPPayables')
    .addSeparator()
    .addItem('⚙️  Setup Tabs',                'setupAllTabs_')
    .addToUi();
}

function jumpToReconciliation()   { jumpTo_(CFG.OUTPUT_SHEET); }
function jumpToMatchedJEs()       { jumpTo_(CFG.MATCHED_JES_SHEET); }
function jumpToPPVMismatchJEs()   { jumpTo_(CFG_QTY.PPV_MISMATCH_JES_SHEET); }
function jumpToQtyRecon()         { jumpTo_(CFG_QTY.QTY_RECON_SHEET); }
function jumpToQtyMismatchAnalysis() { jumpTo_(CFG_QTY.QTY_MISMATCH_ANALYSIS_SHEET); }
function jumpToQtyMismatchPPVJEs()   { jumpTo_(CFG_QTY.QTY_MISMATCH_PPV_JES_SHEET); }
function jumpToReturnsPostings()  { jumpTo_(CFG_QTY.RETURNS_JES_SHEET); }
function jumpToHoldForPO()        { jumpTo_(CFG.HOLD_FOR_PO_SHEET); }
function jumpToGRIRAging()        { jumpTo_(CFG_QTY.GRIR_AGING_SHEET); }
function jumpToAPPayables()       { jumpTo_(CFG.AP_PAYABLES_SHEET); }
function jumpTo_(name) { const ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(name); if(sh) ss.setActiveSheet(sh); else SpreadsheetApp.getUi().alert('Tab "'+name+'" not found. Run reconciliation first.'); }

function generateDraftsMina()        { generateSupplierDrafts_('Mina'); }
function generateDraftsSaid()        { generateSupplierDrafts_('Said'); }
function generateDraftsMario()       { generateSupplierDrafts_('Mario'); }
function generateDraftsAbdelrahman() { generateSupplierDrafts_('Abdelrahman'); }
function generateDraftsDoaa()        { generateSupplierDrafts_('Doaa'); }
function generateDraftsAll()         { generateSupplierDrafts_(null); }


// ═══════════════════════════════════════════════════════════════
// SECTION 3 — MAIN ENTRY POINTS
// ═══════════════════════════════════════════════════════════════

function runFullReconciliation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  try {
    ui.alert('🐇 Running Full Reconciliation...','All operations running. This may take 1–2 minutes.',ui.ButtonSet.OK);

    // ── BLOCK 1: Amount Reconciliation ──────────────────────────
    const eiSheet = ss.getSheetByName(CFG.EINVOICES_SHEET);
    if (!eiSheet) throw new Error('Tab not found: '+CFG.EINVOICES_SHEET);
    ensureStatusColumn_(eiSheet);

    const ei = readTab_(ss, CFG.EINVOICES_SHEET);
    const cp = readTab_(ss, CFG.CLOSED_POS_SHEET);

    const eiCols = resolveCols_(ei.headers, {
      po: CFG.HEADERS.einv_po, po2: CFG.HEADERS.einv_po2,
      total: CFG.HEADERS.einv_total, subtotal: CFG.HEADERS.einv_subtotal,
      vat: CFG.HEADERS.einv_vat, supplier: CFG.HEADERS.einv_supplier,
      internal_id: CFG.HEADERS.einv_internal_id, invno: CFG.HEADERS.einv_invno,
      taxcard: CFG.HEADERS.einv_taxcard, date: CFG.HEADERS.einv_date,
      link: CFG.HEADERS.einv_link, status: CFG.HEADERS.einv_status,
    }, CFG.EINVOICES_SHEET);
    if (eiCols.vat < 0) {
      throw new Error('E-Invoices tab: VAT column "ضريبة القيمة المضافة" not found. VAT must be captured only from that column.');
    }

    const cpCols = resolveCols_(cp.headers, {
      po: CFG.HEADERS.cpo_po, total_cost: CFG.HEADERS.cpo_total_cost,
      vat_cost: CFG.HEADERS.cpo_vat_cost, amount: CFG.HEADERS.cpo_amount,
      supplier: CFG.HEADERS.cpo_supplier, supplier_code: CFG.HEADERS.cpo_supplier_code,
      invno: CFG.HEADERS.cpo_invno, invoiced: CFG.HEADERS.cpo_invoiced,
      closing_date: CFG.HEADERS.cpo_closing_date,
    }, CFG.CLOSED_POS_SHEET);
    if (cpCols.total_cost < 0 && cpCols.amount < 0) throw new Error('GRs tab: neither total_cost nor supplier_invoice_amount found.');

    const POSTED_STATUS = new Set([CFG.STATUS.POSTED.toLowerCase(), CFG.STATUS.POSTED_VARIANCE.toLowerCase()]);
    const eiByPO = {}, holdRows = [];
    let skippedPosted = 0, invalidPO = 0;

    ei.rows.forEach((r, idx) => {
      const sheetRow = ei.sheetRows[idx];
      const statusVal = eiCols.status >= 0 ? String(r[eiCols.status]||'').trim().toLowerCase() : '';
      if (POSTED_STATUS.has(statusVal)) { skippedPosted++; return; }
      const total    = toNumber_(r[eiCols.total]);
      const subtotal = eiCols.subtotal >= 0 ? toNumber_(r[eiCols.subtotal]) : 0;
      const vat      = eiCols.vat >= 0 ? toNumber_(r[eiCols.vat]) : 0;
      const supplier = r[eiCols.supplier];
      const invno    = eiCols.invno >= 0 ? r[eiCols.invno] : '';
      const taxcard  = eiCols.taxcard >= 0 ? r[eiCols.taxcard] : '';
      const date     = r[eiCols.date];
      const link     = eiCols.link >= 0 ? r[eiCols.link] : '';
      const internalId = eiCols.internal_id >= 0 ? r[eiCols.internal_id] : '';
      const poRaw = (eiCols.po  >= 0 ? String(r[eiCols.po]  || '').trim() : '') ||
                    (eiCols.po2 >= 0 ? String(r[eiCols.po2] || '').trim() : '');
      const poCheck = validatePO_(poRaw);
      if (!poCheck.valid) {
        invalidPO++;
        holdRows.push({ sheetRow, supplier: String(supplier||'').trim(), invno: String(invno||internalId||'').trim(), date, total, rawPO: String(poRaw||'').trim(), reason: poCheck.reason, internalId, taxcard, link });
        return;
      }
      const po = poCheck.normalized;
      if (!eiByPO[po]) eiByPO[po] = { rows:[], total:0, subtotal:0, vat:0 };
      eiByPO[po].rows.push({ sheetRow, supplier, internal_id:internalId, invno, taxcard, date, total, subtotal, vat, link });
      eiByPO[po].total += total; eiByPO[po].subtotal += subtotal; eiByPO[po].vat += vat;
    });

    const cpByPO = {}, useLineTotals = cpCols.total_cost >= 0;
    cp.rows.forEach(r => {
      const po = normalizePO_(r[cpCols.po]); if (!po) return;
      if (!cpByPO[po]) cpByPO[po] = { amount:0, subtotal:0, vat:0, hasLineTotals:useLineTotals, supplier:r[cpCols.supplier], supplier_code: cpCols.supplier_code>=0?r[cpCols.supplier_code]:'', invno:r[cpCols.invno], invoiced:r[cpCols.invoiced], closing_date: cpCols.closing_date>=0?r[cpCols.closing_date]:'', lineCount:0 };
      if (useLineTotals) { const tc=toNumber_(r[cpCols.total_cost]),vc=cpCols.vat_cost>=0?toNumber_(r[cpCols.vat_cost]):0; cpByPO[po].subtotal+=tc; cpByPO[po].vat+=vc; cpByPO[po].amount+=tc+vc; }
      else { const amt=toNumber_(r[cpCols.amount]); if(amt>cpByPO[po].amount) cpByPO[po].amount=amt; }
      if (cpCols.closing_date>=0) { const d=coerceDate_(r[cpCols.closing_date]); if(d){const cur=coerceDate_(cpByPO[po].closing_date);if(!cur||d>cur)cpByPO[po].closing_date=d;} }
      const fill=(key,idx)=>{if(idx<0)return;const cur=String(cpByPO[po][key]||'').trim();if(cur)return;const v=String(r[idx]||'').trim();if(v)cpByPO[po][key]=r[idx];};
      fill('supplier',cpCols.supplier); fill('supplier_code',cpCols.supplier_code); fill('invno',cpCols.invno); fill('invoiced',cpCols.invoiced);
      cpByPO[po].lineCount++;
    });

    const allPOs = new Set([...Object.keys(eiByPO),...Object.keys(cpByPO)]);
    const amtResults = [];
    let amtMatched=0, amtMismatch=0, onlyEI=0, onlyCP=0, dupEI=0;

    allPOs.forEach(po => {
      const e=eiByPO[po], c=cpByPO[po];
      const eTotal=e?e.total:null, cTotal=c?c.amount:null;
      const isDup=e&&e.rows.length>1;
      let status, note='', diff=null, diffPct=null;
      if (e&&!c)      { status='Only in E-Invoices'; onlyEI++; }
      else if (!e&&c) { status='Only in Closed POs'; onlyCP++; }
      else if (e&&c)  { diff=eTotal-cTotal; const base=Math.max(Math.abs(eTotal),Math.abs(cTotal),1); diffPct=diff/base; if(Math.abs(diff)<=CFG.AMOUNT_MATCH_TOLERANCE_EGP){status='Matched';amtMatched++;}else{status='Amount Mismatch';amtMismatch++;} }
      if (isDup) { note=(note?note+'; ':'')+('Duplicate PO in E-Invoices ('+e.rows.length+'x)'); dupEI++; }
      amtResults.push({ po, status, note, ei_supplier:e?e.rows[0].supplier:'', cp_supplier:c?c.supplier:'', ei_count:e?e.rows.length:0, cp_line_count:c?c.lineCount:0, ei_total:eTotal, cp_amount:cTotal, diff, diff_pct:diffPct, ei_invoice_ids:e?e.rows.map(r=>r.internal_id).join(', '):'', cp_invno:c?c.invno:'', cp_invoiced:c?c.invoiced:'', ei_links:e?e.rows.map(r=>r.link).filter(Boolean).join('\n'):'' });
    });

    const statusRank={'Amount Mismatch':0,'Only in E-Invoices':1,'Only in Closed POs':2,'Matched':3};
    amtResults.sort((a,b)=>{const rA=statusRank[a.status],rB=statusRank[b.status];if(rA!==rB)return rA-rB;return String(a.po).localeCompare(String(b.po));});

    // Reconciliation tab is now written at the end as a final PO-status dashboard,
    // after amount, qty, PPV, and posting logic have all completed.
    const reconSummary = {matched:amtMatched,amountMismatch:amtMismatch,onlyEI,onlyCP,duplicateEI:dupEI,eiRows:ei.rows.length,cpLines:cp.rows.length,eiPOCount:Object.keys(eiByPO).length,cpPOCount:Object.keys(cpByPO).length};

    deleteLegacyMismatchSheet_(ss);
    const postedKeys  = readPostedInvoiceKeys_(ss);
    const supLookupEarly = readSuppliersMaster_(ss);   // read once — reused across all generators
    const je = generateJEs_(ss, amtResults, eiByPO, cpByPO, supLookupEarly, postedKeys);
    // Mark E-Invoices: Posted - Match
    markEInvoicesStatusNew_(eiSheet, eiByPO, je.postedPOs, CFG.STATUS.POSTED_MATCH, CFG.STATUS.COLOR_POSTED);
    const holdStats = writeHoldForPOTab_(ss, holdRows);
    // Mark E-Invoices: Hold for PO
    markEInvoicesRowsByKey_(eiSheet, ei, holdRows, CFG.STATUS.HOLD_FOR_PO, CFG.STATUS.COLOR_HOLD_FOR_PO);

    // ── BLOCK 2: Qty Reconciliation ─────────────────────────────
    const supLookup = supLookupEarly;   // reuse — already read above
    const storeMap  = readStoreMapping_(ss);
    const eInvData  = readEInvoicesQty_(ss);
    const grData    = readGRsData_(ss);
    const brandMap  = readBrandMapping_(ss);

    const p1 = phase1POLevelQtyMatch_(eInvData, grData);
    const p2 = phase2DescriptionMatch_(p1.mismatches, brandMap);
    const allQtyResults = [...p1.matched, ...p2];
    enrichQtyResults_(allQtyResults, supLookup);

    // Qty Recon tab: only POs with GR > 0 AND Inv > 0 AND they don't match
    const qtyReconRows = allQtyResults.filter(r =>
      r.totalGAmt > CFG_QTY.AMOUNT_TOLERANCE &&
      r.totalEAmt > CFG_QTY.AMOUNT_TOLERANCE &&
      Math.abs(r.amtVar) > CFG_QTY.AMOUNT_TOLERANCE
    );
    writeQtyReconResults_(ss, qtyReconRows);

    // Cross-reference: Amount Mismatch POs from Block 1 that have matching qty in Block 2
    const qtyMatchedPOs = new Set(allQtyResults
      .filter(r => Math.abs(r.qtyVar) <= CFG_QTY.QTY_TOLERANCE)
      .map(r => r.po));
    const amtMismatchQtyMatchPOs = amtResults.filter(r =>
      r.status === 'Amount Mismatch' && qtyMatchedPOs.has(String(r.po))
    );
    // Single merged PPV tab — Block 2 first, Block 1 second, deduped
    const ppvMJE = generateAllPPVJEs_(ss, allQtyResults, amtMismatchQtyMatchPOs, grData, eiByPO, cpByPO, supLookup, postedKeys);
    // Mark E-Invoices: Posted - With PPV
    markEInvoicesStatusNew_(eiSheet, eiByPO, ppvMJE.postedPOs, CFG.STATUS.POSTED_PPV, CFG.STATUS.COLOR_VARIANCE);
    // Update amtResults status for Reconciliation tab
    ppvMJE.amtMatchPOs.forEach(po => {
      const r = amtResults.find(x => String(x.po) === String(po));
      if(r) r.status = 'PPV Posted (Qty Match)';
    });

    // Qty Mismatch Analysis — no JEs, flag for stock controller review
    const qtyMismatchRows = allQtyResults.filter(r =>
      r.classification === 'Qty Variance' &&
      r.totalEAmt > CFG_QTY.AMOUNT_TOLERANCE   // exclude negative/zero invoice amounts (credit notes)
    );
    writeQtyMismatchAnalysis_(ss, qtyMismatchRows, grData, storeMap, supLookup);
    // Mark E-Invoices: Quantity Mismatch
    markEInvoicesQtyMismatch_(eiSheet, eiByPO, qtyMismatchRows, CFG.STATUS.QTY_MISMATCH, CFG.STATUS.COLOR_QTY_MISMATCH);

    // ── BLOCK 3: Returns ────────────────────────────────────────
    const returnsData = readReturnsData_(ss);
    writeReturnsPostingsTab_(ss, returnsData, supLookup);

    // ── BLOCK 4: AP Payables Tracker ────────────────────────────
    writeAPPayablesTab_(ss);

    // ── BLOCK 5: GR/IR Aging (value-based) + Commercial FU ─────
    writeGRIRAgingNew_(ss, cpByPO, eiByPO, supLookup);
    writeCommercialFUTab_(ss, cpByPO, eiByPO, supLookup);

    // ── FINAL: Master Reconciliation Dashboard ──────────────────
    // One row per valid PO from either GRs or E-Invoices, showing the final operational outcome.
    writeMasterReconciliation_(ss, amtResults, allQtyResults, {
      je, ppvMJE, qtyMismatchRows, reconSummary
    });

    ui.alert('✅ Full Reconciliation Complete!',
      '── Amount Reconciliation ──\n'+
      'Matched (<=100 EGP diff): '+amtMatched+'\nAmount Mismatch: '+amtMismatch+'\n'+
      'Only in E-Invoices: '+onlyEI+'\nOnly in GRs (no invoice): '+onlyCP+'\n'+
      'Held (blank/invalid PO): '+holdStats.totalRows+'\n'+
      (skippedPosted>0?'Skipped (already posted): '+skippedPosted+'\n':'')+
      'Matched JEs: '+je.generated+'  (skipped: '+je.dupSkipped+')\n\n'+
      '── Qty Reconciliation ──\n'+
      'Qty Recon rows (value mismatch): '+qtyReconRows.length+'\n'+
      '  Price Mismatch: '+qtyReconRows.filter(r=>r.qtyMismatchType==='Price Mismatch').length+'\n'+
      'Qty Mismatch Analysis: '+qtyMismatchRows.length+' POs flagged for stock controller\n'+
      'PPV Mismatch JEs: '+ppvMJE.generated+' (Price Variance: '+ppvMJE.fromQtyRecon+' · Amt Mismatch/Qty OK: '+ppvMJE.fromAmtMismatch+') skipped: '+ppvMJE.dupSkipped+'\n\n'+
      '── E-Invoice Status Updated ──\n'+
      'Posted - Match:    '+je.generated+' POs\n'+
      'Posted - With PPV: '+ppvMJE.generated+' POs ('+ppvMJE.fromQtyRecon+' price variance + '+ppvMJE.fromAmtMismatch+' amt mismatch)\n'+
      'Quantity Mismatch: '+qtyMismatchRows.length+' POs\n'+
      'Hold for PO:       '+holdStats.totalRows+' invoices\n\n'+
      '── Other ──\n'+
      'Returns posted: '+returnsData.length+' lines\n\n'+
      'Tabs: Reconciliation · Matched POs JEs · PPV Mismatch JEs ·\n'+
      'Qty Recon · Qty Mismatch Analysis · Returns Postings ·\nHold for PO · GR/IR Aging · Commercial FU',
      ui.ButtonSet.OK);

  } catch(e) { ui.alert('❌ Error', e.message+'\n\n'+e.stack, ui.ButtonSet.OK); }
}

function runReturnsPosting_qty() {
  const ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  try {
    const returnsData=readReturnsData_(ss),supLookup=readSuppliersMaster_(ss);
    writeReturnsPostingsTab_(ss,returnsData,supLookup);
    ui.alert('✅ Returns Posted',returnsData.length+' return lines written to "'+CFG_QTY.RETURNS_JES_SHEET+'".', ui.ButtonSet.OK);
  } catch(e) { ui.alert('❌ Error',e.message,ui.ButtonSet.OK); }
}

function deleteLegacyMismatchSheet_(ss) { const sh=ss.getSheetByName(CFG.MISMATCH_JES_SHEET); if(sh&&ss.getSheets().length>1) ss.deleteSheet(sh); }

function setupAllTabs_() {
  const ss=SpreadsheetApp.getActiveSpreadsheet(),ui=SpreadsheetApp.getUi();
  const tabs=[CFG.OUTPUT_SHEET,CFG.MATCHED_JES_SHEET,CFG.HOLD_FOR_PO_SHEET,
              CFG_QTY.BRAND_MAPPING_SHEET, CFG_QTY.QTY_RECON_SHEET, CFG_QTY.PPV_MISMATCH_JES_SHEET,
              CFG_QTY.QTY_MISMATCH_ANALYSIS_SHEET, CFG_QTY.QTY_MISMATCH_PPV_JES_SHEET,
              CFG_QTY.RETURNS_JES_SHEET, CFG_QTY.GRIR_AGING_SHEET, CFG_QTY.COMMERCIAL_FU_SHEET,
              CFG.AP_PAYABLES_SHEET];
  const created=[];
  tabs.forEach(name=>{if(!ss.getSheetByName(name)){ss.insertSheet(name);created.push(name);}});
  const bm=ss.getSheetByName(CFG_QTY.BRAND_MAPPING_SHEET);
  if(bm&&bm.getLastRow()<=1){
    bm.getRange(1,1,1,3).setValues([['Arabic Term','English Term','Notes']]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');
    const seeds=[['ريفي','Reefy',''],['دانون','Danone',''],['نستله','Nestle',''],['بيبسي','Pepsi',''],['كوكاكولا','Coca Cola',''],['هاينز','Heinz',''],['كيتكات','KitKat',''],['سنيكرز','Snickers',''],['ميلكيز','Milkys',''],['فرونيري','Froneri',''],['زيلارا','Zilara',''],['صافولا','Savola',''],['دانكن','Dunkin',''],['بيور','Pure',''],['فريش','Fresh',''],['بيتي','Beyti',''],['ارما','Arma',''],['سنوبرس','Snobros','']];
    bm.getRange(2,1,seeds.length,3).setValues(seeds);
  }
  ui.alert('✅ Setup Complete','Tabs ready: '+(created.length?created.join(', '):'all already exist')+'\n\n1. Add Arabic↔English mappings to "Brand Mapping"\n2. Run: 🐇 Rabbit AP Controls to ▶ Run Full Reconciliation',ui.ButtonSet.OK);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4 — DATA READERS
// ═══════════════════════════════════════════════════════════════

function readTab_(ss, name) {
  const sh=ss.getSheetByName(name); if(!sh) throw new Error('Tab not found: '+name);
  const data=sh.getDataRange().getValues(); if(!data.length) throw new Error('Tab is empty: '+name);
  let headerIdx=0;
  for(let i=0;i<Math.min(5,data.length);i++){if(data[i].filter(v=>v!==''&&v!==null).length>=3){headerIdx=i;break;}}
  const headers=data[headerIdx].map(h=>String(h).trim()),rows=[],sheetRows=[];
  for(let i=headerIdx+1;i<data.length;i++){if(data[i].some(v=>v!==''&&v!==null)){rows.push(data[i]);sheetRows.push(i+1);}}
  return {headers,rows,sheetRows,headerRow:headerIdx+1};
}

function readEInvoicesQty_(ss) {
  const sheet=ss.getSheetByName(CFG.EINVOICES_SHEET); if(!sheet) throw new Error('Tab "'+CFG.EINVOICES_SHEET+'" not found.');
  const data=sheet.getDataRange().getValues(), headers=data[0];
  const col={};
  Object.entries(CFG_QTY.AR).forEach(([key,arName])=>{col[key]=headers.indexOf(arName);});

  // Supplier name fallback: try all Arabic variants if primary not found
  if(col.supplierName<0){
    for(const alt of CFG_QTY.AR_SUPPLIER_ALTERNATES){
      const idx=headers.indexOf(alt);
      if(idx>=0){col.supplierName=idx;Logger.log('Supplier name found via alternate: '+alt);break;}
    }
  }
  if(col.supplierName<0) Logger.log('⚠️ Supplier name column not found in E-Invoices. Tried: '+[CFG_QTY.AR.supplierName,...CFG_QTY.AR_SUPPLIER_ALTERNATES].join(', '));

  const records=[];
  for(let i=1;i<data.length;i++){
    const row=data[i]; if(row.every(v=>v===''||v===null)) continue;
    const poRefRaw=col.poRef>=0?String(row[col.poRef]||''):'',poDescRaw=col.poDesc>=0?String(row[col.poDesc]||''):'';
    const poNumber=extractPOFromText_(poRefRaw)||extractPOFromText_(poDescRaw)||'NO_PO';
    const qty=toNumber_(col.qty>=0?row[col.qty]:0),totalBeforeVAT=toNumber_(col.totalBeforeVAT>=0?row[col.totalBeforeVAT]:0),totalAfterVAT=toNumber_(col.totalAfterVAT>=0?row[col.totalAfterVAT]:0);
    if(qty===0&&totalBeforeVAT===0) continue;
    if(totalBeforeVAT<0||totalAfterVAT<0) continue;   // exclude credit notes
    const rawSupplierName = col.supplierName>=0 ? String(row[col.supplierName]||'').trim() : '';
    records.push({rowNum:i+1,poNumber,poRefRaw,poDescRaw,itemCode:col.itemCode>=0?String(row[col.itemCode]||'').trim():'',eInvoiceSupplierName:rawSupplierName,supplierName:rawSupplierName,invoiceNum:col.invoiceNum>=0?String(row[col.invoiceNum]||'').trim():'',invoiceDate:col.invoiceDate>=0?row[col.invoiceDate]:'',taxId:col.taxId>=0?String(row[col.taxId]||'').trim():'',qty,unitPrice:toNumber_(col.unitPrice>=0?row[col.unitPrice]:0),totalBeforeVAT,totalAfterVAT});
  }
  Logger.log('E-Invoices (Qty): '+records.length+' lines'); return records;
}

function readGRsData_(ss) {
  const sheet=ss.getSheetByName(CFG_QTY.GRS_SHEET); if(!sheet) throw new Error('Tab "'+CFG_QTY.GRS_SHEET+'" not found.');
  const data=sheet.getDataRange().getValues(),headers=data[0].map(h=>String(h).trim().toLowerCase().replace(/\s+/g,'_'));
  const fH=(...n)=>{for(const x of n){const i=headers.findIndex(h=>h.includes(x));if(i>=0)return i;}return -1;};
  const col={storeId:fH('store_id'),qty:fH('received_quantity','quantity'),skuNo:fH('sku_no','sku'),barcode:fH('piece_barcode','barcode'),productName:fH('product_name','item_name'),baseCost:fH('base_cost','unit_cost'),totalCost:fH('total_cost','total'),vatCost:fH('vat_cost','vat'),supplierCode:fH('supplier_code','supplier_id'),supplierName:fH('supplier_name','supplier'),poId:fH('purchase_order_id','po_id','po_number'),updatedAt:fH('updated_at','upda_ed_a','date'),invAmount:fH('supplier_invoice_amount','invoice_amount'),invNumber:fH('supplier_invoice_number','invoice_number','inoviced')};
  const records=[];
  for(let i=1;i<data.length;i++){
    const row=data[i],po=col.poId>=0?String(row[col.poId]||'').trim():'';
    if(!po&&!(col.supplierCode>=0&&row[col.supplierCode])) continue;
    records.push({rowNum:i+1,storeId:col.storeId>=0?row[col.storeId]:'',qty:toNumber_(col.qty>=0?row[col.qty]:0),skuNo:col.skuNo>=0?String(row[col.skuNo]||'').trim():'',barcode:col.barcode>=0?String(row[col.barcode]||'').trim():'',productName:col.productName>=0?String(row[col.productName]||'').trim():'',baseCost:toNumber_(col.baseCost>=0?row[col.baseCost]:0),totalCost:toNumber_(col.totalCost>=0?row[col.totalCost]:0),vatCost:toNumber_(col.vatCost>=0?row[col.vatCost]:0),supplierCode:col.supplierCode>=0?String(row[col.supplierCode]||'').trim():'',supplierName:col.supplierName>=0?String(row[col.supplierName]||'').trim():'',poNumber:po,updatedAt:col.updatedAt>=0?row[col.updatedAt]:'',invAmount:toNumber_(col.invAmount>=0?row[col.invAmount]:0),invNumber:col.invNumber>=0?String(row[col.invNumber]||'').trim():''});
  }
  Logger.log('GRs: '+records.length+' lines'); return records;
}

function readReturnsData_(ss) {
  const sheet=ss.getSheetByName(CFG_QTY.RETURNS_SHEET); if(!sheet) throw new Error('Tab "'+CFG_QTY.RETURNS_SHEET+'" not found.');
  const data=sheet.getDataRange().getValues(),headers=data[0].map(h=>String(h).trim().toLowerCase().replace(/[\s\/]+/g,'_'));
  const fH=(...n)=>{for(const x of n){const i=headers.findIndex(h=>h.includes(x));if(i>=0)return i;}return -1;};
  const vatCols=headers.reduce((acc,h,i)=>h==='vat'?[...acc,i]:acc,[]);
  const col={returnPO:fH('id'),supplier:fH('supplier'),store:fH('store'),item:fH('item'),skuNo:fH('sku_no','sku'),barcode:fH('piece_barcode','barcode'),returnDate:fH('return_date','po_creation_date'),type:fH('type'),baseCost:fH('base_cost'),quantity:fH('quantity'),returned:fH('returned'),replaced:fH('replaced'),total:fH('total'),returnBeforeVAT:fH('return_before_vat'),vatAmount:vatCols.length>1?vatCols[1]:(vatCols[0]>=0?vatCols[0]:-1),reasonEn:fH('reason_en'),reasonAr:fH('reason_ar')};
  const records=[];
  for(let i=1;i<data.length;i++){
    const row=data[i]; if(!row[col.returnPO]&&!(col.supplier>=0&&row[col.supplier])) continue;
    const returnBeforeVAT=toNumber_(col.returnBeforeVAT>=0?row[col.returnBeforeVAT]:row[col.total]);
    records.push({rowNum:i+1,returnPO:String(row[col.returnPO]||'').trim(),supplier:col.supplier>=0?String(row[col.supplier]||'').trim():'',store:col.store>=0?row[col.store]:'',item:col.item>=0?String(row[col.item]||'').trim():'',skuNo:col.skuNo>=0?String(row[col.skuNo]||'').trim():'',barcode:col.barcode>=0?String(row[col.barcode]||'').trim():'',returnDate:col.returnDate>=0?row[col.returnDate]:'',type:col.type>=0?String(row[col.type]||'').trim():'',baseCost:toNumber_(col.baseCost>=0?row[col.baseCost]:0),quantity:toNumber_(col.quantity>=0?row[col.quantity]:0),returned:toNumber_(col.returned>=0?row[col.returned]:0),replaced:toNumber_(col.replaced>=0?row[col.replaced]:0),total:toNumber_(col.total>=0?row[col.total]:0),returnBeforeVAT,vatAmount:toNumber_(col.vatAmount>=0?row[col.vatAmount]:0),reasonEn:col.reasonEn>=0?String(row[col.reasonEn]||'').trim():'',reasonAr:col.reasonAr>=0?String(row[col.reasonAr]||'').trim():''});
  }
  Logger.log('Returns: '+records.length+' lines'); return records;
}

function readBrandMapping_(ss) {
  const sheet=ss.getSheetByName(CFG_QTY.BRAND_MAPPING_SHEET); if(!sheet) return {};
  const data=sheet.getDataRange().getValues(),map={};
  for(let i=1;i<data.length;i++){const ar=normalizeArText_(String(data[i][0]||'')),en=normalizeArText_(String(data[i][1]||''));if(ar&&en){map[ar]=en;map[en]=ar;}}
  Logger.log('Brand Mapping: '+(Object.keys(map).length/2)+' pairs'); return map;
}


function readStoreMapping_(ss) {
  // Optional store/branch mapping reader.
  // If no mapping tab exists, the script continues and downstream outputs can fall back to Store ID.

  const candidates = [
    'Store Mapping',
    'Stores Mapping',
    'Stores',
    'Store Master',
    'Branches',
    'Branch Mapping'
  ];

  let sheet = null;
  for (const name of candidates) {
    sheet = ss.getSheetByName(name);
    if (sheet) break;
  }

  if (!sheet) {
    Logger.log('Store Mapping tab not found. Continuing without store names.');
    return {};
  }

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return {};

  const headers = data[0].map(h =>
    String(h || '').trim().toLowerCase().replace(/[\s\-\/]+/g, '_')
  );

  const findCol = (...names) => {
    for (const n of names) {
      const idx = headers.findIndex(h => h === n || h.includes(n));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const cStoreId = findCol(
    'store_id',
    'storeid',
    'branch_id',
    'branchid',
    'id'
  );

  const cStoreName = findCol(
    'store_name',
    'storename',
    'branch_name',
    'branchname',
    'name',
    'store',
    'branch'
  );

  const cStockController = findCol(
    'stock_controller',
    'stockcontroller',
    'controller',
    'stock_owner',
    'owner'
  );

  const map = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const storeId = cStoreId >= 0
      ? String(row[cStoreId] || '').trim()
      : '';

    if (!storeId) continue;

    map[storeId] = {
      storeId,
      storeName: cStoreName >= 0 ? String(row[cStoreName] || '').trim() : storeId,
      stockController: cStockController >= 0 ? String(row[cStockController] || '').trim() : ''
    };
  }

  Logger.log('Store Mapping: ' + Object.keys(map).length + ' stores loaded');
  return map;
}



// ═══════════════════════════════════════════════════════════════
// SECTION 5 — QTY RECONCILIATION ENGINE
// ═══════════════════════════════════════════════════════════════

function phase1POLevelQtyMatch_(eInvData, grData) {
  const eByPO=groupByKey_(eInvData.filter(r=>r.poNumber!=='NO_PO'),'poNumber');
  const gByPO=groupByKey_(grData.filter(r=>r.poNumber),'poNumber');
  const allPOs=new Set([...Object.keys(eByPO),...Object.keys(gByPO)]);
  const matched=[],mismatches=[];

  allPOs.forEach(po=>{
    const eLines=eByPO[po]||[],gLines=gByPO[po]||[];
    const totalEQty=eLines.reduce((s,r)=>s+r.qty,0),totalGQty=gLines.reduce((s,r)=>s+r.qty,0);
    const totalEAmt=eLines.reduce((s,r)=>s+r.totalBeforeVAT,0),totalGAmt=gLines.reduce((s,r)=>s+r.totalCost,0);
    const totalEVAT=eLines.reduce((s,r)=>s+r.totalAfterVAT,0);
    const qtyVar=round2_(totalEQty-totalGQty),amtVar=round2_(totalEAmt-totalGAmt);
    const eInvoiceSupplierName=(eLines[0]?eLines[0].eInvoiceSupplierName||eLines[0].supplierName:'')||'';
    const supplierCode=gLines[0]?gLines[0].supplierCode:'';
    const invNumber=(eLines[0]?eLines[0].invoiceNum:'')||(gLines[0]?gLines[0].invNumber:'');
    const taxId=eLines[0]?eLines[0].taxId:'',invDate=eLines[0]?eLines[0].invoiceDate:'',grDate=gLines[0]?gLines[0].updatedAt:'';
    const base={po,supplierCode,eInvoiceSupplierName,supplierName:eInvoiceSupplierName,mappedSupplierName:'',financeOwner:'',cmOwner:'',invNumber,taxId,invDate,grDate,totalEQty,totalGQty,qtyVar,totalEAmt,totalGAmt,amtVar,totalEVAT,eLines,gLines,phase:1};

    if (eLines.length===0)                                                                     matched.push({...base,classification:'Missing Invoice',qtyMismatchType:'Missing Invoice'});
    else if (gLines.length===0)                                                                matched.push({...base,classification:'No GR',qtyMismatchType:'No GR'});
    else if (Math.abs(amtVar)<=CFG_QTY.AMOUNT_TOLERANCE)                                      matched.push({...base,classification:'Matched',qtyMismatchType:'Matched'});
    else if (Math.abs(qtyVar)<=CFG_QTY.QTY_TOLERANCE)                                        matched.push({...base,classification:'Price Variance',qtyMismatchType:'Price Mismatch'});
    else if(Math.abs(amtVar)<=5)                                                              matched.push({...base,classification:'Matched',qtyMismatchType:'Matched'});
    else                                                                                       mismatches.push({...base,classification:'Qty Variance',qtyMismatchType:'Qty Mismatch'});
  });

  (eByPO['NO_PO']||[]).forEach(e=>matched.push({po:'NO_PO_REF',supplierCode:'',eInvoiceSupplierName:e.eInvoiceSupplierName||e.supplierName,supplierName:e.eInvoiceSupplierName||e.supplierName,mappedSupplierName:'',financeOwner:'',cmOwner:'',invNumber:e.invoiceNum,taxId:e.taxId,invDate:e.invoiceDate,grDate:'',totalEQty:e.qty,totalGQty:0,qtyVar:e.qty,totalEAmt:e.totalBeforeVAT,totalGAmt:0,amtVar:e.totalBeforeVAT,totalEVAT:e.totalAfterVAT,eLines:[e],gLines:[],phase:1,classification:'No PO Reference',qtyMismatchType:'No PO Reference'}));

  Logger.log('Phase 1: '+matched.length+' resolved, '+mismatches.length+' to Phase 2');
  return {matched,mismatches};
}

function phase2DescriptionMatch_(mismatches, brandMap) {
  const results=[];
  mismatches.forEach(po=>{
    const b=matchByBarcode_(po.eLines.slice(),po.gLines.slice());
    const n=matchByNumericPattern_(b.remainingE,b.remainingG);
    const k=matchByBrandMap_(n.remainingE,n.remainingG,brandMap);
    const allMatches=[...b.matches,...n.matches,...k.matches];
    const confRank={High:3,Medium:2,Low:1};
    const minConf=allMatches.length?allMatches.reduce((mn,m)=>confRank[m.confidence]<confRank[mn]?m.confidence:mn,'High'):'Low';
    const confLabel=minConf==='High'?'🟢 Phase 2 — Auto':minConf==='Medium'?'🟡 Phase 2 — Review':'🔴 Phase 2 — Manual';

    // After Phase 2 description matching, re-evaluate: is it really qty or price?
    let classification, qtyMismatchType;
    if (Math.abs(po.amtVar)<=CFG_QTY.AMOUNT_TOLERANCE) {
      classification='Matched'; qtyMismatchType='Matched';
    } else if (Math.abs(po.qtyVar)<=CFG_QTY.QTY_TOLERANCE) {
      classification='Price Variance'; qtyMismatchType='Price Mismatch';
    } else if (Math.abs(po.qtyVar)>CFG_QTY.QTY_TOLERANCE&&Math.abs(po.amtVar)<=5) {
      classification='Matched'; qtyMismatchType='Matched';
    } else if (Math.abs(po.qtyVar)>CFG_QTY.QTY_TOLERANCE&&Math.abs(po.amtVar)>CFG_QTY.AMOUNT_TOLERANCE) {
      classification='Qty Variance'; qtyMismatchType='Qty Mismatch';
    } else {
      classification='Qty Variance'; qtyMismatchType='Qty Mismatch';
    }

    const glVar = classification==='Price Variance'
      ? CFG_QTY.GL_PPV_QTY.num+' — '+CFG_QTY.GL_PPV_QTY.name
      : CFG.JE.GL_GRIR.num+' — '+CFG.JE.GL_GRIR.name;

    results.push({...po,phase:2,classification,qtyMismatchType,confidence:confLabel,glVar,varAmt:po.amtVar,lineMatches:allMatches,unmatchedE:k.remainingE,unmatchedG:k.remainingG,phaseDetail:'Barcode:'+b.matches.length+' | Numeric:'+n.matches.length+' | BrandMap:'+k.matches.length+' | Unmatched:'+k.remainingE.length});
  });
  Logger.log('Phase 2: '+results.length+' POs'); return results;
}

function matchByBarcode_(eLines,gLines){const matches=[],usedG=new Set(),remE=[];eLines.forEach(e=>{if(!e.itemCode){remE.push(e);return;}const idx=gLines.findIndex((g,i)=>!usedG.has(i)&&(g.barcode===e.itemCode||g.skuNo===e.itemCode));if(idx>=0){usedG.add(idx);matches.push({eItem:e,gItem:gLines[idx],confidence:'High',method:'Barcode'});}else remE.push(e);});return{matches,remainingE:remE,remainingG:gLines.filter((_,i)=>!usedG.has(i))};}
function matchByNumericPattern_(eLines,gLines){const matches=[],usedG=new Set(),remE=[];eLines.forEach(e=>{const eNums=extractNums_(normalizeArText_(e.itemCode+' '+e.poDescRaw));if(!eNums.length){remE.push(e);return;}let bestIdx=-1,bestScore=0;gLines.forEach((g,i)=>{if(usedG.has(i))return;const sc=numOverlapScore_(eNums,extractNums_(normalizeArText_(g.productName+' '+g.skuNo)));if(sc>bestScore&&sc>=0.6){bestScore=sc;bestIdx=i;}});if(bestIdx>=0){usedG.add(bestIdx);matches.push({eItem:e,gItem:gLines[bestIdx],confidence:'Medium',method:'Numeric('+Math.round(bestScore*100)+'%)'});}else remE.push(e);});return{matches,remainingE:remE,remainingG:gLines.filter((_,i)=>!usedG.has(i))};}
function matchByBrandMap_(eLines,gLines,brandMap){const matches=[],usedG=new Set(),remE=[];eLines.forEach(e=>{const eNorm=applyBrandMapping_(normalizeArText_(e.itemCode+' '+e.poDescRaw),brandMap);let bestIdx=-1,bestScore=0;gLines.forEach((g,i)=>{if(usedG.has(i))return;const sc=qtyWordSimilarity_(eNorm,applyBrandMapping_(normalizeArText_(g.productName),brandMap));if(sc>bestScore&&sc>=0.5){bestScore=sc;bestIdx=i;}});if(bestIdx>=0){usedG.add(bestIdx);matches.push({eItem:e,gItem:gLines[bestIdx],confidence:'Low',method:'BrandMap('+Math.round(bestScore*100)+'%)'});}else remE.push(e);});return{matches,remainingE:remE,remainingG:gLines.filter((_,i)=>!usedG.has(i))};}


// ═══════════════════════════════════════════════════════════════
// SECTION 5b — SUPPLIER ENRICHMENT
// ═══════════════════════════════════════════════════════════════

function enrichQtyResults_(results, supLookup) {
  (results||[]).forEach(r => {
    const rawName = String(r.eInvoiceSupplierName || r.supplierName || '').trim();
    r.eInvoiceSupplierName = rawName;
    const sup = lookupSupplierFuzzy_(supLookup, rawName);
    const found = !!(sup && sup.name);
    r.mappedSupplierName = found ? String(sup.name || '').trim() : '';
    r.supplierCode       = found ? String(sup.code  || r.supplierCode || '').trim() : (r.supplierCode || '');
    r.financeOwner       = found ? String(sup.owner || '').trim() : '';
    r.cmOwner            = found ? String(sup.cm    || '').trim() : '';
    r.supplierName       = r.mappedSupplierName || rawName;
  });
  return results;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6 — JE GENERATORS
// ═══════════════════════════════════════════════════════════════

function generateJEs_(ss, results, eiByPO, cpByPO, supLookup, postedKeys) {
  if(!supLookup) supLookup=readSuppliersMaster_(ss);
  if(!postedKeys) postedKeys=readPostedInvoiceKeys_(ss);
  const matchedResults=results.filter(r=>r.status==='Matched');
  const jeRows=[];let generated=0,dupSkipped=0;const postedPOs=[];
  const r2=round2_;
  matchedResults.forEach(r=>{
    const e=eiByPO[r.po],c=cpByPO[r.po]; if(!e||e.rows.length===0) return;
    const supplierName=String(e.rows[0].supplier||c.supplier||'').trim();
    // Dedup check — use first invoice no
    const firstInvNo=String(c.invno||e.rows[0].internal_id||'').trim();
    const dedupKey=supplierName.toLowerCase()+'|'+firstInvNo.toLowerCase();
    if(firstInvNo&&postedKeys.has(dedupKey)){dupSkipped++;postedPOs.push(r.po);return;}
    const sup=lookupSupplierFuzzy_(supLookup,supplierName)||{};
    const term=sup.term||'';
    const supplierCode=String(sup.code||c.supplier_code||'').trim();
    const supplierTaxId=String(sup.taxid||e.rows[0].taxcard||'').trim();
    const supNameMap=String(sup.name||supplierName||c.supplier||'').trim();
    const owner=String(sup.owner||'').trim();

    // Total GR subtotal for single GRIR leg
    let grSub=r2(e.subtotal||0),grTotal=r2(e.total||0);
    if(grSub===0&&grTotal!==0) grSub=r2(grTotal/1.14);
    const baseDesc=buildJeDescription_(String(c.supplier||sup.name||supplierName).trim(),supplierCode,r.po,'',supplierTaxId);

    // Single GRIR leg
    const invoiceDate=coerceDate_(e.rows[0].date)||new Date();
    const commonBase=[CFG.JE.TYPE_CODE,invoiceDate,'','','','','','',supplierName,'',r.po,baseDesc+' | GR/IR Total',term,'',supNameMap,owner,supplierCode,supplierTaxId,grTotal,'','',''];
    const lGRIR=commonBase.slice();lGRIR[2]=CFG.JE.GL_GRIR.num;lGRIR[3]=CFG.JE.GL_GRIR.name;lGRIR[6]=grSub;
    jeRows.push(lGRIR);

    // One VAT + one Payables pair per actual E-Invoice invoice number.
    // VAT is taken ONLY from the E-Invoices column "ضريبة القيمة المضافة";
    // it is never recalculated from subtotal/total here.
    groupAmountInvoiceRowsByInvoice_(e.rows).forEach(inv=>{
      const invNo=String(inv.invoiceNo||'').trim();
      const invDate=coerceDate_(inv.invoiceDate)||invoiceDate;
      const dueDate=computeDueDate_(invDate,term);
      const invTaxId=String(inv.taxId||supplierTaxId).trim();
      const rowVat=r2(inv.vat||0);
      let rowTotal=r2(inv.total||0);
      if(rowTotal===0){ rowTotal=r2((inv.subtotal||0)+rowVat); }
      const desc=buildJeDescription_(String(c.supplier||sup.name||supplierName).trim(),supplierCode,r.po,invNo,invTaxId);
      const common=[CFG.JE.TYPE_CODE,invDate,'','','','','','',supplierName,invNo,r.po,desc,term,dueDate,supNameMap,owner,supplierCode,invTaxId,rowTotal,'','',''];
      const lVAT=common.slice();lVAT[2]=CFG.JE.GL_VAT.num;lVAT[3]=CFG.JE.GL_VAT.name+' | Inv# '+invNo;lVAT[6]=rowVat;
      const lPay=common.slice();lPay[2]=CFG.JE.GL_PAYABLES.num;lPay[3]=CFG.JE.GL_PAYABLES.name;lPay[7]=-rowTotal;
      if(Math.abs(rowVat)>0.01) jeRows.push(lVAT);
      jeRows.push(lPay);
    });
    generated++;postedPOs.push(r.po);
  });
  const legsPerJe=3; // GRIR + (VAT+Payables)*N — variable but 3 is minimum
  writeJeTab_(ss,{sheetName:CFG.MATCHED_JES_SHEET,title:'Matched POs — Journal Entries (for review)',subtitle:'1 GRIR leg (total) · VAT + Payables subtotaled per invoice number. VAT is taken only from column "ضريبة القيمة المضافة" and skipped if zero. Review then copy to General Entries.',legsPerJe},jeRows,{generated,dupSkipped,sourceCount:matchedResults.length,sourceLabel:'Matched POs'});
  return {generated,dupSkipped,postedPOs};
}

// ═══════════════════════════════════════════════════════════════
// MERGED PPV JE GENERATOR — single tab, no duplicates
// ═══════════════════════════════════════════════════════════════

/**
 * Writes ALL PPV journal entries into one "PPV Mismatch JEs" tab.
 *
 * Source 1 (Block 2): Price Variance POs — qty matched, price differs
 * Source 2 (Block 1): Amount Mismatch POs — total diff > 100 EGP, qty confirmed equal
 *
 * Block 2 runs first. Block 1 skips any PO already posted by Block 2.
 *
 * JE structure per PO:
 *   DR  GR/IR   2000011  [GR total]          1 leg
 *   DR/CR PPV   4000009  [variance total]    1 leg
 *   DR  VAT     1000003  [per invoice line]  N legs — Inv# in account name
 *   CR  Payable 2000000  [per invoice line]  N legs
 *
 * Col 23 (outside standard 22 JE cols): Source label — for review only,
 * do NOT copy to General Entries.
 */

// ═══════════════════════════════════════════════════════════════
// PPV JE HELPERS — GROUP E-INVOICE LINES BY ACTUAL INVOICE NUMBER
// ═══════════════════════════════════════════════════════════════

/**
 * Groups Qty E-Invoice item lines by invoice number so duplicate invoices under
 * the same PO create one VAT + Payables pair per invoice number, not repeated
 * lines with the first invoice number.
 */
function groupQtyInvoiceLinesByInvoice_(eLines) {
  const byInv = {};
  (eLines || []).forEach((line, idx) => {
    const invNo = String(line.invoiceNum || line.invno || line.internal_id || ('NO_INV_' + (idx + 1))).trim();
    const key = invNo || ('NO_INV_' + (idx + 1));
    if (!byInv[key]) {
      byInv[key] = {
        invoiceNo: invNo,
        invoiceDate: line.invoiceDate || line.date || '',
        taxId: line.taxId || line.taxcard || '',
        totalBeforeVAT: 0,
        totalAfterVAT: 0,
        lines: []
      };
    }
    byInv[key].totalBeforeVAT += toNumber_(line.totalBeforeVAT || line.subtotal || 0);
    byInv[key].totalAfterVAT  += toNumber_(line.totalAfterVAT  || line.total    || 0);
    byInv[key].lines.push(line);
  });
  return Object.values(byInv);
}

/**
 * Groups amount-reconciliation E-Invoice rows by invoice number so VAT and
 * Payables lines carry the exact invoice number from each E-Invoice row.
 */
function groupAmountInvoiceRowsByInvoice_(rows) {
  const byInv = {};
  (rows || []).forEach((row, idx) => {
    const invNo = String(row.invno || row.invoiceNum || row.internal_id || ('NO_INV_' + (idx + 1))).trim();
    const key = invNo || ('NO_INV_' + (idx + 1));
    if (!byInv[key]) {
      byInv[key] = {
        invoiceNo: invNo,
        invoiceDate: row.date || row.invoiceDate || '',
        taxId: row.taxcard || row.taxId || '',
        subtotal: 0,
        vat: 0,
        total: 0,
        rows: []
      };
    }
    byInv[key].subtotal += toNumber_(row.subtotal || row.totalBeforeVAT || 0);
    byInv[key].vat      += toNumber_(row.vat || 0);
    byInv[key].total    += toNumber_(row.total || row.totalAfterVAT || 0);
    byInv[key].rows.push(row);
  });
  return Object.values(byInv);
}

function generateAllPPVJEs_(ss, qtyResults, amtMismatchPOs, grData, eiByPO, cpByPO, supLookup, postedKeys) {
  if(!postedKeys) postedKeys=readPostedInvoiceKeys_(ss);
  const gByPO=groupByKey_(grData.filter(r=>r.poNumber),'poNumber'), r2=round2_;
  const jeRows=[];
  let generated=0, dupSkipped=0, fromQtyRecon=0, fromAmtMismatch=0;
  const postedPOs=[], postedSet=new Set(), amtMatchPOs=[];

  // ── Source 1: Price Variance from Qty Recon ──────────────────────
  qtyResults.filter(r=>r.classification==='Price Variance').forEach(r=>{
    const eLines=r.eLines||[], g=gByPO[r.po]||[];
    if(!eLines.length) return;
    if(postedSet.has(String(r.po))){dupSkipped++;return;}
    const firstInvNo=String(eLines[0]?eLines[0].invoiceNum:'').trim();
    const supplierName=String(r.supplierName||'').trim();
    if(firstInvNo&&postedKeys.has(supplierName.toLowerCase()+'|'+firstInvNo.toLowerCase())){dupSkipped++;return;}

    const sup=lookupSupplierFuzzy_(supLookup,r.eInvoiceSupplierName||supplierName)||{};
    const invoiceDate=coerceDate_(r.invDate)||new Date(), term=sup.term||'';
    const supCode=String(sup.code||r.supplierCode||(g[0]?g[0].supplierCode:'')||'').trim();
    const supTaxId=String(sup.taxid||r.taxId||'').trim();
    const supNameMap=String(sup.name||supplierName).trim(), owner=String(sup.owner||'').trim();
    const grSub=r2(r.totalGAmt), pvAmt=r2(r.amtVar);
    const invTotalAll=r2(r.totalEVAT||r.totalEAmt*(1+CFG.VAT_RATE));
    const source='Price Variance';
    const baseDesc=buildJeDescription_(String(g[0]?g[0].supplierName:supplierName).trim(),supCode,r.po,'',supTaxId)+' | Price Variance / PPV';

    // Single GRIR leg
    const bC=[CFG.JE.TYPE_CODE,invoiceDate,'','','','','','',supplierName,'',r.po,baseDesc,term,'',supNameMap,owner,supCode,supTaxId,invTotalAll,'','','',source];
    const lGR=bC.slice();lGR[2]=CFG.JE.GL_GRIR.num;lGR[3]=CFG.JE.GL_GRIR.name;lGR[6]=grSub;
    jeRows.push(lGR);
    // Single PPV leg
    const lPP=bC.slice();lPP[2]=CFG_QTY.GL_PPV_QTY.num;lPP[3]=CFG_QTY.GL_PPV_QTY.name;
    if(pvAmt>=0)lPP[6]=pvAmt;else lPP[7]=Math.abs(pvAmt);
    jeRows.push(lPP);
    // One VAT + one Payables pair per actual E-Invoice invoice number
    groupQtyInvoiceLinesByInvoice_(eLines).forEach(inv=>{
      let lSub=r2(inv.totalBeforeVAT||0);
      let lTotal=r2(inv.totalAfterVAT||0);
      if(lTotal===0&&lSub!==0) lTotal=r2(lSub*(1+CFG.VAT_RATE));
      const lVat=r2(lTotal-lSub);
      const invNo=String(inv.invoiceNo||'').trim();
      const lDate=coerceDate_(inv.invoiceDate)||invoiceDate;
      const due=computeDueDate_(lDate,term);
      const desc=buildJeDescription_(String(g[0]?g[0].supplierName:supplierName).trim(),supCode,r.po,invNo,String(inv.taxId||supTaxId).trim())+' | Price Variance / PPV';
      const c=[CFG.JE.TYPE_CODE,lDate,'','','','','','',supplierName,invNo,r.po,desc,term,due,supNameMap,owner,supCode,String(inv.taxId||supTaxId).trim(),lTotal,'','','',source];
      const lV=c.slice();lV[2]=CFG.JE.GL_VAT.num;lV[3]=CFG.JE.GL_VAT.name;lV[6]=lVat;
      const lPy=c.slice();lPy[2]=CFG.JE.GL_PAYABLES.num;lPy[3]=CFG.JE.GL_PAYABLES.name;lPy[7]=-lTotal;
      if(Math.abs(lVat)>0.01) jeRows.push(lV);
      jeRows.push(lPy);
    });
    generated++;fromQtyRecon++;
    postedPOs.push(r.po);postedSet.add(String(r.po));
  });

  // ── Source 2: Amount Mismatch + Qty Match from Block 1 ───────────
  amtMismatchPOs.forEach(r=>{
    const e=eiByPO[r.po], c=cpByPO[r.po];
    if(!e||e.rows.length===0) return;
    if(postedSet.has(String(r.po))){dupSkipped++;return;} // already posted by Block 2
    const supplierName=String(e.rows[0].supplier||c.supplier||'').trim();
    const firstInvNo=String(c.invno||e.rows[0].internal_id||'').trim();
    if(firstInvNo&&postedKeys.has(supplierName.toLowerCase()+'|'+firstInvNo.toLowerCase())){dupSkipped++;return;}

    const sup=lookupSupplierFuzzy_(supLookup,supplierName)||{};
    const term=sup.term||'';
    const supplierCode=String(sup.code||c.supplier_code||'').trim();
    const supplierTaxId=String(sup.taxid||e.rows[0].taxcard||'').trim();
    const supNameMap=String(sup.name||supplierName||c.supplier||'').trim();
    const owner=String(sup.owner||'').trim();
    const grTotal=r2(toNumber_(c.amount));
    const grSub=r2(grTotal/1.14);
    const invTotalAll=r2(e.total||0);
    const pvAmt=r2(invTotalAll-grTotal);
    const invoiceDate=coerceDate_(e.rows[0].date)||new Date();
    const source='Amt Mismatch - Qty OK';
    const baseDesc=buildJeDescription_(String(c.supplier||sup.name||supplierName).trim(),supplierCode,String(r.po),'',supplierTaxId)+' | Amt Mismatch / Qty Match PPV';

    // Single GRIR leg
    const bC=[CFG.JE.TYPE_CODE,invoiceDate,'','','','','','',supplierName,'',String(r.po),baseDesc,term,'',supNameMap,owner,supplierCode,supplierTaxId,invTotalAll,'','','',source];
    const lGR=bC.slice();lGR[2]=CFG.JE.GL_GRIR.num;lGR[3]=CFG.JE.GL_GRIR.name;lGR[6]=grSub;
    jeRows.push(lGR);
    // Single PPV leg
    const lPP=bC.slice();lPP[2]=CFG_QTY.GL_PPV_QTY.num;lPP[3]=CFG_QTY.GL_PPV_QTY.name;
    if(pvAmt>=0)lPP[6]=pvAmt;else lPP[7]=Math.abs(pvAmt);
    jeRows.push(lPP);
    // One VAT + one Payables pair per actual E-Invoice invoice number
    groupAmountInvoiceRowsByInvoice_(e.rows).forEach(inv=>{
      const rowVat=r2(inv.vat||0); // exact VAT from E-Invoices column "ضريبة القيمة المضافة" only
      let rowTotal=r2(inv.total||0);
      if(rowTotal===0){ rowTotal=r2((inv.subtotal||0)+rowVat); }
      const invNo=String(inv.invoiceNo||'').trim();
      const invDate=coerceDate_(inv.invoiceDate)||invoiceDate;
      const due=computeDueDate_(invDate,term);
      const invTaxId=String(inv.taxId||supplierTaxId).trim();
      const desc=buildJeDescription_(String(c.supplier||sup.name||supplierName).trim(),supplierCode,String(r.po),invNo,invTaxId);
      const cm=[CFG.JE.TYPE_CODE,invDate,'','','','','','',supplierName,invNo,String(r.po),desc,term,due,supNameMap,owner,supplierCode,invTaxId,rowTotal,'','','',source];
      const lV=cm.slice();lV[2]=CFG.JE.GL_VAT.num;lV[3]=CFG.JE.GL_VAT.name;lV[6]=rowVat;
      const lPy=cm.slice();lPy[2]=CFG.JE.GL_PAYABLES.num;lPy[3]=CFG.JE.GL_PAYABLES.name;lPy[7]=-rowTotal;
      if(Math.abs(rowVat)>0.01) jeRows.push(lV);
      jeRows.push(lPy);
    });
    generated++;fromAmtMismatch++;
    postedPOs.push(String(r.po));postedSet.add(String(r.po));
    amtMatchPOs.push(String(r.po));
  });

  // ── Write merged tab ──────────────────────────────────────────────
  let sh=ss.getSheetByName(CFG_QTY.PPV_MISMATCH_JES_SHEET);
  if(sh) sh.clear(); else sh=ss.insertSheet(CFG_QTY.PPV_MISMATCH_JES_SHEET);
  const now=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm');
  const totalSrc=fromQtyRecon+fromAmtMismatch;
  sh.getRange('A1').setValue('PPV Mismatch Journal Entries — Price Variance + Amt Mismatch/Qty Match (for review)').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: '+now+' | JEs: '+generated+' (Price Variance: '+fromQtyRecon+' | Amt Mismatch/Qty OK: '+fromAmtMismatch+') | Skipped: '+dupSkipped).setFontStyle('italic').setFontColor('#595959');
  sh.getRange('A3').setValue('1 GRIR + 1 PPV leg (totals) + VAT & Payables split per invoice line. Description is in Col I. Source is kept in Col S for review only.').setFontStyle('italic').setFontColor('#8B0000');
  // PPV Mismatch JEs output excludes old Columns S:V from the standard JE layout:
  // Suppliers Invoice amount, Invoiced?, Store Id, Posting Date.
  // Source is kept as the final review-only column.
  const header=[...['#','Date','Account Number','Account Name','Location','Cost Center','Debit','Credit','Description','Supplier Name','Invoice #','PO','Payment Terms','Due Date','Supplier Name (Mapping)','Owner','Suppliers Code','Tax ID'],'Source'];
  const ppvOutputRows = applyGLNamesFromMapping_(ss, jeRows.map(r => [
    r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[11],
    r[8], r[9], r[10], r[12], r[13], r[14], r[15], r[16], r[17],
    r[22] || ''
  ]), 2, 3);
  const startRow=5;
  sh.getRange(startRow,1,1,header.length).setValues([header]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');
  if(ppvOutputRows.length===0){sh.getRange(startRow+1,1).setValue('No PPV entries this run.');}
  else{
    sh.getRange(startRow+1,1,ppvOutputRows.length,header.length).setValues(ppvOutputRows);
    sh.getRange(startRow+1,7,ppvOutputRows.length,2).setNumberFormat('#,##0.00;[Red]-#,##0.00');
    sh.getRange(startRow+1,2,ppvOutputRows.length,1).setNumberFormat('d-m-yyyy');
    sh.getRange(startRow+1,14,ppvOutputRows.length,1).setNumberFormat('d-m-yyyy');
    // Stripe by JE block
    for(let i=0;i<ppvOutputRows.length;i+=8){sh.getRange(startRow+1+i,1,Math.min(4,ppvOutputRows.length-i),header.length).setBackground('#F5F9FC');}
    // Source column color
    const srcRange=sh.getRange(startRow+1,19,ppvOutputRows.length,1);
    const rules=sh.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Price Variance').setBackground('#FFF2CC').setFontColor('#856404').setRanges([srcRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Amt Mismatch').setBackground('#FCE5CD').setFontColor('#7a4000').setRanges([srcRange]).build());
    // Payables bold
    const acctRange=sh.getRange(startRow+1,3,ppvOutputRows.length,1);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(CFG.JE.GL_PAYABLES.num).setBold(true).setRanges([acctRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(CFG_QTY.GL_PPV_QTY.num).setBackground('#FFF2CC').setBold(true).setRanges([acctRange]).build());
    sh.setConditionalFormatRules(rules);
  }
  sh.setFrozenRows(startRow);
  [40,90,110,150,80,90,120,120,380,180,100,90,180,100,180,110,110,110,130].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  Logger.log('PPV Mismatch JEs: '+generated+' POs ('+fromQtyRecon+' price variance, '+fromAmtMismatch+' amt mismatch/qty OK)');
  return {generated,dupSkipped,fromQtyRecon,fromAmtMismatch,postedPOs,amtMatchPOs};
}


// ═══════════════════════════════════════════════════════════════
// GENERATE PPV JEs FROM QTY MISMATCH SELECTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Reads all rows in Qty Mismatch Analysis where Post as PPV? = "Yes".
 * Generates 4-leg PPV journal entries (same as PPV Mismatch JEs).
 * Marks E-Invoice rows as "Posted - With PPV".
 * Removes posted POs from GR/IR Aging and Commercial FU.
 */
function generatePPVFromQtyMismatch() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const ui  = SpreadsheetApp.getUi();

  try {
    const analysisSh = ss.getSheetByName(CFG_QTY.QTY_MISMATCH_ANALYSIS_SHEET);
    if (!analysisSh) throw new Error('Qty Mismatch Analysis tab not found. Run Full Reconciliation first.');

    const data    = analysisSh.getDataRange().getValues();
    const startRow = 4;   // header is row 4 (0-based index 3)
    if (data.length <= startRow) { ui.alert('No data in Qty Mismatch Analysis.'); return; }

    const headers = data[startRow - 1].map(h => String(h).trim());
    const cPPV    = headers.indexOf(CFG_QTY.POST_AS_PPV_COL_HEADER);
    const cPO     = headers.indexOf('PO #');
    const cSupE   = headers.indexOf('E-Invoice Supplier Name');
    const cSupM   = headers.indexOf('Mapped Supplier Name');
    const cSupCode= headers.indexOf('Supplier Code');
    const cInvNo  = headers.indexOf('Invoice #');
    const cInvDate= headers.indexOf('Invoice Date');
    const cGRAmt  = headers.indexOf('GR Amount (EGP)');
    const cInvAmt = headers.indexOf('Invoice Amount (EGP)');
    const cAmtVar = headers.indexOf('Amount Variance (EGP)');
    const cOwner  = headers.indexOf('Finance Owner');

    if (cPPV < 0 || cPO < 0) throw new Error('Post as PPV? column not found. Re-run Full Reconciliation to refresh the tab.');

    // Collect selected rows — group by PO (one JE per PO, not per store line)
    const selectedByPO = {};
    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      const ppv = String(row[cPPV] || '').trim();
      if (ppv !== CFG_QTY.POST_AS_PPV_YES) continue;
      const po = String(row[cPO] || '').trim(); if (!po) continue;
      if (!selectedByPO[po]) {
        selectedByPO[po] = {
          po,
          eInvoiceSupplierName: cSupE  >= 0 ? String(row[cSupE]  || '').trim() : '',
          mappedSupplierName:   cSupM  >= 0 ? String(row[cSupM]  || '').trim() : '',
          supplierCode:         cSupCode >= 0 ? String(row[cSupCode] || '').trim() : '',
          invNumber:            cInvNo  >= 0 ? String(row[cInvNo]  || '').trim() : '',
          invDate:              cInvDate >= 0 ? row[cInvDate] : '',
          grAmt:                cGRAmt  >= 0 ? toNumber_(row[cGRAmt])  : 0,
          invAmt:               cInvAmt >= 0 ? toNumber_(row[cInvAmt]) : 0,
          amtVar:               cAmtVar >= 0 ? toNumber_(row[cAmtVar]) : 0,
          owner:                cOwner  >= 0 ? String(row[cOwner] || '').trim() : '',
          rowIndexes: [],
        };
      }
      // Accumulate GR amounts across stores (already split by store in analysis tab)
      // But re-aggregate to PO level for JE
      selectedByPO[po].rowIndexes.push(i);
    }

    const selectedPOs = Object.values(selectedByPO);
    if (selectedPOs.length === 0) {
      ui.alert('No rows selected', 'No rows have "Yes" in the Post as PPV? column.\n\nSet Post as PPV? = Yes on the rows you want to post, then run this again.', ui.ButtonSet.OK);
      return;
    }

    const supLookup  = readSuppliersMaster_(ss);
    const postedKeys = readPostedInvoiceKeys_(ss);
    const r2 = round2_;
    const jeRows = []; let generated = 0, dupSkipped = 0;
    const postedPOs = [], postedPOSet = new Set();

    selectedPOs.forEach(r => {
      const supplierName = r.mappedSupplierName || r.eInvoiceSupplierName;
      const invoiceNo    = r.invNumber;
      const dedupKey     = supplierName.toLowerCase() + '|' + invoiceNo.toLowerCase();
      if (invoiceNo && postedKeys.has(dedupKey)) { dupSkipped++; return; }

      const sup       = lookupSupplierFuzzy_(supLookup, r.eInvoiceSupplierName) || {};
      const invDate   = coerceDate_(r.invDate) || new Date();
      const term      = sup.term || '';
      const dueDate   = computeDueDate_(invDate, term);
      const supCode   = String(sup.code  || r.supplierCode || '').trim();
      const supTaxId  = String(sup.taxid || '').trim();
      const supOwner  = String(sup.owner || r.owner || '').trim();
      const supNameMap= String(sup.name  || supplierName || '').trim();

      // Amounts — use PO-level grAmt vs invAmt
      const grSub   = r2(r.grAmt);
      const invTotal= r2(r.invAmt);
      const invVAT  = r2(invTotal - (invTotal / 1.14));
      const pvAmt   = r2(r.amtVar);   // amount variance → PPV

      const desc = buildJeDescription_(supplierName, supCode, r.po, invoiceNo, supTaxId) + ' | UOM Variance — Posted as PPV';

      const common = [CFG.JE.TYPE_CODE, invDate, '', '', '', '', '', '', supplierName, invoiceNo, r.po, desc, term, dueDate, supNameMap, supOwner, supCode, supTaxId, invTotal, '', '', ''];
      const l1 = common.slice(); l1[2] = CFG.JE.GL_GRIR.num;       l1[3] = CFG.JE.GL_GRIR.name;                              l1[6] = grSub;
      const l2 = common.slice(); l2[2] = CFG.JE.GL_VAT.num;        l2[3] = CFG.JE.GL_VAT.name;                               l2[6] = invVAT;
      const l3 = common.slice(); l3[2] = CFG_QTY.GL_PPV_QTY.num;   l3[3] = CFG_QTY.GL_PPV_QTY.name;     if (pvAmt >= 0) l3[6] = pvAmt; else l3[7] = pvAmt;
      const l4 = common.slice(); l4[2] = CFG.JE.GL_PAYABLES.num;   l4[3] = CFG.JE.GL_PAYABLES.name;                          l4[7] = -invTotal;

      jeRows.push(l1);
      if(Math.abs(invVAT)>0.01) jeRows.push(l2);
      jeRows.push(l3, l4);
      generated++;
      postedPOs.push(r.po);
      postedPOSet.add(r.po);
    });

    // Write JE tab
    writeJeTab_(ss, {
      sheetName: CFG_QTY.QTY_MISMATCH_PPV_JES_SHEET,
      title:     'Qty Mismatch PPV Journal Entries — UOM Variance Selections (for review)',
      subtitle:  'Dr GR/IR at GR amount · Dr VAT · Dr/Cr PPV (' + CFG_QTY.GL_PPV_QTY.num + ') for UOM variance · Cr Payables at invoice total.',
      legsPerJe: 4,
    }, jeRows, { generated, dupSkipped, sourceCount: selectedPOs.length, sourceLabel: 'Selected Qty Mismatch POs' });

    // Mark E-Invoices as Posted - With PPV
    const eiSheet = ss.getSheetByName(CFG.EINVOICES_SHEET);
    if (eiSheet && postedPOs.length > 0) {
      const ei = readTab_(ss, CFG.EINVOICES_SHEET);
      const eiCols = resolveCols_(ei.headers, {
        po: CFG.HEADERS.einv_po, po2: CFG.HEADERS.einv_po2,
        status: CFG.HEADERS.einv_status,
      }, CFG.EINVOICES_SHEET);
      const statusCol = ensureStatusColumn_(eiSheet);
      const lastCol   = eiSheet.getLastColumn();
      ei.rows.forEach((r, idx) => {
        const poRaw = (eiCols.po  >= 0 ? String(r[eiCols.po]  || '').trim() : '') ||
                      (eiCols.po2 >= 0 ? String(r[eiCols.po2] || '').trim() : '');
        const poCheck = validatePO_(poRaw);
        if (!poCheck.valid) return;
        if (!postedPOSet.has(poCheck.normalized)) return;
        const rIdx = ei.sheetRows[idx];
        eiSheet.getRange(rIdx, statusCol).setValue(CFG.STATUS.POSTED_PPV);
        eiSheet.getRange(rIdx, 1, 1, lastCol).setBackground(CFG.STATUS.COLOR_VARIANCE);
      });
    }

    // Remove posted POs from GR/IR Aging and Commercial FU
    removeFromGRIR_(ss, postedPOSet);
    removeFromCommercialFU_(ss, postedPOSet);

    // Clear Post as PPV? = Yes on processed rows (mark as Posted)
    selectedPOs.forEach(r => {
      r.rowIndexes.forEach(rowIdx => {
        analysisSh.getRange(rowIdx + 1, cPPV + 1).setValue('Posted');
      });
    });

    ui.alert('✅ PPV JEs Generated',
      'JEs generated: ' + generated + '\n' +
      'Skipped (already posted): ' + dupSkipped + '\n\n' +
      'Tabs updated:\n' +
      '• Qty Mismatch PPV JEs — review then copy to General Entries\n' +
      '• E-Invoices — marked "Posted - With PPV"\n' +
      '• GR/IR Aging — posted POs removed\n' +
      '• Commercial FU — posted POs removed\n' +
      '• Qty Mismatch Analysis — selection marked "Posted"',
      ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('Error', e.message + '\n\n' + e.stack, ui.ButtonSet.OK);
  }
}

/**
 * Removes rows for posted POs from GR/IR Aging tab.
 * Preserves all other rows.
 */
function removeFromGRIR_(ss, postedPOSet) {
  const sh = ss.getSheetByName(CFG_QTY.GRIR_AGING_SHEET);
  if (!sh || sh.getLastRow() <= 4) return;
  const startRow = 4;
  const data = sh.getDataRange().getValues();
  const headers = data[startRow - 1].map(v => String(v).trim());
  const cPO = headers.indexOf('PO #');
  if (cPO < 0) return;
  // Collect rows to delete (bottom up to preserve indexes)
  const toDelete = [];
  for (let i = startRow; i < data.length; i++) {
    const po = String(data[i][cPO] || '').trim();
    if (po && postedPOSet.has(po)) toDelete.push(i + 1);   // 1-based sheet row
  }
  // Delete bottom-up
  for (let i = toDelete.length - 1; i >= 0; i--) {
    sh.deleteRow(toDelete[i]);
  }
  Logger.log('GR/IR Aging: removed ' + toDelete.length + ' rows for posted POs');
}

/**
 * Removes rows for posted POs from Commercial FU tab.
 */
function removeFromCommercialFU_(ss, postedPOSet) {
  const sh = ss.getSheetByName(CFG_QTY.COMMERCIAL_FU_SHEET);
  if (!sh || sh.getLastRow() <= 4) return;
  const startRow = 4;
  const data = sh.getDataRange().getValues();
  const headers = data[startRow - 1].map(v => String(v).trim());
  const cPO = headers.indexOf('PO #');
  if (cPO < 0) return;
  const toDelete = [];
  for (let i = startRow; i < data.length; i++) {
    const po = String(data[i][cPO] || '').trim();
    if (po && postedPOSet.has(po)) toDelete.push(i + 1);
  }
  for (let i = toDelete.length - 1; i >= 0; i--) {
    sh.deleteRow(toDelete[i]);
  }
  Logger.log('Commercial FU: removed ' + toDelete.length + ' rows for posted POs');
}


function writeReturnsPostingsTab_(ss, returnsData, supLookup) {
  const today = new Date(), r2 = round2_;
  const bySupplier = {};

  (returnsData || []).forEach(r => {
    const supplier = String(r.supplier || '').trim() || 'Unknown Supplier';
    const qty = toNumber_(r.quantity || r.returned || 0);
    const baseCost = toNumber_(r.baseCost || 0);
    const vat = toNumber_(r.vatAmount || 0);
    const amount = r2((baseCost + vat) * qty);
    if (Math.abs(amount) <= 0.01) return;

    if (!bySupplier[supplier]) {
      bySupplier[supplier] = {
        supplier,
        amount: 0,
        returnPOs: [],
        stores: [],
        reasons: []
      };
    }
    bySupplier[supplier].amount += amount;
    if (r.returnPO) bySupplier[supplier].returnPOs.push(String(r.returnPO).trim());
    if (r.store) bySupplier[supplier].stores.push(String(r.store).trim());
    if (r.reasonEn || r.reasonAr) bySupplier[supplier].reasons.push(String(r.reasonEn || r.reasonAr).trim());
  });

  const jeRows = [];
  Object.keys(bySupplier).sort().forEach(supplier => {
    const g = bySupplier[supplier];
    const amount = r2(g.amount);
    if (Math.abs(amount) <= 0.01) return;

    const sup = lookupSupplierFuzzy_(supLookup, supplier) || {};
    const supCode = String(sup.code || '').trim();
    const supTaxId = String(sup.taxid || '').trim();
    const term = sup.term || '';
    const dueDate = computeDueDate_(today, term);
    const owner = String(sup.owner || '').trim();
    const supNameMap = String(sup.name || supplier || '').trim();
    const poRef = Array.from(new Set(g.returnPOs)).slice(0, 10).join(', ');
    const storeRef = Array.from(new Set(g.stores)).slice(0, 10).join(', ');
    const desc = buildJeDescription_(supplier, supCode, poRef, 'Returns', supTaxId) + ' - Supplier returns posting';

    // One entry per supplier:
    // Dr 2000000 Payables
    // Cr 1000005 Stocks Inventory
    // Value = (base_cost (EGP) + VAT) × quantity, summed by supplier.
    const common = [CFG.JE.TYPE_CODE,today,'','','','','','',supplier,'Returns',poRef,desc,term,dueDate,supNameMap,owner,supCode,supTaxId,amount,'',storeRef,''];
    const drPayables = common.slice(); drPayables[2] = CFG.JE.GL_PAYABLES.num; drPayables[3] = CFG.JE.GL_PAYABLES.name; drPayables[6] = amount;
    const crStocks   = common.slice(); crStocks[2]   = CFG_QTY.GL_STOCKS.num; crStocks[3]   = CFG_QTY.GL_STOCKS.name; crStocks[7] = -amount;
    jeRows.push(drPayables, crStocks);
  });

  writeJeTab_(ss,{sheetName:CFG_QTY.RETURNS_JES_SHEET,title:'Returns Postings — Supplier Returns Journal Entries (for review)',subtitle:'One JE per supplier. Dr Payables ('+CFG.JE.GL_PAYABLES.num+') · Cr Stocks Inventory ('+CFG_QTY.GL_STOCKS.num+'). Value = (base_cost (EGP) + VAT) × quantity.',legsPerJe:2},jeRows,{generated:jeRows.length/2,dupSkipped:0,sourceCount:returnsData.length,sourceLabel:'Return Lines'});
}


// ═══════════════════════════════════════════════════════════════
// SECTION 7 — OUTPUT TAB WRITERS
// ═══════════════════════════════════════════════════════════════


/**
 * Master Reconciliation Dashboard — final PO-level status.
 * Includes every valid PO found in either E-Invoices or GRs, once.
 * Status is calculated after amount reconciliation, qty reconciliation, PPV generation,
 * and matched JE generation have all run.
 */
function writeMasterReconciliation_(ss, amtResults, qtyResults, ctx) {
  ctx = ctx || {};
  const reconSummary = ctx.reconSummary || {};
  const je = ctx.je || { postedPOs: [] };
  const ppvMJE = ctx.ppvMJE || { postedPOs: [], amtMatchPOs: [] };
  const qtyMismatchRows = ctx.qtyMismatchRows || [];

  let sh = ss.getSheetByName(CFG.OUTPUT_SHEET);
  if (sh) sh.clear(); else sh = ss.insertSheet(CFG.OUTPUT_SHEET);

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  sh.getRange('A1').setValue('PO Reconciliation — Final Status Dashboard').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: ' + now + ' · Includes every valid PO found in either E-Invoices or GRs.').setFontStyle('italic').setFontColor('#595959');
  sh.getRange('A3').setValue('Final Status reflects amount match, qty match, PPV, qty mismatch, no-GR/no-invoice, and posting result.').setFontStyle('italic').setFontColor('#8B0000');

  const matchedPOs = new Set((je.postedPOs || []).map(String));
  const ppvPOs = new Set((ppvMJE.postedPOs || []).map(String));
  const amtMismatchQtyOkPOs = new Set((ppvMJE.amtMatchPOs || []).map(String));
  const qtyByPO = {};
  (qtyResults || []).forEach(r => {
    if (!r || !r.po) return;
    qtyByPO[String(r.po)] = r;
  });

  const qtyMismatchByPO = {};
  (qtyMismatchRows || []).forEach(r => {
    if (!r || !r.po) return;
    qtyMismatchByPO[String(r.po)] = r;
  });

  const summaryRows = [
    ['E-Invoice rows', reconSummary.eiRows || 0],
    ['Unique POs in E-Invoices', reconSummary.eiPOCount || 0],
    ['GR lines', reconSummary.cpLines || 0],
    ['Unique POs in GRs', reconSummary.cpPOCount || 0],
    ['', ''],
    ['Posted - Match', matchedPOs.size],
    ['Posted - With PPV', ppvPOs.size],
    ['Qty Mismatch / UOM Review', Object.keys(qtyMismatchByPO).length],
    ['No GR / Invoice Without GR', (amtResults || []).filter(r => r.status === 'Only in E-Invoices').length],
    ['No Invoice / Awaiting Supplier Invoice', (amtResults || []).filter(r => r.status === 'Only in Closed POs').length],
    ['Duplicate PO in E-Invoices', reconSummary.duplicateEI || 0]
  ];
  sh.getRange(5, 1, summaryRows.length, 2).setValues(summaryRows);
  sh.getRange(5, 1, summaryRows.length, 1).setFontWeight('bold');

  const startRow = 5 + summaryRows.length + 2;
  const HEADER = [
    'Final Status', 'Recommended Action', 'PO',
    'Amount Status', 'Qty Status', 'Posting Status', 'Mismatch Type',
    'Note', 'E-Inv Supplier', 'GR Supplier', '# E-Inv', '# GR Lines',
    'E-Inv Amount', 'GR Amount', 'Amount Variance', 'Amount Var %',
    'E-Inv Qty', 'GR Qty', 'Qty Variance', 'Qty Var % of GR',
    'E-Inv Invoice IDs', 'GR Invoice #', 'E-Inv Link(s)'
  ];
  sh.getRange(startRow, 1, 1, HEADER.length).setValues([HEADER]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');

  const data = (amtResults || []).map(r => {
    const po = String(r.po || '').trim();
    const q = qtyByPO[po] || {};
    const qMismatch = qtyMismatchByPO[po] || null;

    const eQty = q.totalEQty !== undefined ? toNumber_(q.totalEQty) : '';
    const gQty = q.totalGQty !== undefined ? toNumber_(q.totalGQty) : '';
    const qtyVar = (q.qtyVar !== undefined) ? toNumber_(q.qtyVar) : (eQty !== '' && gQty !== '' ? round2_(eQty - gQty) : '');
    const grQtyAbs = gQty !== '' ? Math.abs(toNumber_(gQty)) : 0;
    const qtyVarPctOfGR = grQtyAbs > 0 && qtyVar !== '' ? Math.abs(toNumber_(qtyVar)) / grQtyAbs : '';

    const invoiceAmountAbs = Math.abs(toNumber_(r.ei_total !== null && r.ei_total !== undefined ? r.ei_total : q.totalEAmt));
    const amountVarianceAbs = Math.abs(toNumber_(r.diff !== null && r.diff !== undefined ? r.diff : q.amtVar));
    const amountVariancePctOfInvoice = invoiceAmountAbs > 0 ? amountVarianceAbs / invoiceAmountAbs : 1;
    const isProbableUOMDifference = qtyVarPctOfGR !== '' && qtyVarPctOfGR > 0.10 && amountVariancePctOfInvoice <= 0.10;

    const qtyStatus = q.qtyMismatchType || q.classification || '';
    let mismatchType = '';
    let postingStatus = '';
    let finalStatus = '';
    let action = '';

    if (r.status === 'Only in E-Invoices') {
      finalStatus = 'No GR / Invoice Without GR';
      action = 'Check GR booking / receiving status before posting';
      postingStatus = 'Not Posted';
    } else if (r.status === 'Only in Closed POs') {
      finalStatus = 'No Invoice / Awaiting Supplier Invoice';
      action = 'Follow up with supplier for invoice';
      postingStatus = 'Not Posted';
    } else if (qMismatch) {
      mismatchType = isProbableUOMDifference ? 'Probable UOM Difference' : (qMismatch.qtyMismatchType || qMismatch.classification || 'Qty Mismatch');
      finalStatus = mismatchType;
      action = isProbableUOMDifference ? 'Stock/Commercial to validate UOM: case vs piece' : 'Stock controller to validate received quantity';
      postingStatus = 'Not Posted - Qty Review';
    } else if (ppvPOs.has(po)) {
      mismatchType = amtMismatchQtyOkPOs.has(po) ? 'Amount Mismatch - Qty Match' : 'Price Mismatch';
      finalStatus = 'Posted - With PPV';
      action = 'Review / upload PPV Mismatch JEs';
      postingStatus = 'Posted to PPV Mismatch JEs';
    } else if (matchedPOs.has(po)) {
      finalStatus = 'Posted - Match';
      action = 'Review / upload Matched POs JEs';
      postingStatus = 'Posted to Matched POs JEs';
    } else if (r.status === 'Matched') {
      finalStatus = 'Matched - Not Posted';
      action = 'Review duplicate-posting checks or JE generation output';
      postingStatus = 'Not Posted';
    } else if (r.status === 'Amount Mismatch') {
      finalStatus = 'Amount Mismatch - Review';
      action = 'Review invoice vs GR amount difference';
      postingStatus = 'Not Posted';
    } else {
      finalStatus = r.status || 'Review';
      action = 'Review';
      postingStatus = 'Not Posted';
    }

    return [
      finalStatus, action, po,
      r.status || '', qtyStatus, postingStatus, mismatchType,
      r.note || '', r.ei_supplier || '', r.cp_supplier || '', r.ei_count || 0, r.cp_line_count || 0,
      r.ei_total, r.cp_amount, r.diff, r.diff_pct !== null && r.diff_pct !== undefined ? r.diff_pct : '',
      eQty, gQty, qtyVar, qtyVarPctOfGR,
      r.ei_invoice_ids || '', r.cp_invno || '', r.ei_links || ''
    ];
  });

  const rank = {
    'Probable UOM Difference': 0,
    'Qty Mismatch': 1,
    'Posted - With PPV': 2,
    'Amount Mismatch - Review': 3,
    'No GR / Invoice Without GR': 4,
    'No Invoice / Awaiting Supplier Invoice': 5,
    'Matched - Not Posted': 6,
    'Posted - Match': 7
  };
  data.sort((a, b) => {
    const ra = rank[a[0]] !== undefined ? rank[a[0]] : 99;
    const rb = rank[b[0]] !== undefined ? rank[b[0]] : 99;
    if (ra !== rb) return ra - rb;
    return String(a[2]).localeCompare(String(b[2]));
  });

  if (data.length > 0) {
    sh.getRange(startRow + 1, 1, data.length, HEADER.length).setValues(data);
    sh.getRange(startRow + 1, 13, data.length, 3).setNumberFormat('#,##0.00;[Red]-#,##0.00');
    sh.getRange(startRow + 1, 16, data.length, 1).setNumberFormat('0.00%');
    sh.getRange(startRow + 1, 17, data.length, 3).setNumberFormat('#,##0.00;[Red]-#,##0.00');
    sh.getRange(startRow + 1, 20, data.length, 1).setNumberFormat('0.00%');

    const finalStatusRange = sh.getRange(startRow + 1, 1, data.length, 1);
    const rules = [];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Probable UOM').setBackground('#D9EAD3').setFontColor('#274E13').setRanges([finalStatusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Qty Mismatch').setBackground('#FCE5CD').setFontColor('#7a4000').setRanges([finalStatusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Posted - With PPV').setBackground('#FFF2CC').setFontColor('#856404').setRanges([finalStatusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Amount Mismatch').setBackground('#F4CCCC').setFontColor('#990000').setRanges([finalStatusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('No GR').setBackground('#F4CCCC').setFontColor('#990000').setRanges([finalStatusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('No Invoice').setBackground('#FFF2CC').setFontColor('#856404').setRanges([finalStatusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Posted - Match').setBackground('#D9EAD3').setFontColor('#274E13').setRanges([finalStatusRange]).build());
    sh.setConditionalFormatRules(rules);
  } else {
    sh.getRange(startRow + 1, 1).setValue('No POs found.');
  }

  sh.setFrozenRows(0);
  [180,260,95,140,140,170,170,220,180,180,70,80,120,120,120,90,100,100,110,110,220,130,280].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  ss.setActiveSheet(sh);
}

function writeOutput_(ss, results, summary) {
  let sh=ss.getSheetByName(CFG.OUTPUT_SHEET); if(sh) sh.clear(); else sh=ss.insertSheet(CFG.OUTPUT_SHEET);
  const now=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm');
  sh.getRange('A1').setValue('E-Invoices ↔ GRs Reconciliation').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: '+now).setFontStyle('italic').setFontColor('#595959');
  const summaryRows=[['E-Invoice rows',summary.eiRows],['Unique POs in E-Invoices',summary.eiPOCount],['GR lines',summary.cpLines],['Unique POs in GRs',summary.cpPOCount],['',''],['Matched (within 1%)',summary.matched],['Amount Mismatch',summary.amountMismatch],['Only in E-Invoices',summary.onlyEI],['Only in GRs (no invoice)',summary.onlyCP],['Duplicate PO in E-Invoices',summary.duplicateEI]];
  sh.getRange(4,1,summaryRows.length,2).setValues(summaryRows); sh.getRange(4,1,summaryRows.length,1).setFontWeight('bold');
  const startRow=4+summaryRows.length+2;
  const header=['Status','PO','Note','E-Inv Supplier','GR Supplier','# E-Inv','# GR Lines','E-Inv Total','GR Invoice Amount','Diff','Diff %','E-Inv Internal IDs','GR Invoice #','GR Invoiced Flag','E-Inv Link(s)'];
  sh.getRange(startRow,1,1,header.length).setValues([header]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');
  if(results.length>0){
    const data=results.map(r=>[r.status,r.po,r.note,r.ei_supplier,r.cp_supplier,r.ei_count,r.cp_line_count,r.ei_total,r.cp_amount,r.diff,r.diff_pct!==null?r.diff_pct:'',r.ei_invoice_ids,r.cp_invno,r.cp_invoiced,r.ei_links]);
    sh.getRange(startRow+1,1,data.length,header.length).setValues(data);
    sh.getRange(startRow+1,8,data.length,3).setNumberFormat('#,##0.00'); sh.getRange(startRow+1,11,data.length,1).setNumberFormat('0.00%');
    const sRange=sh.getRange(startRow+1,1,data.length,1); const rules=sh.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Amount Mismatch').setBackground('#F4CCCC').setRanges([sRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Only in E-Invoices').setBackground('#FCE5CD').setRanges([sRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Only in Closed POs').setBackground('#FFF2CC').setRanges([sRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Matched').setBackground('#D9EAD3').setRanges([sRange]).build());
    sh.setConditionalFormatRules(rules);
    const nRange=sh.getRange(startRow+1,3,data.length,1); const rules2=sh.getConditionalFormatRules();
    rules2.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Duplicate PO').setBackground('#E6B8AF').setBold(true).setRanges([nRange]).build()); sh.setConditionalFormatRules(rules2);
  } else { sh.getRange(startRow+1,1).setValue('No POs found.'); }
  sh.setFrozenRows(0);
  [110,90,220,180,180,60,70,110,120,90,80,180,120,110,260].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
}


/**
 * Qty Mismatch Analysis — detailed stock-controller review tab.
 * Shows only Qty Variance POs and allows AP/Finance to mark selected rows
 * as "Post as PPV? = Yes" for the separate PPV generation step.
 */
function writeQtyMismatchAnalysis_(ss, results, grData, storeMap, supLookup) {
  let sh = ss.getSheetByName(CFG_QTY.QTY_MISMATCH_ANALYSIS_SHEET);
  if (sh) sh.clear(); else sh = ss.insertSheet(CFG_QTY.QTY_MISMATCH_ANALYSIS_SHEET);

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  sh.getRange('A1').setValue('Qty Mismatch Analysis — Stock Controller Review').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: ' + now + ' · Qty variance only · UOM differences flagged when qty variance is >10% of GR Qty and amount variance is within 10% of invoice amount.').setFontStyle('italic').setFontColor('#595959');
  sh.getRange('A3').setValue('This tab is for investigation. It does not create JEs until you run "Generate PPV from Qty Selections".').setFontStyle('italic').setFontColor('#8B0000');

  const HEADER = [
    CFG_QTY.POST_AS_PPV_COL_HEADER,
    'PO #','Supplier Code','E-Invoice Supplier Name','Mapped Supplier Name','Finance Owner','CM Owner',
    'Store ID','Store Name','Stock Controller','Invoice #','Invoice Date','GR Date',
    'GR Qty','E-Inv Qty','Qty Variance','GR Amount (EGP)','Invoice Amount (EGP)','Amount Variance (EGP)',
    'Mismatch Type','Suggested Action','Review Notes'
  ];

  const startRow = 4;
  sh.getRange(startRow, 1, 1, HEADER.length).setValues([HEADER]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');

  const gByPO = groupByKey_((grData || []).filter(r => r.poNumber), 'poNumber');
  const tz = Session.getScriptTimeZone();
  const fmtD = d => d ? Utilities.formatDate(new Date(d), tz, 'd-M-yyyy') : '';
  const rows = [];

  (results || []).forEach(r => {
    const po = String(r.po || '').trim();
    const grLines = gByPO[po] || r.gLines || [];
    const storeGroups = {};

    if (grLines.length > 0) {
      grLines.forEach(g => {
        const storeId = String(g.storeId || '').trim() || 'NO_STORE';
        if (!storeGroups[storeId]) storeGroups[storeId] = { qty: 0, amount: 0, grDate: '', storeId };
        storeGroups[storeId].qty += toNumber_(g.qty);
        storeGroups[storeId].amount += toNumber_(g.totalCost);
        if (!storeGroups[storeId].grDate) storeGroups[storeId].grDate = g.updatedAt || r.grDate || '';
      });
    } else {
      storeGroups['NO_STORE'] = { qty: toNumber_(r.totalGQty), amount: toNumber_(r.totalGAmt), grDate: r.grDate || '', storeId: '' };
    }

    const totalGQty = Math.max(Math.abs(toNumber_(r.totalGQty)), 0.000001);
    const totalGAmt = Math.max(Math.abs(toNumber_(r.totalGAmt)), 0.000001);

    Object.keys(storeGroups).forEach(storeIdKey => {
      const sg = storeGroups[storeIdKey];
      const storeId = storeIdKey === 'NO_STORE' ? '' : storeIdKey;
      const storeInfo = (storeMap && storeId && storeMap[storeId]) ? storeMap[storeId] : {};

      const qtyShare = Math.abs(toNumber_(sg.qty)) / totalGQty;
      const amtShare = Math.abs(toNumber_(sg.amount)) / totalGAmt;
      const eQtyAlloc = round2_(toNumber_(r.totalEQty) * qtyShare);
      const eAmtAlloc = round2_(toNumber_(r.totalEAmt) * amtShare);
      const grQty = round2_(toNumber_(sg.qty));
      const grAmt = round2_(toNumber_(sg.amount));
      const qtyVar = round2_(eQtyAlloc - grQty);
      const amtVar = round2_(eAmtAlloc - grAmt);

      // Condition A — probable UOM difference:
      // Quantity variance is more than 10% of GR Qty, while value variance is small versus the invoice amount (<= 10%).
      // Example: GR is in cases and E-Invoice is in pieces, so qty looks very different while amount is nearly matched.
      const grQtyAbs = Math.abs(grQty);
      const qtyVariancePctOfGR = grQtyAbs > 0 ? Math.abs(qtyVar) / grQtyAbs : 1;
      const invoiceAmountAbs = Math.abs(eAmtAlloc);
      const amountVariancePctOfInvoice = invoiceAmountAbs > 0 ? Math.abs(amtVar) / invoiceAmountAbs : 1;
      const isProbableUOMDifference = qtyVariancePctOfGR > 0.10 && amountVariancePctOfInvoice <= 0.10;
      const mismatchType = isProbableUOMDifference
        ? 'Probable UOM Difference'
        : (r.qtyMismatchType || r.classification || 'Qty Mismatch');

      rows.push([
        '', po, r.supplierCode || '', r.eInvoiceSupplierName || r.supplierName || '', r.mappedSupplierName || '',
        r.financeOwner || '', r.cmOwner || '', storeId, storeInfo.storeName || storeId || '', storeInfo.stockController || '',
        r.invNumber || '', fmtD(r.invDate), fmtD(sg.grDate || r.grDate), grQty, eQtyAlloc, qtyVar, grAmt, eAmtAlloc, amtVar,
        mismatchType,
        mismatchType === 'Probable UOM Difference' ? 'Validate UOM between Invoice and GR' : 'Stock controller to validate received quantity / UOM / missing GR lines',
        ''
      ]);
    });
  });

  rows.sort((a, b) => String(a[5]).localeCompare(String(b[5])) || String(a[9]).localeCompare(String(b[9])) || String(a[1]).localeCompare(String(b[1])));

  if (rows.length > 0) {
    sh.getRange(startRow + 1, 1, rows.length, HEADER.length).setValues(rows);
    sh.getRange(startRow + 1, 14, rows.length, 6).setNumberFormat('#,##0.00;[Red]-#,##0.00');

    const rule = SpreadsheetApp.newDataValidation().requireValueInList(['', CFG_QTY.POST_AS_PPV_YES], true).setAllowInvalid(true).build();
    sh.getRange(startRow + 1, 1, rows.length, 1).setDataValidation(rule);

    const ppvRange = sh.getRange(startRow + 1, 1, rows.length, 1);
    const typeRange = sh.getRange(startRow + 1, 20, rows.length, 1);
    const rules = [];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(CFG_QTY.POST_AS_PPV_YES).setBackground('#FFF2CC').setFontColor('#856404').setRanges([ppvRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Probable UOM Difference').setBackground('#D9EAD3').setFontColor('#274E13').setRanges([typeRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Qty').setBackground('#FCE5CD').setFontColor('#7a4000').setRanges([typeRange]).build());
    sh.setConditionalFormatRules(rules);
  } else {
    sh.getRange(startRow + 1, 1).setValue('No quantity mismatch items found.');
  }

  sh.setFrozenRows(startRow);
  [105,90,105,210,190,130,130,90,150,150,120,95,95,90,90,100,120,130,130,170,320,220].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  Logger.log('Qty Mismatch Analysis: ' + rows.length + ' rows written');
}

/**
 * Qty Recon Tab
 * Only shows POs where:
 *   • GR Amount > 0 (goods received)
 *   • Invoice Amount > 0 (invoice exists)
 *   • They don't match (amount variance > tolerance)
 * Status clearly states "Price Mismatch" or "Qty Mismatch"
 */
function writeQtyReconResults_(ss, results) {
  let sh=ss.getSheetByName(CFG_QTY.QTY_RECON_SHEET); if(sh) sh.clear(); else sh=ss.insertSheet(CFG_QTY.QTY_RECON_SHEET);
  const now=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm');
  sh.getRange('A1').setValue('Qty Reconciliation — POs with Amount Mismatch (GR Amount ≠ Invoice Amount)').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: '+now+' · Excludes matched POs, no-GR POs, and missing invoices · Status: Price Mismatch or Qty Mismatch').setFontStyle('italic').setFontColor('#595959');

  const HEADER=['PO #','Supplier Code','E-Invoice Supplier Name','Mapped Supplier Name','Finance Owner','CM Owner','Invoice #','Invoice Date','GR Date','Phase','GR Qty','E-Inv Qty','Qty Variance','GR Amount','E-Inv Amount','Amount Variance','Mismatch Type'];
  const startRow=4; sh.getRange(startRow,1,1,HEADER.length).setValues([HEADER]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');

  if(results.length>0){
    const tz=Session.getScriptTimeZone(),fmtD=d=>d?Utilities.formatDate(new Date(d),tz,'d-M-yyyy'):'';
    const rows=results.map(r=>[
      r.po,
      r.supplierCode||'',
      r.eInvoiceSupplierName||'',
      r.mappedSupplierName||'',
      r.financeOwner||'',
      r.cmOwner||'',
      r.invNumber,fmtD(r.invDate),fmtD(r.grDate),r.phase,
      r.totalGQty,r.totalEQty,r.qtyVar,
      r.totalGAmt,r.totalEAmt,r.amtVar,
      r.qtyMismatchType||r.classification   // Clear "Price Mismatch" or "Qty Mismatch"
    ]);
    sh.getRange(startRow+1,1,rows.length,HEADER.length).setValues(rows);
    sh.getRange(startRow+1,14,rows.length,3).setNumberFormat('#,##0.00');

    // Color by mismatch type
    const typeRange=sh.getRange(startRow+1,17,rows.length,1); const rules=[];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Price Mismatch').setBackground('#FFF2CC').setFontColor('#856404').setRanges([typeRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Qty Mismatch').setBackground('#FCE5CD').setFontColor('#7a4000').setRanges([typeRange]).build());
    sh.setConditionalFormatRules(rules);
    sh.setFrozenRows(startRow);
    [90,100,200,180,130,130,120,90,90,55,70,70,85,110,110,110,130,140,150].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  } else {
    sh.getRange(startRow+1,1).setValue('No POs with amount mismatch found. All GR amounts match invoice amounts.');
  }
}

/**
 * GR/IR Aging — purely value-based, directly from cpByPO vs eiByPO
 * Three statuses:
 *   "No Invoice"   to GR Amount > 0, Invoice Amount = 0
 *   "Overbooking"  to Invoice Amount > GR Amount
 *   "Partial GR"   to GR Amount > Invoice Amount
 */
// ═══════════════════════════════════════════════════════════════
// AP PAYABLES TRACKER
// ═══════════════════════════════════════════════════════════════

/**
 * Builds the AP Payables tab replicating the exact Payables tracker layout.
 *
 * Row 1 : BS Check | ... | Total Dues | =SUM(Balance Due col)
 * Row 2 : Headers
 * Row 3+: One row per posted invoice (Payables leg — GL 2000000 only)
 *
 * Columns: Invoice Date | Invoice # | PO # | Supp Num | Type |
 *          Supplier Name | Total Amount | Due Date | Balance Due |
 *          Payment 1 | Date | Payment 2 | Date | Payment 3 | Date | Comment
 *
 * Sources:
 *   Matched POs JEs         -> Type = "Invoice"
 *   PPV Mismatch JEs    -> Type = "Invoice - PPV"
 *   Qty Mismatch PPV JEs    -> Type = "Invoice - UOM PPV"
 *
 * Preserve logic: key = Invoice# + "|" + PO#
 *   Existing keys -> keep Payment 1/2/3 + Dates + Comment, recalculate Balance Due
 *   New keys      -> appended with blank payment columns
 *   Keys in sheet but not in current JEs -> kept as-is (older/manual entries)
 */
function writeAPPayablesTab_(ss) {
  const PAYABLES_SHEET = CFG.AP_PAYABLES_SHEET;
  const HEADER = [
    'Invoice Date','Invoice #','PO #','Supp Num','Type',
    'Supplier Name','Total Amount','Due Date','Balance Due',
    'Payment Status',
    'Payment 1','Date','Payment 2','Date','Payment 3','Date','Comment'
  ];
  const H = {
    invDate:0, invNo:1, po:2, suppNum:3, type:4,
    suppName:5, totalAmt:6, dueDate:7, balDue:8,
    payStatus:9,
    pmt1:10, pmt1Date:11, pmt2:12, pmt2Date:13, pmt3:14, pmt3Date:15, comment:16,
  };

  const SOURCES = [
    { sheetName: CFG.MATCHED_JES_SHEET,              type: 'Invoice'           },
    { sheetName: CFG_QTY.PPV_MISMATCH_JES_SHEET,     type: 'Invoice - PPV'     },  // merged tab
    { sheetName: CFG_QTY.QTY_MISMATCH_PPV_JES_SHEET, type: 'Invoice - UOM PPV' },
  ];

  // JE column indexes (0-based), header on row 5 (index 4), data from index 5.
  // Current JE output layout after moving Description to Column I and removing old S:V:
  // A # | B Date | C Account Number | D Account Name | E Location | F Cost Center |
  // G Debit | H Credit | I Description | J Supplier Name | K Invoice # | L PO |
  // M Payment Terms | N Due Date | O Supplier Name (Mapping) | P Owner | Q Suppliers Code | R Tax ID
  const JE = { date:1, acctNum:2, supplierName:9, invNo:10, po:11,
               dueDate:13, suppNameMap:14, suppCode:16 };
  const GL_PAYABLES = CFG.JE.GL_PAYABLES.num;
  const tz = Session.getScriptTimeZone();

  // ── 1. Collect posted invoices from all JE tabs ──────────────────
  const incoming = {};
  SOURCES.forEach(src => {
    const sh = ss.getSheetByName(src.sheetName);
    if (!sh || sh.getLastRow() < 6) return;
    const data = sh.getDataRange().getValues();
    for (let i = 5; i < data.length; i++) {
      const row = data[i];
      if (String(row[JE.acctNum] || '').trim() !== GL_PAYABLES) continue;
      const invNo = String(row[JE.invNo] || '').trim();
      const po    = String(row[JE.po]    || '').trim();
      if (!invNo && !po) continue;
      const key = invNo + '|' + po;
      if (incoming[key]) continue;
      const suppName  = String(row[JE.suppNameMap] || row[JE.supplierName] || '').trim();
      const suppCode  = String(row[JE.suppCode]    || '').trim();
      const totalAmt  = Math.abs(toNumber_(row[7]));
      const rawDate   = row[JE.date];
      const rawDue    = row[JE.dueDate];
      const invDate   = rawDate instanceof Date ? rawDate : coerceDate_(rawDate);
      const dueDate   = rawDue  instanceof Date ? rawDue  : coerceDate_(rawDue);
      const entry     = new Array(HEADER.length).fill('');
      entry[H.invDate]  = invDate  || '';
      entry[H.invNo]    = invNo;
      entry[H.po]       = po;
      entry[H.suppNum]  = suppCode;
      entry[H.type]     = src.type;
      entry[H.suppName] = suppName;
      entry[H.totalAmt] = totalAmt;
      entry[H.dueDate]  = dueDate  || '';
      entry[H.balDue]   = totalAmt;
      incoming[key] = entry;
    }
  });

  // ── 2. Read existing sheet — preserve manual payment columns ──────
  let sh = ss.getSheetByName(PAYABLES_SHEET);
  const preserved = {};
  const existingOrder = [];

  if (sh && sh.getLastRow() >= 3) {
    const existData = sh.getDataRange().getValues();
    const hRow = existData[1] || [];
    const cInvNo    = hRow.indexOf('Invoice #');
    const cPO       = hRow.indexOf('PO #');
    const cPmt1     = hRow.indexOf('Payment 1');
    const cComment  = hRow.indexOf('Comment');
    const cBalDue   = hRow.indexOf('Balance Due');
    const cTotalAmt = hRow.indexOf('Total Amount');

    for (let i = 2; i < existData.length; i++) {
      const r = existData[i];
      if (r.every(v => v === '' || v === null || v === undefined)) continue;
      const invNo = String(r[cInvNo] || '').trim();
      const po    = String(r[cPO]    || '').trim();
      const key   = invNo + '|' + po;
      existingOrder.push(key);
      const cPayStatus = hRow.indexOf('Payment Status');
      preserved[key] = {
        payStatus:cPayStatus >= 0 ? r[cPayStatus] || '' : '',
        pmt1:    cPmt1 >= 0 ? r[cPmt1]     || '' : '',
        pmt1Date:cPmt1 >= 0 ? r[cPmt1 + 1] || '' : '',
        pmt2:    cPmt1 >= 0 ? r[cPmt1 + 2] || '' : '',
        pmt2Date:cPmt1 >= 0 ? r[cPmt1 + 3] || '' : '',
        pmt3:    cPmt1 >= 0 ? r[cPmt1 + 4] || '' : '',
        pmt3Date:cPmt1 >= 0 ? r[cPmt1 + 5] || '' : '',
        comment: cComment >= 0 ? r[cComment] || '' : '',
        balDue:  cBalDue >= 0  ? r[cBalDue]  : null,
        totalAmt:cTotalAmt >= 0? r[cTotalAmt]: null,
        fullRow: r.slice(0, HEADER.length),
      };
    }
  }

  // ── 3. Merge: existing order first, then new ──────────────────────
  const finalRows = [];
  const seen = new Set();

  existingOrder.forEach(key => {
    if (seen.has(key)) return;
    seen.add(key);
    const p = preserved[key];
    if (incoming[key]) {
      // Known invoice — update financials, keep payments
      const entry = incoming[key].slice();
      entry[H.payStatus]= p.payStatus || '';   // preserved — auto-updated below
      entry[H.pmt1]     = p.pmt1     || '';
      entry[H.pmt1Date] = p.pmt1Date || '';
      entry[H.pmt2]     = p.pmt2     || '';
      entry[H.pmt2Date] = p.pmt2Date || '';
      entry[H.pmt3]     = p.pmt3     || '';
      entry[H.pmt3Date] = p.pmt3Date || '';
      entry[H.comment]  = p.comment  || '';
      // Recalculate balance: total minus all payments
      const pmtTotal = [entry[H.pmt1], entry[H.pmt2], entry[H.pmt3]]
        .map(v => toNumber_(v)).reduce((a, b) => a + b, 0);
      entry[H.balDue] = round2_(toNumber_(entry[H.totalAmt]) - pmtTotal);
      finalRows.push(entry);
    } else {
      // In sheet but not in current JEs (older/manual) — keep entire row as-is
      const row = (p.fullRow || new Array(HEADER.length).fill(''));
      while (row.length < HEADER.length) row.push('');
      finalRows.push(row.slice(0, HEADER.length));
    }
  });

  // New entries not previously in sheet
  Object.keys(incoming).forEach(key => {
    if (seen.has(key)) return;
    seen.add(key);
    finalRows.push(incoming[key].slice());
  });

  // ── 4. Write the tab ──────────────────────────────────────────────
  if (!sh) sh = ss.insertSheet(PAYABLES_SHEET);
  else sh.clear();

  // Row 1: summary
  const totalDuesFormula = finalRows.length > 0
    ? '=SUMIF(I3:I' + (finalRows.length + 2) + ',">0")'
    : '0';
  sh.getRange(1, 1).setValue('BS Check');
  sh.getRange(1, 2).setValue(0);
  sh.getRange(1, 8).setValue('Total Dues');
  sh.getRange(1, 9).setFormula(totalDuesFormula);
  sh.getRange(1, 1, 1, HEADER.length)
    .setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');

  // Row 2: header
  sh.getRange(2, 1, 1, HEADER.length).setValues([HEADER])
    .setBackground('#274E78').setFontColor('#FFFFFF').setFontWeight('bold');

  if (finalRows.length > 0) {
    // Auto-calculate Payment Status before writing
    const today = stripTime_(new Date());
    finalRows.forEach(row => {
      const bal     = toNumber_(row[H.balDue]);
      const dueDate = row[H.dueDate] instanceof Date
        ? stripTime_(row[H.dueDate])
        : (row[H.dueDate] ? stripTime_(coerceDate_(row[H.dueDate])) : null);
      let status;
      if (bal <= 0)                            status = 'Paid';
      else if (dueDate && dueDate < today)     status = 'Overdue';
      else if (dueDate)                        status = 'Open';
      else                                     status = 'Open';
      row[H.payStatus] = status;
    });

    sh.getRange(3, 1, finalRows.length, HEADER.length).setValues(finalRows);

    // Number formats — shifted +1 for new Payment Status col
    // Date cols: A(1)=Invoice Date, H(8)=Due Date, L(12)=Pmt1 Date, N(14)=Pmt2 Date, P(16)=Pmt3 Date
    [1, 8, 12, 14, 16].forEach(col =>
      sh.getRange(3, col, finalRows.length, 1).setNumberFormat('d-m-yyyy'));
    // Amount cols: G(7)=Total, I(9)=Balance Due, K(11)=Pmt1, M(13)=Pmt2, O(15)=Pmt3
    [7, 9, 11, 13, 15].forEach(col =>
      sh.getRange(3, col, finalRows.length, 1).setNumberFormat('#,##0.00'));

    // Conditional formatting
    const rules = [];
    const payStatusRange = sh.getRange(3, H.payStatus + 1, finalRows.length, 1);
    const typeRange      = sh.getRange(3, H.type + 1,      finalRows.length, 1);
    const balRange       = sh.getRange(3, H.balDue + 1,    finalRows.length, 1);

    // Payment Status: Overdue -> red cell only
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Overdue')
      .setBackground('#F4CCCC').setFontColor('#721c24').setBold(true)
      .setRanges([payStatusRange]).build());
    // Payment Status: Paid -> green cell only
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Paid')
      .setBackground('#D9EAD3').setFontColor('#155724').setBold(true)
      .setRanges([payStatusRange]).build());
    // Payment Status: Open -> blue cell
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Open')
      .setBackground('#cce5ff').setFontColor('#004085')
      .setRanges([payStatusRange]).build());
    // Balance Due = 0 -> green
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberEqualTo(0).setBackground('#D9EAD3').setFontColor('#155724')
      .setRanges([balRange]).build());
    // Type: Invoice - PPV -> yellow
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Invoice - PPV').setBackground('#FFF2CC').setFontColor('#856404')
      .setRanges([typeRange]).build());
    // Type: Invoice - UOM PPV -> orange
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Invoice - UOM PPV').setBackground('#FCE5CD').setFontColor('#7a4000')
      .setRanges([typeRange]).build());
    sh.setConditionalFormatRules(rules);

    // Sort by Due Date ascending
    sh.getRange(3, 1, finalRows.length, HEADER.length).sort({ column: 8, ascending: true });
  } else {
    sh.getRange(3, 1).setValue('No posted invoices found. Run Full Reconciliation first.');
  }

  sh.setFrozenRows(2);
  [100,130,90,90,130,200,110,100,110,100,100,100,100,100,100,100,200]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));  // 17 cols incl Payment Status

  Logger.log('AP Payables: ' + finalRows.length + ' rows ('
    + Object.keys(incoming).length + ' from current JEs)');
}

function writeGRIRAgingNew_(ss, cpByPO, eiByPO, supLookup) {
  const sheetName=CFG_QTY.GRIR_AGING_SHEET; let sh=ss.getSheetByName(sheetName);
  const today=new Date(),tz=Session.getScriptTimeZone(),fmtD=d=>d?Utilities.formatDate(new Date(d),tz,'d-M-yyyy'):'';

  // Preserve manual Status and Note columns across runs
  const preserved={};
  if(sh&&sh.getLastRow()>4){
    const data=sh.getDataRange().getValues(),h=data[3].map(v=>String(v).trim());
    const cPO=h.indexOf('PO #'),cStatus=h.indexOf('Status'),cNote=h.indexOf('Note');
    for(let i=4;i<data.length;i++){const po=String(data[i][cPO]||'').trim();if(po)preserved[po]={status:cStatus>=0?data[i][cStatus]:'',note:cNote>=0?data[i][cNote]:''};}
  }

  if(sh) sh.clear(); else sh=ss.insertSheet(sheetName);
  const now=Utilities.formatDate(today,tz,'yyyy-MM-dd HH:mm');
  sh.getRange('A1').setValue('GR/IR Aging — Open Items by Value').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: '+now+'   ·   Value-based comparison: GR Amount vs Invoice Amount per PO   ·   Status: No Invoice | Overbooking | Partial GR').setFontStyle('italic').setFontColor('#595959');
  sh.getRange('A3').setValue('Status and Note are manually maintained and preserved across runs.').setFontStyle('italic').setFontColor('#8B0000');

  const HEADER=['PO #','Supplier Code','GR Supplier Name','Invoice #','GR Date','GR Amount (EGP)','Invoice Amount (EGP)','Open Balance (EGP)','Status','Finance Owner','CM Owner','Days Open','Aging Bucket','Proposed Action','Last Updated','Note'];
  const startRow=4; sh.getRange(startRow,1,1,HEADER.length).setValues([HEADER]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');
  const rows=[];

  // Iterate all GR POs — compare GR amount vs invoice amount
  Object.keys(cpByPO).forEach(po=>{
    const c=cpByPO[po];
    const grAmount   = round2_(toNumber_(c.amount));
    if(grAmount<=0) return;   // Skip if no GR amount

    const eiData     = eiByPO[po];
    const invAmount  = eiData ? round2_(eiData.total) : 0;
    const openBal    = round2_(grAmount - invAmount);

    // Skip if fully matched within tolerance
    if(Math.abs(openBal)<=100) return;

    // Determine status
    let grirStatus, proposedAction;
    if(invAmount<=CFG_QTY.AMOUNT_TOLERANCE){
      grirStatus     = 'No Invoice';
      proposedAction = 'Awaiting Invoice from supplier';
    } else if(invAmount>grAmount){
      grirStatus     = 'Overbooking';
      proposedAction = 'Awaiting CN from supplier';
    } else {
      grirStatus     = 'Partial GR';
      proposedAction = 'Notify Commercial to write off or expect another invoice';
    }

    const grDate    = coerceDate_(c.closing_date);
    const daysOpen  = grDate ? Math.max(0,Math.floor((today-stripTime_(grDate))/86400000)) : 0;
    const invNumber = (eiData?eiData.rows.map(r=>r.invno||r.internal_id||'').filter(Boolean).join(', '):'')||c.invno||'';
    const sup       = lookupSupplierFuzzy_(supLookup,c.supplier)||{};
    const prev      = preserved[po]||{};

    rows.push([
      po,
      String(sup.code||c.supplier_code||'').trim(),
      String(c.supplier||'').trim(),
      invNumber,
      fmtD(grDate),
      grAmount,
      invAmount,
      Math.abs(openBal),
      prev.status||grirStatus,   // Preserve manual status if set, else auto
      String(sup.owner||'').trim(),
      String(sup.cm||'').trim(),
      daysOpen,
      getQtyAgingBucket_(daysOpen),
      proposedAction,
      fmtD(today),
      prev.note||''
    ]);
  });

  // Sort: No Invoice first, then Overbooking, then Partial GR; within each by days open desc
  const statusRank={'No Invoice':0,'Overbooking':1,'Partial GR':2};
  rows.sort((a,b)=>{
    const rA=statusRank[a[8]]!==undefined?statusRank[a[8]]:3;
    const rB=statusRank[b[8]]!==undefined?statusRank[b[8]]:3;
    if(rA!==rB) return rA-rB;
    return b[11]-a[11];   // Days open descending
  });

  if(rows.length>0){
    sh.getRange(startRow+1,1,rows.length,HEADER.length).setValues(rows);
    sh.getRange(startRow+1,6,rows.length,3).setNumberFormat('#,##0.00');   // GR/Inv/Open amounts
    sh.getRange(startRow+1,12,rows.length,1).setNumberFormat('0');         // Days open

    // Status color
    const statusRange=sh.getRange(startRow+1,9,rows.length,1); const rules=[];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('No Invoice').setBackground('#F4CCCC').setFontColor('#721c24').setRanges([statusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Overbooking').setBackground('#FCE5CD').setFontColor('#7a4000').setRanges([statusRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Partial GR').setBackground('#FFF2CC').setFontColor('#856404').setRanges([statusRange]).build());

    // Aging bucket color
    const bucketRange=sh.getRange(startRow+1,13,rows.length,1);
    [{t:'0-14',bg:'#D9EAD3',fg:'#155724'},{t:'15-30',bg:'#cce5ff',fg:'#004085'},{t:'31-60',bg:'#FFF2CC',fg:'#856404'},{t:'61-90',bg:'#FCE5CD',fg:'#7a4000'},{t:'90+',bg:'#F4CCCC',fg:'#721c24'}].forEach(c=>rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains(c.t).setBackground(c.bg).setFontColor(c.fg).setRanges([bucketRange]).build()));
    sh.setConditionalFormatRules(rules);
  } else {
    sh.getRange(startRow+1,1).setValue('No open GR/IR items found.');
  }

  sh.setFrozenRows(startRow);
  [90,100,200,130,90,120,120,120,110,120,120,80,110,280,100,220].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  Logger.log('GR/IR Aging: '+rows.length+' open items');
}

/**
 * Commercial FU — sourced from GR/IR Aging open items
 * Only shows Overbooking + Partial GR (No Invoice has no commercial action)
 */
function writeCommercialFUTab_(ss, cpByPO, eiByPO, supLookup) {
  let sh=ss.getSheetByName(CFG_QTY.COMMERCIAL_FU_SHEET); if(sh) sh.clear(); else sh=ss.insertSheet(CFG_QTY.COMMERCIAL_FU_SHEET);
  const now=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm');
  sh.getRange('A1').setValue('Commercial Follow-Up — Open GR/IR Items').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: '+now+'   ·   Sorted by Finance Owner to CM Owner to Open Balance   ·   Overbooking + Partial GR only').setFontStyle('italic').setFontColor('#595959');
  sh.getRange('A3').setValue('CM Response column is for manual input — re-run reconciliation refreshes all other columns.').setFontStyle('italic').setFontColor('#8B0000');

  const HEADER=['Finance Owner','CM Owner','Supplier Code','Supplier Name','PO #','Invoice #','GR Amount (EGP)','Invoice Amount (EGP)','Open Balance (EGP)','Status','Days Open','Aging Bucket','Required Action','CM Response','Last Updated'];
  const startRow=4; sh.getRange(startRow,1,1,HEADER.length).setValues([HEADER]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');
  const today=new Date(),rows=[];

  Object.keys(cpByPO).forEach(po=>{
    const c=cpByPO[po];
    const grAmount  = round2_(toNumber_(c.amount)); if(grAmount<=0) return;
    const eiData    = eiByPO[po];
    const invAmount = eiData ? round2_(eiData.total) : 0;
    const openBal   = round2_(grAmount-invAmount);
    if(Math.abs(openBal)<=100) return;

    let grirStatus, action;
    if(invAmount<=CFG_QTY.AMOUNT_TOLERANCE){
      grirStatus='No Invoice'; action='Awaiting Invoice from supplier';
    } else if(invAmount>grAmount){
      grirStatus='Overbooking'; action='Awaiting CN from supplier';
    } else {
      grirStatus='Partial GR'; action='Notify Commercial to write off or expect another invoice';
    }

    // Commercial FU only for Overbooking + Partial GR
    if(grirStatus==='No Invoice') return;

    const grDate   = coerceDate_(c.closing_date);
    const daysOpen = grDate ? Math.max(0,Math.floor((today-stripTime_(grDate))/86400000)) : 0;
    const invNumber= (eiData?eiData.rows.map(r=>r.invno||r.internal_id||'').filter(Boolean).join(', '):'')||c.invno||'';
    const sup      = lookupSupplierFuzzy_(supLookup,c.supplier)||{};

    rows.push([
      String(sup.owner||'').trim(),
      String(sup.cm||'').trim(),
      String(sup.code||c.supplier_code||'').trim(),
      String(c.supplier||'').trim(),
      po, invNumber,
      grAmount, invAmount, Math.abs(openBal),
      grirStatus,
      daysOpen, getQtyAgingBucket_(daysOpen), action,
      '',   // CM Response — manual
      Utilities.formatDate(today,Session.getScriptTimeZone(),'d-M-yyyy')
    ]);
  });

  rows.sort((a,b)=>String(a[0]).localeCompare(String(b[0]))||String(a[1]).localeCompare(String(b[1]))||b[8]-a[8]);

  if(rows.length>0){
    sh.getRange(startRow+1,1,rows.length,HEADER.length).setValues(rows);
    sh.getRange(startRow+1,7,rows.length,3).setNumberFormat('#,##0.00');
    const bRange=sh.getRange(startRow+1,12,rows.length,1); const rules=[];
    [{t:'0-14',bg:'#D9EAD3',fg:'#155724'},{t:'15-30',bg:'#cce5ff',fg:'#004085'},{t:'31-60',bg:'#FFF2CC',fg:'#856404'},{t:'61-90',bg:'#FCE5CD',fg:'#7a4000'},{t:'90+',bg:'#F4CCCC',fg:'#721c24'}].forEach(c=>rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains(c.t).setBackground(c.bg).setFontColor(c.fg).setRanges([bRange]).build()));
    const sRange=sh.getRange(startRow+1,10,rows.length,1);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Overbooking').setBackground('#FCE5CD').setFontColor('#7a4000').setRanges([sRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Partial GR').setBackground('#FFF2CC').setFontColor('#856404').setRanges([sRange]).build());
    sh.setConditionalFormatRules(rules);
  } else {
    sh.getRange(startRow+1,1).setValue('No open commercial items found.');
  }
  sh.setFrozenRows(startRow);
  [130,130,100,200,90,130,120,120,120,110,80,110,280,160,100].forEach((w,i)=>sh.setColumnWidth(i+1,w));
}

function writeHoldForPOTab_(ss, holdRows) {
  const sheetName=CFG.HOLD_FOR_PO_SHEET; let sh=ss.getSheetByName(sheetName);
  const supLookup=readSuppliersMaster_(ss);
  const HEADER=['Supplier Name','Supplier Code','Owner','Supplier Email','Invoice #','Invoice Date','Invoice Amount','Raw PO Field','Reason','First Seen','Drafts Created','Last Draft Date','Reminder Count','Status','Resolution Note','E-Invoice Sheet Row'];
  const STATUS_OPEN='Open',STATUS_DRAFTED='Drafted',STATUS_REMINDER='Reminder Sent',STATUS_ESCALATED='Escalated',STATUS_RESOLVED='Resolved';
  const existing={};
  if(sh){
    const data=sh.getDataRange().getValues();
    if(data.length>=5){
      const hIdx=3,headers=data[hIdx].map(h=>String(h).trim());
      const cIdx=l=>headers.indexOf(l);
      const cSup=cIdx('Supplier Name'),cInv=cIdx('Invoice #'),cFirst=cIdx('First Seen'),cDrafts=cIdx('Drafts Created'),cLast=cIdx('Last Draft Date'),cCount=cIdx('Reminder Count'),cStatus=cIdx('Status'),cRes=cIdx('Resolution Note');
      for(let i=hIdx+1;i<data.length;i++){const sup=String(data[i][cSup]||'').trim(),inv=String(data[i][cInv]||'').trim();if(!sup&&!inv)continue;const key=sup.toLowerCase()+'|'+inv.toLowerCase();const fullRow=HEADER.map((_,c)=>data[i][c]!==undefined?data[i][c]:'');existing[key]={firstSeen:data[i][cFirst]||'',drafts:data[i][cDrafts]||'',lastDraft:data[i][cLast]||'',reminderCt:data[i][cCount]||0,status:data[i][cStatus]||STATUS_OPEN,resolution:data[i][cRes]||'',fullRow};}
    }
  }
  const today=stripTime_(new Date()),incomingKeys=new Set(),out=[];let newCount=0,resolvedCount=0;
  holdRows.forEach(h=>{
    const rawSup=h.supplier||'',inv=h.invno||'';
    const sup2=lookupSupplierFuzzy_(supLookup,rawSup)||{};
    const matched=!!sup2.name;
    const sup=matched?(sup2.checkName||sup2.name):rawSup;
    const rawCode=String(sup2.code||'').trim(), rawOwner=String(sup2.owner||'').trim(), rawEmail=String(sup2.email||'').trim();
    const needsMapping = !matched || (!rawCode && !rawOwner && !rawEmail);
    const code=needsMapping ? 'Add in Mapping Sheet' : rawCode;
    const owner=needsMapping ? 'Add in Mapping Sheet' : rawOwner;
    const email=needsMapping ? '' : rawEmail;
    const key=sup.toLowerCase()+'|'+inv.toLowerCase(); incomingKeys.add(key);
    const reasonText=({blank:'Blank PO',invalid_format:'Invalid format',below_threshold:'Below 60000 serial'})[h.reason]||h.reason||'';
    const prev=existing[key];
    const firstSeen=prev&&prev.firstSeen?prev.firstSeen:today,drafts=prev&&prev.drafts?prev.drafts:'',lastDraft=prev&&prev.lastDraft?prev.lastDraft:'',remCt=prev&&prev.reminderCt?prev.reminderCt:0,status=prev&&prev.status?prev.status:STATUS_OPEN,resolution=prev&&prev.resolution?prev.resolution:'';
    out.push([sup,code,owner,email,inv,h.date||'',toNumber_(h.total),h.rawPO||'',reasonText,firstSeen,drafts,lastDraft,remCt,status,resolution,h.sheetRow||'']);
    if(!prev) newCount++;
  });
  const cStatusIdx=HEADER.indexOf('Status');
  Object.keys(existing).forEach(key=>{
    if(incomingKeys.has(key)) return;
    const prev=existing[key];const row=(prev.fullRow||[]).slice();while(row.length<HEADER.length)row.push('');
    const supName=String(row[0]||'').trim();
    if(supName){const supLk=lookupSupplierFuzzy_(supLookup,supName)||{};if(supLk.name){row[0]=supLk.checkName||supLk.name;if(supLk.code&&!row[1])row[1]=supLk.code;row[2]=supLk.owner||'';if(supLk.email&&!row[3])row[3]=supLk.email;}else{row[2]='';}}
    if(prev.status!==STATUS_RESOLVED){row[cStatusIdx]=STATUS_RESOLVED;resolvedCount++;}
    out.push(row);
  });
  if(sh) sh.clear(); else sh=ss.insertSheet(sheetName);
  const now=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm');
  sh.getRange('A1').setValue('Hold for PO — invoices with missing or invalid PO reference').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: '+now+'   |   Open: '+(out.length-resolvedCount)+'   |   New: '+newCount+'   |   Auto-resolved: '+resolvedCount).setFontStyle('italic').setFontColor('#595959');
  sh.getRange('A3').setValue('Use 🐇 Rabbit AP Controls to Generate Drafts to create supplier email drafts.').setFontStyle('italic').setFontColor('#8B0000');
  const startRow=4;
  sh.getRange(startRow,1,1,HEADER.length).setValues([HEADER]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');
  if(out.length>0){
    sh.getRange(startRow+1,1,out.length,HEADER.length).setValues(out);
    sh.getRange(startRow+1,6,out.length,1).setNumberFormat('d-m-yyyy');sh.getRange(startRow+1,7,out.length,1).setNumberFormat('#,##0.00');sh.getRange(startRow+1,10,out.length,1).setNumberFormat('d-m-yyyy');sh.getRange(startRow+1,12,out.length,1).setNumberFormat('d-m-yyyy');sh.getRange(startRow+1,13,out.length,1).setNumberFormat('0');
    const sRange=sh.getRange(startRow+1,14,out.length,1);const rules=sh.getConditionalFormatRules();
    [{v:STATUS_OPEN,bg:'#F4CCCC'},{v:STATUS_DRAFTED,bg:'#FCE5CD'},{v:STATUS_REMINDER,bg:'#FFF2CC'},{v:STATUS_ESCALATED,bg:'#EAD1DC'},{v:STATUS_RESOLVED,bg:'#D9EAD3'}].forEach(c=>rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(c.v).setBackground(c.bg).setRanges([sRange]).build()));
    const missingMapRange = sh.getRange(startRow+1,2,out.length,2); // Supplier Code + Owner
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('Add in Mapping Sheet').setBackground('#F4CCCC').setFontColor('#990000').setBold(true).setRanges([missingMapRange]).build());
    sh.setConditionalFormatRules(rules);
  } else { sh.getRange(startRow+1,1).setValue('No invoices on hold for PO.'); }
  sh.setFrozenRows(startRow);[180,100,130,200,140,100,110,130,130,100,100,110,80,110,220,110].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  return {totalRows:out.length,newCount,resolvedCount};
}


// ═══════════════════════════════════════════════════════════════
// SECTION 8 — JE TAB WRITER
// ═══════════════════════════════════════════════════════════════

function readGLNameMap_(ss) {
  // Reads GL names from the "Mapping" tab using GL/Account Number + GL/Account Name columns.
  // If the mapping columns are not found, the script keeps the GL names already generated.
  const map = {};
  const sh = ss.getSheetByName('Mapping');
  if (!sh) return map;
  const data = sh.getDataRange().getValues();
  if (!data || !data.length) return map;

  const norm = v => String(v || '').trim().toLowerCase().replace(/[#\.]/g, '').replace(/[\s_\-\/]+/g, ' ');
  const numHeaders = ['gl number','gl no','gl code','account number','account no','account code','number'];
  const nameHeaders = ['gl name','account name','account title','name'];

  let hIdx = -1, cNum = -1, cName = -1;
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const headers = data[r].map(norm);
    cNum = headers.findIndex(h => numHeaders.indexOf(h) >= 0 || h.indexOf('gl number') >= 0 || h.indexOf('account number') >= 0);
    cName = headers.findIndex(h => nameHeaders.indexOf(h) >= 0 || h.indexOf('gl name') >= 0 || h.indexOf('account name') >= 0);
    if (cNum >= 0 && cName >= 0) { hIdx = r; break; }
  }
  if (hIdx < 0) return map;

  for (let r = hIdx + 1; r < data.length; r++) {
    const num = String(data[r][cNum] || '').trim().replace(/\.0$/, '');
    const name = String(data[r][cName] || '').trim();
    if (num && name) map[num] = name;
  }
  return map;
}

function applyGLNamesFromMapping_(ss, outputRows, accountColIdx, accountNameColIdx) {
  const glMap = readGLNameMap_(ss);
  if (!glMap || Object.keys(glMap).length === 0) return outputRows || [];
  return (outputRows || []).map(row => {
    const r = row.slice();
    const glNum = String(r[accountColIdx] || '').trim().replace(/\.0$/, '');
    if (glNum && glMap[glNum]) r[accountNameColIdx] = glMap[glNum];
    return r;
  });
}

function moveDescriptionToColumnI_(rows) {
  // Standard JE row layout before output:
  // A:H = JE fields, I = Supplier Name, J = Invoice #, K = PO, L = Description.
  // Output requirement: Description must be Column I.
  // Old Columns S:V are removed from JE outputs: Supplier Invoice Amount, Invoiced?, Store Id, Posting Date.
  return (rows || []).map(r => [
    r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[11],
    r[8], r[9], r[10], r[12], r[13], r[14], r[15], r[16], r[17]
  ]);
}

function writeJeTab_(ss, opts, rows, stats) {
  let sh=ss.getSheetByName(opts.sheetName); if(sh) sh.clear(); else sh=ss.insertSheet(opts.sheetName);
  const now=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm');
  sh.getRange('A1').setValue(opts.title).setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('Generated: '+now+'   |   JEs: '+stats.generated+'   |   Skipped (already in General Entries): '+stats.dupSkipped+'   |   '+(stats.sourceLabel||'Source')+': '+stats.sourceCount).setFontStyle('italic').setFontColor('#595959');
  sh.getRange('A3').setValue(opts.subtitle).setFontStyle('italic').setFontColor('#8B0000');
  const header=['#','Date','Account Number','Account Name','Location','Cost Center','Debit','Credit','Description','Supplier Name','Invoice #','PO','Payment Terms','Due Date','Supplier Name (Mapping)','Owner','Suppliers Code','Tax ID'];
  const outputRows = applyGLNamesFromMapping_(ss, moveDescriptionToColumnI_(rows), 2, 3);
  const startRow=5; sh.getRange(startRow,1,1,header.length).setValues([header]).setBackground('#1F4E78').setFontColor('#FFFFFF').setFontWeight('bold');
  if(outputRows.length===0){sh.getRange(startRow+1,1).setValue(stats.sourceCount===0?'No '+String(stats.sourceLabel||'').toLowerCase()+' in this run.':'All already have JEs in General Entries (0 new).');}
  else{
    sh.getRange(startRow+1,1,outputRows.length,header.length).setValues(outputRows);
    sh.getRange(startRow+1,7,outputRows.length,2).setNumberFormat('#,##0.00;[Red]-#,##0.00');
    sh.getRange(startRow+1,2,outputRows.length,1).setNumberFormat('d-m-yyyy');
    sh.getRange(startRow+1,14,outputRows.length,1).setNumberFormat('d-m-yyyy');
    const legs=Math.max(1,opts.legsPerJe||3),sw=legs*2;
    for(let i=0;i<outputRows.length;i+=sw){sh.getRange(startRow+1+i,1,Math.min(legs,outputRows.length-i),header.length).setBackground('#F5F9FC');}
    const rules=sh.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(CFG.JE.GL_PAYABLES.num).setBold(true).setRanges([sh.getRange(startRow+1,3,outputRows.length,1)]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(CFG_QTY.GL_PPV_QTY.num).setBackground('#FFF2CC').setBold(true).setRanges([sh.getRange(startRow+1,3,outputRows.length,2)]).build());
    sh.setConditionalFormatRules(rules);
  }
  sh.setFrozenRows(startRow);[40,90,110,150,80,90,120,120,380,180,100,90,180,100,180,110,110,110].forEach((w,i)=>sh.setColumnWidth(i+1,w));
}

function buildJeDescription_(supplier,code,po,invoiceNo,taxCard){const parts=[];if(supplier)parts.push(String(supplier).trim());if(code)parts.push('Code# '+String(code).trim());if(po)parts.push('PO# '+String(po).trim());if(invoiceNo)parts.push('Inv# '+String(invoiceNo).trim());if(taxCard)parts.push('Tax Card# '+String(taxCard).trim());return parts.join(' - ');}


// ═══════════════════════════════════════════════════════════════
// SECTION 9 — E-INVOICES STATUS WRITEBACK
// ═══════════════════════════════════════════════════════════════

function findHeaderRow_(sh){const lastCol=Math.max(1,sh.getLastColumn()),scanRows=Math.min(5,Math.max(1,sh.getLastRow())),data=sh.getRange(1,1,scanRows,lastCol).getValues();for(let i=0;i<data.length;i++){if(data[i].filter(v=>v!==''&&v!==null).length>=3)return i+1;}return 1;}
function findStatusCol_(sh){const headerRow=findHeaderRow_(sh),lastCol=Math.max(1,sh.getLastColumn()),headers=sh.getRange(headerRow,1,1,lastCol).getValues()[0],candidates=CFG.HEADERS.einv_status;for(let i=0;i<headers.length;i++){if(candidates.indexOf(String(headers[i]||'').trim().toLowerCase())>=0)return i+1;}return -1;}
function ensureStatusColumn_(sh){let col=findStatusCol_(sh);if(col>0)return col;const headerRow=findHeaderRow_(sh);col=sh.getLastColumn()+1;sh.getRange(headerRow,col).setValue(CFG.STATUS.COL_HEADER).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');sh.setColumnWidth(col,170);return col;}
function markEInvoicesStatus_(sh,eiByPO,postedPOs,statusText,bgColor){if(!postedPOs||postedPOs.length===0)return 0;const statusCol=ensureStatusColumn_(sh),lastCol=sh.getLastColumn();let touched=0;postedPOs.forEach(po=>{const e=eiByPO[po];if(!e||!e.rows)return;e.rows.forEach(row=>{const rIdx=row.sheetRow;if(!rIdx)return;sh.getRange(rIdx,statusCol).setValue(statusText);sh.getRange(rIdx,1,1,lastCol).setBackground(bgColor);touched++;});});return touched;}
function markEInvoicesStatusNew_(sh, eiByPO, postedPOs, statusText, bgColor) {
  // Batched version — reads all status values once before loop
  if(!postedPOs||postedPOs.length===0) return 0;
  const statusCol=ensureStatusColumn_(sh), lastCol=sh.getLastColumn();
  const lastRow=sh.getLastRow(); if(lastRow<2) return 0;
  const allStatuses=sh.getRange(1,statusCol,lastRow,1).getValues();
  let touched=0;
  postedPOs.forEach(po=>{
    const e=eiByPO[po]; if(!e||!e.rows) return;
    e.rows.forEach(row=>{
      const rIdx=row.sheetRow; if(!rIdx||rIdx>lastRow) return;
      allStatuses[rIdx-1][0]=statusText;
      sh.getRange(rIdx,statusCol).setValue(statusText);
      sh.getRange(rIdx,1,1,lastCol).setBackground(bgColor);
      touched++;
    });
  });
  return touched;
}
function markEInvoicesRowsByKey_(sh,ei,taggedRows,statusText,bgColor){
  if(!taggedRows||taggedRows.length===0)return 0;
  const statusCol=ensureStatusColumn_(sh),lastCol=sh.getLastColumn();
  let touched=0;
  taggedRows.forEach(row=>{
    const rIdx=row.sheetRow;if(!rIdx)return;
    sh.getRange(rIdx,statusCol).setValue(statusText);
    sh.getRange(rIdx,1,1,lastCol).setBackground(bgColor);
    touched++;
  });
  return touched;
}

function markEInvoicesQtyMismatch_(sh, eiByPO, qtyMismatchRows, statusText, bgColor) {
  // Marks E-Invoice rows related to Qty Mismatch POs.
  // Uses the original E-Invoice sheet row numbers from eiByPO; if unavailable,
  // falls back to rowNum values carried inside the qty mismatch E-Invoice lines.
  if (!qtyMismatchRows || qtyMismatchRows.length === 0) return 0;

  const statusCol = ensureStatusColumn_(sh);
  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  const rowsToMark = new Set();

  qtyMismatchRows.forEach(item => {
    const po = String(item.po || '').trim();

    if (po && eiByPO && eiByPO[po] && eiByPO[po].rows) {
      eiByPO[po].rows.forEach(r => {
        if (r && r.sheetRow) rowsToMark.add(Number(r.sheetRow));
      });
    }

    (item.eLines || []).forEach(line => {
      if (line && line.rowNum) rowsToMark.add(Number(line.rowNum));
    });
  });

  let touched = 0;
  rowsToMark.forEach(rowNum => {
    if (!rowNum || rowNum < 1 || rowNum > lastRow) return;
    sh.getRange(rowNum, statusCol).setValue(statusText);
    sh.getRange(rowNum, 1, 1, lastCol).setBackground(bgColor);
    touched++;
  });

  return touched;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 10 — SUPPLIER MASTER & LOOKUP
// ═══════════════════════════════════════════════════════════════

function readPostedInvoiceKeys_(ss){const set=new Set();const sh=ss.getSheetByName(CFG.GENERAL_ENTRIES_SHEET);if(!sh)return set;const data=sh.getDataRange().getValues();if(!data.length)return set;let hIdx=-1;for(let i=0;i<Math.min(10,data.length);i++){const row=data[i].map(v=>String(v).trim().toLowerCase());if(row.indexOf('supplier name')>=0&&row.some(c=>c.indexOf('invoice')>=0)){hIdx=i;break;}}if(hIdx<0)return set;const cols=resolveCols_(data[hIdx],{supplier:CFG.HEADERS.ge_supplier,invno:CFG.HEADERS.ge_invno},CFG.GENERAL_ENTRIES_SHEET);if(cols.supplier<0||cols.invno<0)return set;for(let i=hIdx+1;i<data.length;i++){const sup=String(data[i][cols.supplier]||'').trim().toLowerCase(),inv=String(data[i][cols.invno]||'').trim().toLowerCase();if(sup&&inv)set.add(sup+'|'+inv);}return set;}

function readSuppliersMaster_(ss){
  const map={};let sh=null;for(const name of CFG.SUPPLIERS_SHEET_CANDIDATES){sh=ss.getSheetByName(name);if(sh)break;}if(!sh)return map;
  const data=sh.getDataRange().getValues();if(!data.length)return map;
  let hIdx=-1;const snT=['supplier_name','supplier name','suppliers name','supplier'],scT=['supplier code','suppliers code','code','supplier_code'];
  for(let i=0;i<Math.min(10,data.length);i++){const row=data[i].map(v=>String(v).trim().toLowerCase());if(row.some(c=>snT.indexOf(c)>=0)&&row.some(c=>scT.indexOf(c)>=0)){hIdx=i;break;}}
  if(hIdx<0)return map;
  const headers=data[hIdx];
  const cols=resolveCols_(headers,{name:CFG.HEADERS.sup_name,code:CFG.HEADERS.sup_code,taxid:CFG.HEADERS.sup_taxid,term:CFG.HEADERS.sup_term,email:CFG.HEADERS.sup_email,owner:CFG.HEADERS.sup_owner,check_name:CFG.HEADERS.sup_check_name,cm:CFG.HEADERS.sup_cm},sh.getName());
  if(cols.name<0)return map;
  const ownerIdx=cols.owner>=0?cols.owner:letterToColIndex_(CFG.MAPPING_OWNER_COL_LETTER)-1;
  const emailIdx=cols.email>=0?cols.email:letterToColIndex_(CFG.MAPPING_EMAIL_COL_LETTER)-1;
  const cmIdx=cols.cm>=0?cols.cm:letterToColIndex_(CFG.MAPPING_CM_COL_LETTER)-1;
  const scIdx=letterToColIndex_(CFG.MAPPING_STOCK_CONTROLLER_COL)-1;
  const byCode={},entries=[];
  for(let i=hIdx+1;i<data.length;i++){
    const nm=String(data[i][cols.name]||'').trim();if(!nm)continue;
    const checkName=cols.check_name>=0?String(data[i][cols.check_name]||'').trim():'';
    const entry={name:nm,checkName:checkName||nm,code:cols.code>=0?String(data[i][cols.code]||'').trim():'',taxid:cols.taxid>=0?String(data[i][cols.taxid]||'').trim():'',term:cols.term>=0?String(data[i][cols.term]||'').trim():'',email:(emailIdx>=0&&emailIdx<data[i].length)?String(data[i][emailIdx]||'').trim():'',owner:(ownerIdx>=0&&ownerIdx<data[i].length)?String(data[i][ownerIdx]||'').trim():'',cm:(cmIdx>=0&&cmIdx<data[i].length)?String(data[i][cmIdx]||'').trim():'',stockController:(scIdx>=0&&scIdx<data[i].length)?String(data[i][scIdx]||'').trim():''};
    map[nm.toLowerCase()]=entry;
    const nk=normalizeSupplierName_(nm);if(nk&&!map[nk])map[nk]=entry;
    if(checkName){map[checkName.toLowerCase()]=entry;const ck=normalizeSupplierName_(checkName);if(ck&&!map[ck])map[ck]=entry;}
    if(entry.code)byCode[String(entry.code).toLowerCase().replace(/\.0$/,'')]=entry;
    entries.push(entry);
  }
  Object.defineProperty(map,'__byCode',{value:byCode,enumerable:false});
  Object.defineProperty(map,'__entries',{value:entries,enumerable:false});
  return map;
}

function lookupSupplier_(map,name){if(!name)return{};const exact=map[String(name).toLowerCase().trim()];if(exact)return exact;const fuzzy=map[normalizeSupplierName_(name)];return fuzzy||{};}
const _supplierFuzzyCache_ = {};
function lookupSupplierFuzzy_(map,name,threshold){
  const t=typeof threshold==='number'?threshold:CFG.SUPPLIER_FUZZY_THRESHOLD;
  if(!name)return{};
  const cacheKey=String(t)+'|'+String(name);
  if(_supplierFuzzyCache_[cacheKey]!==undefined) return _supplierFuzzyCache_[cacheKey];
  const direct=lookupSupplier_(map,name);if(direct&&direct.name){_supplierFuzzyCache_[cacheKey]=direct;return direct;}
  const target=normalizeSupplierName_(name);if(!target){_supplierFuzzyCache_[cacheKey]={};return{};}
  const entries=map.__entries||[];let best=null,bestScore=0;
  for(let i=0;i<entries.length;i++){
    const e=entries[i],candidates=[normalizeSupplierName_(e.checkName||''),normalizeSupplierName_(e.name||'')];
    for(let j=0;j<candidates.length;j++){const cand=candidates[j];if(!cand)continue;const score=stringSimilarity_(target,cand);if(score>bestScore){bestScore=score;best=e;if(bestScore===1){_supplierFuzzyCache_[cacheKey]=best;return best;}}}
  }
  const result=bestScore>=t?best:{};
  _supplierFuzzyCache_[cacheKey]=result;
  return result;
}
function normalizeSupplierName_(s){if(!s)return'';return String(s).replace(/\u00A0/g,' ').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[^a-z0-9\u0600-\u06FF\s]+/g,' ').replace(/\b(company|co|ltd|llc|s\.a\.e|sae|pl|for|the)\b/g,' ').replace(/\b(شركه|شركة|مؤسسة|للتجارة|للتوزيع|للاستيراد|والتوزيع|والتجاره)\b/g,' ').replace(/\s+/g,' ').trim();}
function stringSimilarity_(a,b){if(!a||!b)return 0;if(a===b)return 1;const ac=a.replace(/\s+/g,''),bc=b.replace(/\s+/g,'');if(ac.length>=4&&bc.length>=4){if(bc.indexOf(ac)>=0)return Math.max(0.95,ac.length/bc.length);if(ac.indexOf(bc)>=0)return Math.max(0.95,bc.length/ac.length);}const maxLen=Math.max(a.length,b.length);if(Math.abs(a.length-b.length)/maxLen>0.5)return 0;const sC=ac.length&&bc.length?1-levenshtein_(ac,bc)/Math.max(ac.length,bc.length):0;const sP=1-levenshtein_(a,b)/maxLen;return Math.max(sC,sP);}
function levenshtein_(a,b){if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;if(a.length>b.length){const t=a;a=b;b=t;}const n=a.length,m=b.length,row=new Array(n+1);for(let i=0;i<=n;i++)row[i]=i;for(let j=1;j<=m;j++){let pd=row[0];row[0]=j;const bj=b.charCodeAt(j-1);for(let i=1;i<=n;i++){const tmp=row[i],cost=a.charCodeAt(i-1)===bj?0:1,del=row[i]+1,ins=row[i-1]+1,sub=pd+cost;row[i]=del<ins?(del<sub?del:sub):(ins<sub?ins:sub);pd=tmp;}}return row[n];}


// ═══════════════════════════════════════════════════════════════
// SECTION 11 — SUPPLIER EMAIL DRAFTS
// ═══════════════════════════════════════════════════════════════

function generateSupplierDrafts_(ownerFilter) {
  const ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(CFG.HOLD_FOR_PO_SHEET);
  if(!sh){SpreadsheetApp.getUi().alert('No "Hold for PO" tab yet — run the reconciliation first.');return;}
  const data=sh.getDataRange().getValues();if(data.length<5){SpreadsheetApp.getUi().alert('No invoices on hold for PO.');return;}
  const supLookup=readSuppliersMaster_(ss);
  const hIdx=3,headers=data[hIdx].map(h=>String(h).trim());
  const col=l=>headers.indexOf(l);
  const cSup=col('Supplier Name'),cOwner=col('Owner'),cEmail=col('Supplier Email'),cInv=col('Invoice #'),cDate=col('Invoice Date'),cAmt=col('Invoice Amount'),cFirst=col('First Seen'),cDrafts=col('Drafts Created'),cLast=col('Last Draft Date'),cCount=col('Reminder Count'),cStatus=col('Status');
  if([cSup,cOwner,cEmail,cInv,cFirst,cDrafts,cLast,cCount,cStatus].some(c=>c<0)){SpreadsheetApp.getUi().alert('Hold for PO tab missing required columns. Re-run reconciliation.');return;}
  const today=stripTime_(new Date()),todayMs=today.getTime(),ms=86400000;
  let totalRows=0,skippedNoEmail=0,skippedResolved=0,skippedTooSoon=0,skippedOtherOwner=0,skippedNoSupplier=0,skippedAllInternal=0;
  const exNoEmail=[],exAllInternal=[],ownerLc=ownerFilter?String(ownerFilter).toLowerCase():'',groups={};
  for(let i=hIdx+1;i<data.length;i++){
    totalRows++;const r=data[i],status=String(r[cStatus]||'').trim();
    if(status==='Resolved'||status==='Escalated'){if(status==='Resolved')skippedResolved++;continue;}
    const rowOwner=String(r[cOwner]||'').trim();
    if(ownerLc&&rowOwner.toLowerCase().indexOf(ownerLc)<0){skippedOtherOwner++;continue;}
    const supplierRaw=String(r[cSup]||'').trim(),inv=String(r[cInv]||'').trim();
    if(!supplierRaw){skippedNoSupplier++;continue;}if(!inv)continue;
    const sup2=lookupSupplierFuzzy_(supLookup,supplierRaw)||{};
    const sup=(sup2.checkName||sup2.name)||supplierRaw;
    let email=String(r[cEmail]||'').trim();if(!email&&sup2.email)email=String(sup2.email).trim();
    if(!email){skippedNoEmail++;if(exNoEmail.length<3)exNoEmail.push(sup);continue;}
    const routed=parseSupplierEmails_(email);
    if(routed.to.length===0){skippedAllInternal++;if(exAllInternal.length<3)exAllInternal.push(sup);continue;}
    const firstSeen=coerceDate_(r[cFirst])||today,reminderCt=parseInt(r[cCount]||0,10)||0;
    const ageDays=Math.floor((todayMs-stripTime_(firstSeen).getTime())/ms);
    let kind='',isFinal=false;
    if(reminderCt===0)kind='initial';
    else if(reminderCt===1&&ageDays>=CFG.EMAIL.REMINDER_DAYS[0])kind='reminder';
    else if(reminderCt===2&&ageDays>=CFG.EMAIL.REMINDER_DAYS[1])kind='reminder';
    else if(reminderCt===3&&ageDays>=CFG.EMAIL.REMINDER_DAYS[2]){kind='reminder';isFinal=true;}
    else{skippedTooSoon++;continue;}
    const supKey=sup.toLowerCase();
    if(!groups[supKey]){const ccSet=new Set(),ccList=[];[...CFG.EMAIL.CC,...routed.cc].forEach(addr=>{const k=String(addr||'').toLowerCase().trim();if(!k||ccSet.has(k))return;ccSet.add(k);ccList.push(addr);});groups[supKey]={supplier:sup,owner:rowOwner||sup2.owner||'',toList:routed.to.slice(),ccList,items:[]};}
    else{const seenTo=new Set(groups[supKey].toList.map(a=>a.toLowerCase()));routed.to.forEach(a=>{const k=a.toLowerCase();if(!seenTo.has(k)){groups[supKey].toList.push(a);seenTo.add(k);}});const seenCc=new Set(groups[supKey].ccList.map(a=>a.toLowerCase()));routed.cc.forEach(a=>{const k=a.toLowerCase();if(!seenCc.has(k)){groups[supKey].ccList.push(a);seenCc.add(k);}});}
    groups[supKey].items.push({rowIdx:i,invoice:inv,invDate:coerceDate_(r[cDate]),amount:toNumber_(r[cAmt]),firstSeen,ageDays,reminderCt,reminderNumber:reminderCt,kind,isFinal});
  }
  let initialEmails=0,reminderEmails=0,escalationEmails=0,totalRowsCovered=0;const updates=[];
  Object.keys(groups).forEach(supKey=>{
    const grp=groups[supKey];if(grp.items.length===0)return;
    const anyFinal=grp.items.some(it=>it.isFinal),allInitial=grp.items.every(it=>it.kind==='initial'),maxReminder=grp.items.reduce((m,it)=>Math.max(m,it.reminderNumber),0);
    let emailKind,isFinal,reminderN;
    if(anyFinal){emailKind='reminder';isFinal=true;reminderN=3;}else if(allInitial){emailKind='initial';isFinal=false;reminderN=0;}else{emailKind='reminder';isFinal=false;reminderN=maxReminder;}
    const count=grp.items.length,subjectTail=grp.supplier+' - أرقام أوامر شراء مطلوبة لـ '+count+' فاتورة';
    let subject;if(emailKind==='initial')subject=subjectTail;else if(isFinal)subject='إشعار نهائي — '+subjectTail;else subject='تذكير رقم '+reminderN+' — '+subjectTail;
    const bodies=buildSupplierBatchEmailBodies_({supplier:grp.supplier,kind:emailKind,isFinal,reminder:reminderN,items:grp.items});
    GmailApp.createDraft(grp.toList.join(','),subject,bodies.plain,{cc:grp.ccList.join(','),name:CFG.EMAIL.SIGNATURE,htmlBody:bodies.html});
    if(emailKind==='initial')initialEmails++;else if(isFinal)escalationEmails++;else reminderEmails++;
    totalRowsCovered+=grp.items.length;
    grp.items.forEach(it=>{const newCount=it.reminderCt+1,newStatus=it.isFinal?'Escalated':(it.kind==='initial'?'Drafted':'Reminder Sent');const draftedTag=Utilities.formatDate(today,Session.getScriptTimeZone(),'yyyy-MM-dd')+(it.kind==='initial'?' [initial · batched]':' [reminder #'+it.reminderNumber+(it.isFinal?' final':'')+' · batched]');const draftsAccum=String(data[it.rowIdx][cDrafts]||'').trim();const newDraftsAccum=draftsAccum?draftsAccum+'\n'+draftedTag:draftedTag;updates.push({row:it.rowIdx+1,drafts:newDraftsAccum,last:today,count:newCount,status:newStatus});});
  });
  if(updates.length>0){
    const lastRowD=sh.getLastRow();
    const allDataD=sh.getRange(1,1,lastRowD,headers.length).getValues();
    updates.forEach(u=>{
      const ri=u.row-1;
      if(ri<0||ri>=allDataD.length) return;
      allDataD[ri][cDrafts]=u.drafts;
      allDataD[ri][cLast]=u.last;
      allDataD[ri][cCount]=u.count;
      allDataD[ri][cStatus]=u.status;
    });
    sh.getRange(1,1,lastRowD,headers.length).setValues(allDataD);
  }
  const totalEmails=initialEmails+reminderEmails+escalationEmails,fmtS=arr=>arr.length?'  e.g. '+arr.join(', ')+'\n':'';
  SpreadsheetApp.getUi().alert('Supplier reminder drafts complete.\n\n'+(ownerFilter?'Owner filter: '+ownerFilter:'Owner filter: ALL owners')+'\nRows scanned: '+totalRows+'\n\nDrafts created: '+totalEmails+' (one per supplier, '+totalRowsCovered+' invoices)\n  • Initial: '+initialEmails+'\n  • Reminder: '+reminderEmails+'\n  • Final/Escalation: '+escalationEmails+'\n\nSkipped:\n  • Other owner: '+skippedOtherOwner+'\n  • Resolved/Escalated: '+skippedResolved+'\n  • No supplier: '+skippedNoSupplier+'\n  • No email: '+skippedNoEmail+'\n'+fmtS(exNoEmail)+'  • Only internal CC: '+skippedAllInternal+'\n'+fmtS(exAllInternal)+'  • Too soon: '+skippedTooSoon+'\n\nDrafts in Gmail Drafts — review before sending.\nCC: '+CFG.EMAIL.CC.join(', '));
}

function buildSupplierBatchEmailBodies_(p) {
  const tz=Session.getScriptTimeZone(),fmtDate=d=>d?Utilities.formatDate(d,tz,'d-MMM-yyyy'):'—',fmtAmt=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const isInitial=p.kind==='initial',isFinal=!!p.isFinal,items=Array.isArray(p.items)?p.items:[],count=items.length;
  const arHeader=isInitial?'مطلوب إجراء — أرقام أوامر شراء مطلوبة لـ '+count+' فاتورة':(isFinal?'إشعار نهائي — لا تزال أرقام أوامر الشراء مطلوبة لـ '+count+' فاتورة':'تذكير رقم '+p.reminder+' — لا تزال أرقام أوامر الشراء مطلوبة لـ '+count+' فاتورة');
  const greeting='السادة / '+(p.supplier||'')+'،';
  const arIntro=isInitial?'تحية طيبة وبعد،\n\nاستلمنا الفواتير الموضحة أدناه ولكنها لا تتضمن أرقام أوامر شراء (PO). ووفقًا لسياسة الشركة الداخلية، لا يمكن إتمام صرف الفواتير بدون أرقام أوامر شراء صحيحة. برجاء التكرم بإرسال أرقام أوامر الشراء المرتبطة بهذه الفواتير في أقرب وقت ممكن.':(isFinal?'تحية طيبة وبعد،\n\nهذا هو تذكيرنا الأخير بشأن الفواتير الموضحة أدناه. لم نستلم أرقام أوامر الشراء على الرغم من التذكيرات السابقة، وحتى استلامها، ستظل هذه الفواتير معلقة ولن يتم صرفها.':'تحية طيبة وبعد،\n\nهذا تذكير ودي بشأن الفواتير الموضحة أدناه. برجاء إرسال أرقام أوامر الشراء المرتبطة بها لنتمكن من إتمام إجراءات الصرف.');
  const itemsHeader='تفاصيل الفواتير ('+count+' فاتورة):';
  const replyLine='في حال إصدار أوامر الشراء، برجاء الرد على هذا البريد بالأرقام (الصيغة: '+CFG.PO.MIN_SERIAL+' فأكثر، مثل 706279).';
  const etaLine='ولتجنب تكرار هذا التواصل في المستقبل، برجاء التكرم بإدراج رقم أمر الشراء على الفاتورة نفسها عند رفعها على منصة الفوترة الإلكترونية (ETA).';
  const closing='شكرًا لتعاونكم.',sigBlock='— فريق المالية لشركة رابيت';
  const itemFor=(it,idx)=>(idx+1)+'. الفاتورة رقم '+it.invoice+' | التاريخ: '+fmtDate(it.invDate)+' | القيمة: '+fmtAmt(it.amount)+' جنيه';
  const plain=[arHeader,'',greeting,'',arIntro,'',itemsHeader,items.map((it,idx)=>'  '+itemFor(it,idx)).join('\n'),'',replyLine,'',etaLine,'',closing,'',sigBlock].join('\n');
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const wrap=inner=>'<div dir="rtl" style="text-align:right; font-family:Tahoma, Arial, sans-serif; font-size:11pt; line-height:1.6;">'+inner+'</div>';
  const html=wrap(['<div style="font-weight:bold;">'+esc(arHeader)+'</div>','<div style="height:10px"></div>','<div style="font-weight:bold;">'+esc(greeting)+'</div>','<div style="height:8px"></div>',arIntro.split(/\n\n+/).map(par=>'<div>'+esc(par).replace(/\n/g,'<br/>')+'</div>').join('<div style="height:8px"></div>'),'<div style="height:10px"></div>','<div style="font-weight:bold;">'+esc(itemsHeader)+'</div>',items.map((it,idx)=>'<div>&nbsp;&nbsp;'+esc(itemFor(it,idx))+'</div>').join(''),'<div style="height:10px"></div>','<div>'+esc(replyLine)+'</div>','<div style="height:8px"></div>','<div style="font-weight:bold;">'+esc(etaLine)+'</div>','<div style="height:10px"></div>','<div>'+esc(closing)+'</div>','<div style="height:8px"></div>','<div>'+esc(sigBlock)+'</div>'].join(''));
  return {plain,html};
}

function parseSupplierEmails_(raw){const out={to:[],cc:[]};if(!raw)return out;const internalSuffix=String(CFG.INTERNAL_EMAIL_DOMAIN||'').toLowerCase(),seen=new Set();String(raw).replace(/[ ]/g,' ').split(/[,;|\/\s\r\n]+/).map(s=>s.trim().replace(/[<>"']/g,'')).filter(s=>s&&s.indexOf('@')>0).forEach(addr=>{const key=addr.toLowerCase();if(seen.has(key))return;seen.add(key);if(internalSuffix&&key.endsWith(internalSuffix))out.cc.push(addr);else out.to.push(addr);});return out;}


// ═══════════════════════════════════════════════════════════════
// SECTION 12 — SHARED UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function resolveCols_(headers,mapping,sheetName){const lower=headers.map(h=>h.toLowerCase().trim()),out={};Object.keys(mapping).forEach(key=>{const candidates=mapping[key];let idx=-1;for(const c of candidates){idx=lower.indexOf(c.toLowerCase());if(idx>=0)break;}if(idx<0&&['po','total'].includes(key)){throw new Error('Column "'+candidates[0]+'" not found in '+sheetName+'. Headers seen: '+headers.join(' | '));}out[key]=idx;});return out;}
function normalizePO_(v){if(v===null||v===undefined||v==='')return'';let s=String(v).trim();if(/^\d+\.0+$/.test(s))s=s.replace(/\.0+$/,'');return s;}
function validatePO_(v){const raw=normalizePO_(v);if(!raw)return{valid:false,normalized:'',reason:'blank'};const stripped=raw.replace(CFG.PO.PREFIX_REGEX,'').trim(),cleaned=/^\d+\.0+$/.test(stripped)?stripped.replace(/\.0+$/,''):stripped;if(CFG.PO.PATTERN.test(cleaned)){const n=parseInt(cleaned,10);if(n>=CFG.PO.MIN_SERIAL)return{valid:true,normalized:cleaned,reason:''};return{valid:false,normalized:cleaned,reason:'below_threshold'};}const m=cleaned.match(/\d{5,}/);if(m){const n=parseInt(m[0],10);if(n>=CFG.PO.MIN_SERIAL)return{valid:true,normalized:m[0],reason:''};return{valid:false,normalized:m[0],reason:'below_threshold'};}return{valid:false,normalized:cleaned||raw,reason:'invalid_format'};}
function toNumber_(v){if(v===null||v===undefined||v==='')return 0;if(typeof v==='number')return v;const s=String(v).replace(/,/g,'').trim(),n=parseFloat(s);return isNaN(n)?0:n;}
function coerceDate_(v){
  if(v instanceof Date) return v;
  if(!v) return null;

  // IMPORTANT for ETA / Egyptian invoices:
  // If the value is a slash/dash date string, treat it as DD/MM/YYYY before using JS Date,
  // because new Date('05/08/2025') can be interpreted as MM/DD/YYYY.
  const s = String(v).trim();
  const ddmmyyyy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+.*)?$/);
  if(ddmmyyyy) {
    const parsed = new Date(
      parseInt(ddmmyyyy[3],10), parseInt(ddmmyyyy[2],10)-1, parseInt(ddmmyyyy[1],10)
    );
    if(!isNaN(parsed.getTime())) return parsed;
  }

  // Direct parse afterwards for ISO strings and serial/date objects coming from Sheets.
  const d = new Date(v);
  if(!isNaN(d.getTime())) return d;
  return null;
}
function computeDueDate_(invoiceDate,term){if(!invoiceDate||!term)return'';const t=String(term).trim();let m=t.match(/(\d+)\s*days?\s*(?:after\s*end\s*of\s*month|EOM|end\s*of\s*month)/i);if(m){const days=parseInt(m[1],10),eom=new Date(invoiceDate.getFullYear(),invoiceDate.getMonth()+1,0);eom.setDate(eom.getDate()+days);return eom;}m=t.match(/^(?:net\s*)?(\d+)\s*days?$/i);if(m){const days=parseInt(m[1],10),d=new Date(invoiceDate.getTime());d.setDate(d.getDate()+days);return d;}return'';}
function stripTime_(d){const x=new Date(d);x.setHours(0,0,0,0);return x;}
function letterToColIndex_(letter){const s=String(letter||'').toUpperCase().trim();let n=0;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<65||c>90)return-1;n=n*26+(c-64);}return n;}
function extractPOFromText_(text){if(!text)return null;const m=String(text).match(CFG_QTY.PO_EXTRACT_PATTERN);return m?m[1]:null;}
function normalizeArText_(text){return String(text||'').replace(/[٠١٢٣٤٥٦٧٨٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[أإآا]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').toLowerCase().replace(/[^\w\u0600-\u06ff\d]/g,' ').replace(/\s+/g,' ').trim();}
function extractNums_(text){return(String(text).match(/\d+\.?\d*/g)||[]).map(Number).filter(n=>n>0);}
function numOverlapScore_(n1,n2){if(!n1.length||!n2.length)return 0;const s2=new Set(n2.map(String));return n1.filter(n=>s2.has(String(n))).length/Math.max(n1.length,n2.length);}
function applyBrandMapping_(text,map){let r=text;Object.entries(map).forEach(([k,v])=>{try{r=r.replace(new RegExp(k,'gi'),v);}catch(_){}});return r;}
function qtyWordSimilarity_(a,b){const wa=new Set((a||'').split(' ').filter(w=>w.length>2)),wb=new Set((b||'').split(' ').filter(w=>w.length>2));if(!wa.size||!wb.size)return 0;return[...wa].filter(w=>wb.has(w)).length/Math.max(wa.size,wb.size);}
function groupByKey_(arr,key){return arr.reduce((acc,item)=>{const k=item[key];if(!acc[k])acc[k]=[];acc[k].push(item);return acc},{});}
function round2_(n){return Math.round((n||0)*100)/100;}
function getQtyAgingBucket_(days){for(const b of CFG_QTY.AGING){if(days<=b.maxDays)return b.label;}return CFG_QTY.AGING[CFG_QTY.AGING.length-1].label;}