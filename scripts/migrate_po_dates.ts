import { Client } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
dotenv.config();

async function runMigration() {
    const csvPath = 'd:/Botivate/pooja/master/po date.csv';
    if (!fs.existsSync(csvPath)) {
        console.error('CSV file not found at:', csvPath);
        process.exit(1);
    }

    const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter(Boolean);
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    console.log('Connected to PostgreSQL database');

    let totalUpdatedRows = 0;
    let updatedPoCount = 0;

    for (let i = 1; i < lines.length; i++) {
        const [poNo, dateStr] = lines[i].split(',').map(s => s.trim());
        if (!poNo || !dateStr) {
            console.log(`Skipping row ${i}: PO=${poNo}, Date=${dateStr}`);
            continue;
        }

        const res = await client.query('UPDATE po_master SET po_created_date = $1 WHERE po_number = $2;', [dateStr, poNo]);
        const count = res.rowCount || 0;
        totalUpdatedRows += count;
        if (count > 0) updatedPoCount++;
        console.log(`Updated PO "${poNo}" -> po_created_date = "${dateStr}" (${count} database rows)`);
    }

    console.log(`\nMigration Summary:`);
    console.log(`- Total PO numbers processed: ${updatedPoCount}`);
    console.log(`- Total database rows updated in po_master: ${totalUpdatedRows}`);

    await client.end();
}

runMigration().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
