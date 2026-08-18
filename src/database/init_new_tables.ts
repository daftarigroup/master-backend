import { prisma } from './prisma';

async function initNewTables() {
  console.log('Checking and creating tables for Petty Cash & Doc-Submanager...');

  // 1. Enums
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "PettyCashEntryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "PettyCashLedgerType" AS ENUM ('CREDIT', 'EXPENSE', 'DEBIT');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  // 2. Credits table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "credits" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sn" TEXT NOT NULL UNIQUE,
      "personName" TEXT NOT NULL,
      "projectName" TEXT,
      "date" DATE NOT NULL,
      "amount" DECIMAL(12,2) NOT NULL,
      "paymentMode" TEXT NOT NULL,
      "image" TEXT,
      "remarks" TEXT,
      "status" "PettyCashEntryStatus" NOT NULL DEFAULT 'APPROVED',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "credits_personName_idx" ON "credits"("personName");
  `);

  // 3. Expenses table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "expenses" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sn" TEXT NOT NULL UNIQUE,
      "personName" TEXT NOT NULL,
      "projectName" TEXT,
      "date" DATE NOT NULL,
      "amount" DECIMAL(12,2) NOT NULL,
      "paymentMode" TEXT NOT NULL,
      "groupHead" TEXT NOT NULL,
      "image" TEXT,
      "remarks" TEXT,
      "status" "PettyCashEntryStatus" NOT NULL DEFAULT 'PENDING',
      "approvedBy" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "expenses_personName_idx" ON "expenses"("personName");
  `);

  // 4. Ledger Entries table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ledger_entries" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "personName" TEXT NOT NULL,
      "type" "PettyCashLedgerType" NOT NULL,
      "amount" DECIMAL(12,2) NOT NULL,
      "date" DATE NOT NULL,
      "balance" DECIMAL(12,2) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "creditId" TEXT,
      "expenseId" TEXT,
      CONSTRAINT "ledger_entries_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "credits"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "ledger_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS "ledger_entries_personName_idx" ON "ledger_entries"("personName");
  `);

  // 5. Project Master table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "project_master" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "type" TEXT NOT NULL,
      "value" TEXT NOT NULL,
      "address" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "project_master_type_value_key" UNIQUE ("type", "value")
    );
    CREATE INDEX IF NOT EXISTS "project_master_type_idx" ON "project_master"("type");
  `);

  // 6. Settings table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "settings" (
      "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
      "paymentModes" TEXT[] DEFAULT ARRAY[]::TEXT[],
      "lastSerialNumber" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 7. Doc Documents table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "doc_documents" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sn" TEXT NOT NULL UNIQUE,
      "companyName" TEXT NOT NULL,
      "documentType" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "documentName" TEXT NOT NULL,
      "needsRenewal" BOOLEAN NOT NULL DEFAULT false,
      "renewalDate" DATE,
      "file" TEXT,
      "fileContent" TEXT,
      "date" DATE NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'Active',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "doc_documents_companyName_idx" ON "doc_documents"("companyName");
  `);

  // 8. Doc Renewals table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "doc_renewals" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "documentId" TEXT NOT NULL,
      "sn" TEXT NOT NULL,
      "documentName" TEXT NOT NULL,
      "documentType" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "companyName" TEXT NOT NULL,
      "entryDate" DATE NOT NULL,
      "oldRenewalDate" DATE,
      "oldFile" TEXT,
      "oldFileContent" TEXT,
      "renewalStatus" TEXT NOT NULL DEFAULT 'No',
      "nextRenewalDate" DATE,
      "newFile" TEXT,
      "newFileContent" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "doc_renewals_documentId_idx" ON "doc_renewals"("documentId");
  `);

  // 9. Doc Shares table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "doc_shares" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shareNo" TEXT NOT NULL UNIQUE,
      "dateTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "docSerial" TEXT NOT NULL,
      "docName" TEXT NOT NULL,
      "docFile" TEXT,
      "sharedVia" TEXT NOT NULL,
      "recipientName" TEXT NOT NULL,
      "contactInfo" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 10. Doc Subscriptions table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "doc_subscriptions" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sn" TEXT NOT NULL UNIQUE,
      "requestedDate" DATE NOT NULL,
      "companyName" TEXT NOT NULL,
      "subscriberName" TEXT NOT NULL,
      "subscriptionName" TEXT NOT NULL,
      "price" TEXT NOT NULL,
      "frequency" TEXT NOT NULL,
      "purpose" TEXT NOT NULL,
      "startDate" DATE,
      "endDate" DATE,
      "status" TEXT NOT NULL DEFAULT '',
      "plan" TEXT,
      "file" TEXT,
      "fileContent" TEXT,
      "approvalNo" TEXT,
      "approvalDate" DATE,
      "paymentDate" DATE,
      "paymentMethod" TEXT,
      "paymentFile" TEXT,
      "paymentFileContent" TEXT,
      "remarks" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "doc_subscriptions_companyName_idx" ON "doc_subscriptions"("companyName");
  `);

  // 11. Doc Subscription Renewals table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "doc_subscription_renewals" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "subscriptionId" TEXT NOT NULL,
      "renewalNo" TEXT NOT NULL UNIQUE,
      "sn" TEXT NOT NULL,
      "companyName" TEXT NOT NULL,
      "subscriberName" TEXT NOT NULL,
      "subscriptionName" TEXT NOT NULL,
      "frequency" TEXT NOT NULL,
      "price" TEXT NOT NULL,
      "endDate" DATE,
      "renewalStatus" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "doc_subscription_renewals_subscriptionId_idx" ON "doc_subscription_renewals"("subscriptionId");
  `);

  // 12. Doc Loans table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "doc_loans" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sn" TEXT NOT NULL UNIQUE,
      "loanName" TEXT NOT NULL,
      "bankName" TEXT NOT NULL,
      "amount" TEXT NOT NULL,
      "emi" TEXT NOT NULL,
      "startDate" DATE NOT NULL,
      "endDate" DATE NOT NULL,
      "providedDocument" TEXT NOT NULL,
      "remarks" TEXT,
      "file" TEXT,
      "fileContent" TEXT,
      "foreclosureStatus" TEXT,
      "requestDate" DATE,
      "requesterName" TEXT,
      "documentStatus" TEXT,
      "documentCollectionRemarks" TEXT,
      "closerRequestDate" DATE,
      "collectNocStatus" TEXT,
      "finalSettlementStatus" TEXT,
      "nextDate" DATE,
      "settlementDate" DATE,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "doc_loans_bankName_idx" ON "doc_loans"("bankName");
  `);

  // 13. Doc Counters table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "doc_counters" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" INTEGER NOT NULL DEFAULT 0
    );
  `);

  console.log('✅ All tables and constraints verified/created successfully!');
  await prisma.$disconnect();
}

initNewTables().catch((err) => {
  console.error('Error creating tables:', err);
  process.exit(1);
});
