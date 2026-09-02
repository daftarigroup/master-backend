import { prisma } from '../database/prisma';
import fs from 'fs';
import path from 'path';

function csvEscape(val: any): string {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
}

function getInventoryStatus(current: number): string {
    if (current <= 0) return 'Out of Stock';
    if (current < 5) return 'Low Stock';
    return 'In Stock';
}

async function main() {
    console.log('Fetching data for inventory calculation...');
    
    const [rawInventory, indents, storeIns, issues, transfers, firms] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>('SELECT * FROM inventory ORDER BY item_name ASC'),
        prisma.$queryRawUnsafe<any[]>('SELECT * FROM indent'),
        prisma.$queryRawUnsafe<any[]>('SELECT * FROM store_in'),
        prisma.$queryRawUnsafe<any[]>('SELECT * FROM issue'),
        prisma.$queryRawUnsafe<any[]>('SELECT * FROM stock_transfer').catch(() => []),
        prisma.$queryRawUnsafe<any[]>('SELECT id, name FROM firm').catch(() => []),
    ]);

    const firmMap = new Map<string, string>();
    firms.forEach(f => firmMap.set(String(f.id), f.name || ''));

    console.log(`Loaded: ${rawInventory.length} inventory rows, ${indents.length} indents, ${storeIns.length} store_in rows, ${issues.length} issue rows, ${transfers.length} transfers`);

    // Group transactional data by product name
    const indentMap: Record<string, { indented: number; approved: number }> = {};
    indents.forEach(i => {
        const key = (i.product_name || i.product || '').trim();
        if (!key) return;
        if (!indentMap[key]) indentMap[key] = { indented: 0, approved: 0 };
        indentMap[key].indented += Number(i.quantity) || 0;
        indentMap[key].approved += Number(i.approved_quantity) || 0;
    });

    const storeInMap: Record<string, { liftingQty: number; purchaseQuantity: number; purchaseReturn: number; stockTransfer: number }> = {};
    storeIns.forEach(s => {
        const key = (s.product_name || s.product || '').trim();
        if (!key) return;
        if (!storeInMap[key]) storeInMap[key] = { liftingQty: 0, purchaseQuantity: 0, purchaseReturn: 0, stockTransfer: 0 };

        const qty = Number(s.received_quantity) || 0;
        const totalQty = Number(s.qty) || 0;
        const retQty = Number(s.return_quantity) || 0;

        if (s.receiving_status === 'Transfer') {
            storeInMap[key].stockTransfer += qty;
        } else {
            storeInMap[key].liftingQty += qty;
            storeInMap[key].purchaseQuantity += totalQty;
            storeInMap[key].purchaseReturn += retQty;
        }
    });

    const issueMap: Record<string, { outQuantity: number; issueReturn: number }> = {};
    issues.forEach(is => {
        const key = (is.product_name || is.product || '').trim();
        if (!key) return;
        if (!issueMap[key]) issueMap[key] = { outQuantity: 0, issueReturn: 0 };
        issueMap[key].outQuantity += Number(is.given_qty) || 0;

        const retQty = Number(is.rejected_damage_qty) || 0;
        if (retQty === 0 && (is.return_slip || is.return_person_name)) {
            issueMap[key].issueReturn += Number(is.quantity) || 0;
        } else {
            issueMap[key].issueReturn += retQty;
        }
    });

    const transferMap: Record<string, { inQty: number; outQty: number; sources: Set<string>; destinations: Set<string> }> = {};
    transfers.forEach(t => {
        const key = (t.product_name || '').trim();
        if (!key) return;
        if (!transferMap[key]) transferMap[key] = { inQty: 0, outQty: 0, sources: new Set(), destinations: new Set() };
        const q = Number(t.quantity) || 0;
        transferMap[key].inQty += q;
        transferMap[key].outQty += q;
        if (t.from_project) transferMap[key].sources.add(t.from_project);
        if (t.to_project) transferMap[key].destinations.add(t.to_project);
    });

    // All unique item names
    const allItemNames = Array.from(new Set([
        ...rawInventory.map(r => (r.item_name || '').trim()).filter(Boolean),
        ...Object.keys(indentMap),
        ...Object.keys(storeInMap),
        ...Object.keys(issueMap),
        ...Object.keys(transferMap)
    ])).sort((a, b) => a.localeCompare(b));

    const records: any[] = [];

    allItemNames.forEach(itemName => {
        const rawMatches = rawInventory.filter(r => (r.item_name || '').trim() === itemName);
        
        let opening = 0;
        let individualRate = 0;
        let groupHead = '';
        let uom = '';
        let firmName = '';

        if (rawMatches.length > 0) {
            opening = rawMatches.reduce((acc, r) => acc + (Number(r.opening) || 0), 0);
            individualRate = Number(rawMatches[0].individual_rate) || Number(rawMatches[0].rate) || 0;
            groupHead = rawMatches[0].group_head || '';
            uom = rawMatches[0].uom || '';
            firmName = rawMatches[0].firm_name || (rawMatches[0].firm_id ? firmMap.get(String(rawMatches[0].firm_id)) : '') || '';
        }

        const ind = indentMap[itemName] || { indented: 0, approved: 0 };
        const stIn = storeInMap[itemName] || { liftingQty: 0, purchaseQuantity: 0, purchaseReturn: 0, stockTransfer: 0 };
        const iss = issueMap[itemName] || { outQuantity: 0, issueReturn: 0 };
        const tr = transferMap[itemName] || { inQty: 0, outQty: 0, sources: new Set(), destinations: new Set() };

        const inTransit = Math.max(0, stIn.purchaseQuantity - stIn.liftingQty);
        const totalReceived = stIn.liftingQty + stIn.stockTransfer + tr.inQty;
        const totalOut = iss.outQuantity + stIn.purchaseReturn + tr.outQty;
        const current = Math.max(0, opening + totalReceived + iss.issueReturn - totalOut);
        const totalPrice = Number((current * individualRate).toFixed(2));
        const status = getInventoryStatus(current);

        records.push({
            itemName,
            groupHead,
            uom,
            firmName,
            opening,
            individualRate,
            indented: ind.indented,
            approved: ind.approved,
            liftingQty: stIn.liftingQty,
            inTransit,
            outQuantity: iss.outQuantity,
            issueReturn: iss.issueReturn,
            purchaseReturn: stIn.purchaseReturn,
            stockTransferGiven: tr.outQty,
            stockTransferTo: Array.from(tr.destinations).join('; '),
            stockTransferReceiving: stIn.stockTransfer + tr.inQty,
            stockTransferFrom: Array.from(tr.sources).join('; '),
            current,
            avgPrice: individualRate,
            totalPrice,
            status,
        });
    });

    // Generate CSV
    const headers = [
        'Item Name',
        'Group Head',
        'UOM',
        'Project / Firm Name',
        'Opening Stock',
        'Rate (₹)',
        'Indented Qty',
        'Approved Qty',
        'Lifting Qty (Received)',
        'In Transit Qty',
        'Issued Qty (Out)',
        'Issue Return Qty',
        'Purchase Return Qty',
        'Stock Transfer (To / Given)',
        'Transfer Destinations',
        'Stock Transfer (From / Received)',
        'Transfer Sources',
        'Current Stock Quantity',
        'Avg Price (₹)',
        'Total Valuation (₹)',
        'Stock Status'
    ];

    const csvRows = [headers.map(h => csvEscape(h)).join(',')];

    records.forEach(r => {
        const row = [
            r.itemName,
            r.groupHead,
            r.uom,
            r.firmName,
            r.opening,
            r.individualRate,
            r.indented,
            r.approved,
            r.liftingQty,
            r.inTransit,
            r.outQuantity,
            r.issueReturn,
            r.purchaseReturn,
            r.stockTransferGiven,
            r.stockTransferTo,
            r.stockTransferReceiving,
            r.stockTransferFrom,
            r.current,
            r.avgPrice,
            r.totalPrice,
            r.status,
        ];
        csvRows.push(row.map(v => csvEscape(v)).join(','));
    });

    const csvContent = csvRows.join('\r\n');

    const outputPath = path.resolve(__dirname, '../../../current_inventory_data.csv');
    fs.writeFileSync(outputPath, csvContent, 'utf8');

    console.log(`✅ Successfully generated CSV with ${records.length} items at: ${outputPath}`);
    process.exit(0);
}

main().catch(err => {
    console.error('Error exporting inventory:', err);
    process.exit(1);
});
