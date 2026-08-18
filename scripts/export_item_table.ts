import dotenv from 'dotenv';
dotenv.config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fs from 'fs';
import path from 'path';
import { prisma } from '../src/database/prisma';

// Helper to escape CSV cell value
function escapeCsvValue(val: any): string {
    if (val === null || val === undefined) {
        return '';
    }
    let strVal: string;
    if (val instanceof Date) {
        strVal = val.toISOString();
    } else if (Array.isArray(val)) {
        strVal = val.join(', ');
    } else if (typeof val === 'object') {
        strVal = JSON.stringify(val);
    } else {
        strVal = String(val);
    }

    // Escape double quotes and enclose in double quotes if needed
    if (strVal.includes('"') || strVal.includes(',') || strVal.includes('\n') || strVal.includes('\r')) {
        return `"${strVal.replace(/"/g, '""')}"`;
    }
    return strVal;
}

async function exportItemsToCsv() {
    console.log('🔄 Fetching items with resolved foreign keys (Group Head, UOM, Firm)...');

    try {
        const items = await prisma.item.findMany({
            include: {
                group_head: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                uom: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                firm: {
                    select: {
                        id: true,
                        firm_name: true,
                    },
                },
            },
            orderBy: {
                id: 'asc',
            },
        });

        console.log(`✅ Fetched ${items.length} item records.`);

        // Define CSV Headers
        const headers = [
            'ID',
            'Item Name',
            'Group Head',
            'UOM',
            'Firm Name',
            'Group Head ID',
            'UOM ID',
            'Firm ID',
            'Regular Pay Condition',
            'Third Party Pay Condition',
            'Created At',
        ];

        // Map records to CSV rows
        const rows = items.map((item) => {
            return [
                escapeCsvValue(item.id),
                escapeCsvValue(item.item_name),
                escapeCsvValue(item.group_head?.name || ''),
                escapeCsvValue(item.uom?.name || ''),
                escapeCsvValue(item.firm?.firm_name || ''),
                escapeCsvValue(item.group_head_id),
                escapeCsvValue(item.uom_id),
                escapeCsvValue(item.firm_id),
                escapeCsvValue(item.regular_pay_condition),
                escapeCsvValue(item.third_party_pay_condition),
                escapeCsvValue(item.created_at),
            ].join(',');
        });

        const csvContent = [headers.join(','), ...rows].join('\r\n');

        // Output destination (workspace root and current folder)
        const outputDir = path.resolve(__dirname, '../../exports');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `items_export_${timestamp}.csv`;
        const latestFilename = `items_export_latest.csv`;

        const outputPath = path.join(outputDir, filename);
        const latestPath = path.join(outputDir, latestFilename);

        fs.writeFileSync(outputPath, '\uFEFF' + csvContent, 'utf8'); // Adding BOM for Excel compatibility
        fs.writeFileSync(latestPath, '\uFEFF' + csvContent, 'utf8');

        console.log(`\n🎉 CSV export successfully created!`);
        console.log(`📁 File 1: ${outputPath}`);
        console.log(`📁 File 2 (Latest): ${latestPath}`);
        console.log(`📊 Total Items Exported: ${items.length}`);

    } catch (error) {
        console.error('❌ Error exporting items to CSV:', error);
    } finally {
        await prisma.$disconnect();
    }
}

exportItemsToCsv();
