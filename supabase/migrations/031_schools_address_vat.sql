-- Full address (address = line 1) and VAT number on schools
ALTER TABLE schools ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS vat_number TEXT;
