const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class PurchaseController extends BaseController {
    constructor() {
        super('purchases');
    }

    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const { purchase_no, from_date, to_date, supplier_id, status } = req.query;

            let query = `
                SELECT p.*, s.name as supplier_name, w.name as warehouse_name, u.name as user_name
                FROM purchases p
                LEFT JOIN suppliers s ON p.supplier_id = s.id
                LEFT JOIN warehouses w ON p.warehouse_id = w.id
                LEFT JOIN users u ON p.user_id = u.id
                WHERE 1=1
            `;
            let countQuery = `SELECT COUNT(*) as total FROM purchases p WHERE 1=1`;
            let params = [];
            let countParams = [];

            if (purchase_no) {
                query += ` AND p.purchase_no LIKE ?`;
                countQuery += ` AND p.purchase_no LIKE ?`;
                params.push(`%${purchase_no}%`);
                countParams.push(`%${purchase_no}%`);
            }
            if (from_date) {
                query += ` AND p.date >= ?`;
                countQuery += ` AND p.date >= ?`;
                params.push(from_date);
                countParams.push(from_date);
            }
            if (to_date) {
                query += ` AND p.date <= ?`;
                countQuery += ` AND p.date <= ?`;
                params.push(to_date);
                countParams.push(to_date);
            }
            if (supplier_id) {
                query += ` AND p.supplier_id = ?`;
                countQuery += ` AND p.supplier_id = ?`;
                params.push(supplier_id);
                countParams.push(supplier_id);
            }
            if (status) {
                query += ` AND p.payment_status = ?`;
                countQuery += ` AND p.payment_status = ?`;
                params.push(status);
                countParams.push(status);
            }

            query += ` ORDER BY p.id DESC LIMIT ? OFFSET ?`;
            params.push(limit.toString(), offset.toString());

            const [rows] = await db.execute(query, params);
            const [totalRows] = await db.execute(countQuery, countParams);
            const total = totalRows[0].total;
            const lastPage = Math.ceil(total / limit);

            res.json({
                data: rows,
                total: total,
                current_page: page,
                last_page: lastPage,
                per_page: limit
            });
        } catch (error) {
            logger.error('Error fetching purchases', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getById = async (req, res) => {
        try {
            const { id } = req.params;
            
            const [rows] = await db.execute(`
                SELECT p.*, s.name as supplier_name, w.name as warehouse_name, u.name as user_name
                FROM purchases p
                LEFT JOIN suppliers s ON p.supplier_id = s.id
                LEFT JOIN warehouses w ON p.warehouse_id = w.id
                LEFT JOIN users u ON p.user_id = u.id
                WHERE p.id = ?
            `, [id]);
            
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Not found' });
            }
            
            const purchase = rows[0];
            
            // Get details
            const [detailRows] = await db.execute(`
                SELECT pd.*, i.name as item_name, u.name as unit_name
                FROM purchase_details pd
                LEFT JOIN items i ON pd.item_id = i.id
                LEFT JOIN item_units iu ON pd.item_unit_id = iu.id
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE pd.purchase_id = ?
            `, [id]);
            
            purchase.details = detailRows.map(d => ({
                ...d,
                item: { name: d.item_name },
                unit: { unit: { name: d.unit_name } }
            }));
            
            res.json(purchase);
        } catch (error) {
            logger.error('Error fetching purchase by ID', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { supplier_id, warehouse_id, date, payment_method, due_date, discount, note, items, pay_amount } = req.body;

            if (!supplier_id || !warehouse_id || !items || items.length === 0) {
                return res.status(400).json({ message: 'Supplier, warehouse and items are required' });
            }

            // Generate Purchase No: PRC-YYYYMMDD-XXXX
            const dateObj = new Date(date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const datePrefix = `${year}${month}${day}`;

            const [countResult] = await conn.execute(
                "SELECT COUNT(*) as total FROM purchases WHERE purchase_no LIKE ?",
                [`PRC-${datePrefix}-%`]
            );
            const count = countResult[0].total;
            const purchaseNo = `PRC-${datePrefix}-${(count + 1).toString().padStart(4, '0')}`;

            const total = items.reduce((acc, item) => acc + (item.qty * item.price), 0);
            const grandTotal = total - (discount || 0);

            let paymentStatus = 'unpaid';
            let changeAmount = 0;
            let actualPay = parseFloat(pay_amount) || 0;

            if (payment_method === 'Credit') {
                actualPay = 0;
                paymentStatus = 'unpaid';
            } else {
                if (actualPay >= grandTotal) {
                    paymentStatus = 'paid';
                    changeAmount = actualPay - grandTotal;
                } else if (actualPay > 0 && actualPay < grandTotal) {
                    paymentStatus = 'partial';
                }
            }

            const [result] = await conn.execute(
                `INSERT INTO purchases (
                    purchase_no, supplier_id, warehouse_id, date, total, discount, 
                    payment_status, payment_method, due_date, user_id, note, pay_amount, change_amount
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    purchaseNo, supplier_id, warehouse_id, date, grandTotal, discount || 0,
                    paymentStatus, payment_method, due_date || null, req.user.id, note || null, actualPay, changeAmount
                ]
            );
            const purchaseId = result.insertId;

            for (const item of items) {
                const subtotal = item.qty * item.price;
                await conn.execute(
                    `INSERT INTO purchase_details (
                        purchase_id, item_id, item_unit_id, qty, price, subtotal
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    [purchaseId, item.item_id, item.item_unit_id, item.qty, item.price, subtotal]
                );

                // Update Stock
                const [unitRows] = await conn.execute('SELECT amount, last_purchase_price FROM item_units WHERE id = ?', [item.item_unit_id]);
                const amount = unitRows[0]?.amount || 1;
                const lastPurchasePrice = unitRows[0]?.last_purchase_price || 0;
                const baseQty = item.qty * amount;

                // Get current stock to calculate before/after
                const [stockRows] = await conn.execute(
                    'SELECT qty FROM stocks WHERE item_id = ? AND warehouse_id = ?',
                    [item.item_id, warehouse_id]
                );
                const qtyBefore = stockRows[0]?.qty || 0;
                const qtyAfter = qtyBefore + baseQty;

                // Increase stock
                await conn.execute(
                    'INSERT INTO stocks (item_id, warehouse_id, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + ?',
                    [item.item_id, warehouse_id, baseQty, baseQty]
                );

                // Insert stock history
                await conn.execute(
                    `INSERT INTO stock_histories (
                        item_id, warehouse_id, reference_type, reference_id, qty_change, qty_before, qty_after, note, user_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        item.item_id, warehouse_id, 'Purchase', purchaseId, baseQty, qtyBefore, qtyAfter, `Pembelian ${purchaseNo}`, req.user.id
                    ]
                );

                // Update Purchase Price History only if price changed
                if (lastPurchasePrice != item.price) {
                    await conn.execute(
                        `INSERT INTO item_purchase_prices (
                            item_id, item_unit_id, supplier_id, price, date
                        ) VALUES (?, ?, ?, ?, ?)`,
                        [item.item_id, item.item_unit_id, supplier_id, item.price, date]
                    );

                    await conn.execute(
                        'UPDATE item_units SET last_purchase_price = ? WHERE id = ?',
                        [item.price, item.item_unit_id]
                    );
                }
            }

            // Insert Journal
            const [invAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1201' OR name LIKE '%Persediaan%' LIMIT 1`);
            const [cashAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1001' OR name LIKE '%Kas%' LIMIT 1`);
            const [bankAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1003' OR name LIKE '%Bank%' LIMIT 1`);
            const [utangAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '2-2101' OR name LIKE '%Utang%' LIMIT 1`);

            const invAccId = invAcc[0]?.id || 4; 
            const cashAccId = cashAcc[0]?.id || 1; 
            const bankAccId = bankAcc[0]?.id || 6; 
            const utangAccId = utangAcc[0]?.id || 3; 

            const [journalResult] = await conn.execute(
                `INSERT INTO journals (date, reference_no, description, source_type, source_id, user_id) VALUES (?, ?, ?, 'Purchase', ?, ?)`,
                [date, purchaseNo, `Pembelian #${purchaseNo}`, purchaseId, req.user.id]
            );
            const journalId = journalResult.insertId;

            // Debit Inventory
            await conn.execute(
                `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                [journalId, invAccId, grandTotal]
            );

            // Credit Cash/Bank and AP
            let remainingDebt = grandTotal;
            let paidCash = Math.min(actualPay, grandTotal);

            if (paidCash > 0) {
                let cashOrBankAccId = (payment_method === 'Transfer' || payment_method === 'Transfer Bank') ? bankAccId : cashAccId;
                await conn.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                    [journalId, cashOrBankAccId, paidCash]
                );
                remainingDebt -= paidCash;
            }

            if (remainingDebt > 0) {
                await conn.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                    [journalId, utangAccId, remainingDebt]
                );
            }

            await conn.commit();
            res.status(201).json({ message: 'Pembelian berhasil disimpan', id: purchaseId, purchase_no: purchaseNo });
        } catch (error) {
            await conn.rollback();
            logger.error('Error creating purchase', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };
}

module.exports = new PurchaseController();
