-- 1. Matikan pengecekan foreign key
SET FOREIGN_KEY_CHECKS = 0;

-- 2. Reset Data Penjualan (Sales)
DELETE FROM sale_details;
DELETE FROM sales;
ALTER TABLE sale_details AUTO_INCREMENT = 1;
ALTER TABLE sales AUTO_INCREMENT = 1;

-- 3. Reset Data Pembelian (Purchases)
DELETE FROM purchase_details;
DELETE FROM purchases;
ALTER TABLE purchase_details AUTO_INCREMENT = 1;
ALTER TABLE purchases AUTO_INCREMENT = 1;

-- 4. Reset Data Retur
DELETE FROM sales_return_details;
DELETE FROM sales_returns;
DELETE FROM purchase_return_details;
DELETE FROM purchase_returns;
ALTER TABLE sales_return_details AUTO_INCREMENT = 1;
ALTER TABLE sales_returns AUTO_INCREMENT = 1;
ALTER TABLE purchase_return_details AUTO_INCREMENT = 1;
ALTER TABLE purchase_returns AUTO_INCREMENT = 1;

-- 5. Reset Data Stok dan Riwayat Stok
DELETE FROM stock_histories;
DELETE FROM stocks;
ALTER TABLE stock_histories AUTO_INCREMENT = 1;
ALTER TABLE stocks AUTO_INCREMENT = 1;

-- 6. Reset Data Kasir & Saldo
DELETE FROM cashier_sessions;
ALTER TABLE cashier_sessions AUTO_INCREMENT = 1;

-- 7. Reset Data Jurnal & Akuntansi
DELETE FROM journal_items;
DELETE FROM journals;
ALTER TABLE journal_items AUTO_INCREMENT = 1;
ALTER TABLE journals AUTO_INCREMENT = 1;

-- 8. Reset Data Pelunasan H/P
DELETE FROM payments;
ALTER TABLE payments AUTO_INCREMENT = 1;


-- 6. Hidupkan kembali pengecekan foreign key
SET FOREIGN_KEY_CHECKS = 1;
