-- CreateTable
CREATE TABLE "pms_contract_vendor" (
    "id" SERIAL NOT NULL,
    "vendor_id" BIGINT,
    "vendor_name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pms_contract_vendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pms_contract_vendor_vendor_name_key" ON "pms_contract_vendor"("vendor_name");
