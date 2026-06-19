const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class SaleController extends BaseController {
    constructor() {
        super('sales');
    }

    // Override getAll to include relations
    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const { invoice_no, status, method, startDate, endDate } = req.query;

            let query = `
                SELECT s.*, c.name as customer_name, u.name as user_input
                FROM sales s 
                LEFT JOIN customers c ON s.customer_id = c.id
                LEFT JOIN users u ON s.user_id = u.id
                WHERE 1=1
            `;
            let countQuery = `SELECT COUNT(*) as total FROM sales s WHERE 1=1`;
            let params = [];
            let countParams = [];

            if (invoice_no) {
                query += ` AND s.invoice_no LIKE ?`;
                countQuery += ` AND s.invoice_no LIKE ?`;
                params.push(`%${invoice_no}%`);
                countParams.push(`%${invoice_no}%`);
            }
            if (status) {
                query += ` AND s.status = ?`;
                countQuery += ` AND s.status = ?`;
                params.push(status);
                countParams.push(status);
            }
            if (method) {
                query += ` AND s.payment_method = ?`;
                countQuery += ` AND s.payment_method = ?`;
                params.push(method);
                countParams.push(method);
            }
            if (startDate) {
                query += ` AND s.date >= ?`;
                countQuery += ` AND s.date >= ?`;
                params.push(startDate);
                countParams.push(startDate);
            }
            if (endDate) {
                query += ` AND s.date <= ?`;
                countQuery += ` AND s.date <= ?`;
                params.push(endDate);
                countParams.push(endDate);
            }

            query += ` ORDER BY s.id DESC LIMIT ? OFFSET ?`;
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
            logger.error('Error fetching sales', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getById = async (req, res) => {
        try {
            const { id } = req.params;
            
            // Get sale header
            const [saleRows] = await db.execute(`
                SELECT s.*, c.name as customer_name, u.name as user_input
                FROM sales s 
                LEFT JOIN customers c ON s.customer_id = c.id
                LEFT JOIN users u ON s.user_id = u.id
                WHERE s.id = ?
            `, [id]);
            
            if (saleRows.length === 0) {
                return res.status(404).json({ message: 'Not found' });
            }
            
            const sale = saleRows[0];
            
            // Get sale details
            const [detailRows] = await db.execute(`
                SELECT sd.*, i.name as item_name, i.weight, iu.amount as unit_amount, u.name as unit_name,
                       COALESCE((
                           SELECT SUM(srd.qty)
                           FROM sales_return_details srd
                           JOIN sales_returns sr ON srd.sales_return_id = sr.id
                           WHERE sr.sale_id = sd.sale_id 
                             AND srd.item_id = sd.item_id 
                             AND srd.item_unit_id = sd.item_unit_id
                             AND sr.status != 'cancelled'
                       ), 0) as already_returned_qty
                FROM sale_details sd
                LEFT JOIN items i ON sd.item_id = i.id
                LEFT JOIN item_units iu ON sd.item_unit_id = iu.id
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE sd.sale_id = ?
            `, [id]);
            
            // Format details to match frontend expectations
            sale.details = detailRows.map(d => ({
                ...d,
                item: { name: d.item_name },
                unit: { unit: { name: d.unit_name } }
            }));
            
            res.json(sale);
        } catch (error) {
            logger.error('Error fetching sale by ID', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { date, customer_id, warehouse_id, subtotal, discount, shipping_cost, total, status, payment_method, pay_amount, change_amount, due_date, items, alias, discount_package_id, shipping_method, courier_name, shipping_address, estimation_days, estimation_arrival, total_weight } = req.body;

            if (!customer_id || !items || items.length === 0) {
                await conn.rollback();
                return res.status(400).json({ message: 'Customer and items are required' });
            }

            // Check Credit Limit
            let current_debt = 0;
            if (payment_method === 'Credit') {
                current_debt = total;
            } else if (pay_amount < total) {
                current_debt = total - pay_amount;
            }

            if (current_debt > 0) {
                const [customerRows] = await conn.execute('SELECT credit_limit FROM customers WHERE id = ?', [customer_id]);
                const creditLimit = customerRows[0]?.credit_limit || 0;
                
                const [debtRows] = await conn.execute("SELECT SUM(total - pay_amount) as existing_debt FROM sales WHERE customer_id = ? AND pay_amount < total AND status IN ('success', 'completed')", [customer_id]);
                const existingDebt = debtRows[0]?.existing_debt || 0;
                
                const remainingLimit = creditLimit - existingDebt;
                if (current_debt > remainingLimit) {
                    await conn.rollback();
                    return res.status(400).json({ message: `Transaksi melebihi sisa limit kredit pelanggan! Sisa limit: Rp ${remainingLimit}` });
                }
            }

            // Generate Invoice No: INV-YYYYMMDD-XXXX
            const dateObj = new Date(date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const datePrefix = `${year}${month}${day}`;

            const [countResult] = await conn.execute(
                "SELECT COUNT(*) as total FROM sales WHERE invoice_no LIKE ?",
                [`INV-${datePrefix}-%`]
            );
            const count = countResult[0].total;
            const invoiceNo = `INV-${datePrefix}-${(count + 1).toString().padStart(4, '0')}`;

            const [saleResult] = await conn.execute(
                `INSERT INTO sales (
                    invoice_no, date, customer_id, warehouse_id, subtotal, discount, shipping_cost, total, 
                    status, payment_method, pay_amount, change_amount, due_date,
                    alias, discount_package_id, shipping_method, courier_name, shipping_address, estimation_days, estimation_arrival,
                    total_weight, user_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    invoiceNo, date, customer_id, warehouse_id, subtotal, discount || 0, shipping_cost || 0, total,
                    status || 'process', payment_method || null, pay_amount || 0, change_amount || 0, due_date || null,
                    alias || null, discount_package_id || null, shipping_method || null, courier_name || null, shipping_address || null, estimation_days || null, estimation_arrival || null,
                    total_weight || 0, req.user.id
                ]
            );
            const saleId = saleResult.insertId;

            let totalCost = 0;
            for (const item of items) {
                await conn.execute(
                    `INSERT INTO sale_details (
                        sale_id, item_id, item_unit_id, qty, price, discount, subtotal
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        saleId, item.item_id, item.item_unit_id, item.qty, item.price, item.discount || 0, item.subtotal
                    ]
                );

                if (status === 'success' || status === 'completed') {
                    // Get item unit amount and cost
                    const [unitRows] = await conn.execute('SELECT amount, last_purchase_price FROM item_units WHERE id = ?', [item.item_unit_id]);
                    const amount = unitRows[0]?.amount || 1;
                    const cost = unitRows[0]?.last_purchase_price || 0;
                    totalCost += cost * item.qty;
                    
                    const requestedBaseQty = item.qty * amount;

                    // Get current stock to calculate before/after
                    const [stockRows] = await conn.execute(
                        'SELECT qty FROM stocks WHERE item_id = ? AND warehouse_id = ?',
                        [item.item_id, warehouse_id]
                    );
                    const qtyBefore = stockRows[0]?.qty || 0;
                    const qtyAfter = qtyBefore - requestedBaseQty;

                    // Deduct stock
                    await conn.execute(
                        'UPDATE stocks SET qty = qty - ? WHERE item_id = ? AND warehouse_id = ?',
                        [requestedBaseQty, item.item_id, warehouse_id]
                    );

                    // Insert stock history
                    await conn.execute(
                        `INSERT INTO stock_histories (
                            item_id, warehouse_id, reference_type, reference_id, qty_change, qty_before, qty_after, note, user_id, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                        [
                            item.item_id, warehouse_id, 'Sale', saleId, -requestedBaseQty, qtyBefore, qtyAfter, `Penjualan ${invoiceNo}`, req.user.id
                        ]
                    );
                }
            }

            // Insert Journal if status is success/completed
            if (status === 'success' || status === 'completed') {
                // Journal 1: Sales Revenue
                const [revAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '4-4101' OR name LIKE '%Pendapatan%' LIMIT 1`);
                const [cashAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1001' OR name LIKE '%Kas%' LIMIT 1`);
                const [bankAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1003' OR name LIKE '%Bank%' LIMIT 1`);
                const [piutangAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1101' OR name LIKE '%Piutang%' LIMIT 1`);

                const revAccId = revAcc[0]?.id || 5; 
                const cashAccId = cashAcc[0]?.id || 1; 
                const bankAccId = bankAcc[0]?.id || 6; 
                const piutangAccId = piutangAcc[0]?.id || 2; 

                const [journalResult] = await conn.execute(
                    `INSERT INTO journals (date, reference_no, description, source_type, source_id, user_id) VALUES (?, ?, ?, 'Sale', ?, ?)`,
                    [date, invoiceNo, `Penjualan #${invoiceNo}`, saleId, req.user.id]
                );
                const journalId = journalResult.insertId;

                // Credit Revenue
                await conn.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                    [journalId, revAccId, total]
                );

                // Debit Cash/Bank/AR
                if (payment_method === 'Credit') {
                    await conn.execute(
                        `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                        [journalId, piutangAccId, total]
                    );
                } else {
                    let paid = parseFloat(pay_amount) || 0;
                    if (paid > total) paid = total;
                    const remaining = total - paid;
                    
                    let paymentAccId = cashAccId;
                    if (payment_method === 'Transfer Bank') paymentAccId = bankAccId;
                    
                    if (paid > 0) {
                        await conn.execute(
                            `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                            [journalId, paymentAccId, paid]
                        );
                    }
                    
                    if (remaining > 0) {
                        await conn.execute(
                            `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                            [journalId, piutangAccId, remaining]
                        );
                    }
                }

                // Journal 2: COGS
                if (totalCost > 0) {
                    const [cogsAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '5-5101' OR name LIKE '%HPP%' LIMIT 1`);
                    const [invAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1201' OR name LIKE '%Persediaan%' LIMIT 1`);

                    const cogsAccId = cogsAcc[0]?.id || 7; 
                    const invAccId = invAcc[0]?.id || 4; 

                    const [cogsJournalResult] = await conn.execute(
                        `INSERT INTO journals (date, reference_no, description, source_type, source_id, user_id) VALUES (?, ?, ?, 'Sale', ?, ?)`,
                        [date, invoiceNo, `HPP Penjualan #${invoiceNo}`, saleId, req.user.id]
                    );
                    const cogsJournalId = cogsJournalResult.insertId;

                    // Debit COGS
                    await conn.execute(
                        `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                        [cogsJournalId, cogsAccId, totalCost]
                    );

                    // Credit Inventory
                    await conn.execute(
                        `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                        [cogsJournalId, invAccId, totalCost]
                    );
                }
            }

            await conn.commit();
            res.status(201).json({ message: 'Transaksi berhasil disimpan', id: saleId, invoice_no: invoiceNo });
        } catch (error) {
            await conn.rollback();
            logger.error('Error creating sale', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };

    checkStock = async (req, res) => {
        try {
            const { items, warehouse_id } = req.body;
            if (!items || !items.length) return res.status(400).json({ message: 'Items are required' });

            for (const item of items) {
                const [unitRows] = await db.execute('SELECT amount FROM item_units WHERE id = ?', [item.item_unit_id]);
                const amount = unitRows[0]?.amount || 1;
                const requestedBaseQty = item.qty * amount;

                const [stockRows] = await db.execute(
                    'SELECT qty FROM stocks WHERE item_id = ? AND warehouse_id = ?',
                    [item.item_id, warehouse_id || null]
                );
                
                const stock = stockRows[0] || { qty: 0 };
                const available = stock.qty;

                if (requestedBaseQty > available) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `Stok tidak cukup pada gudang ini untuk barang ID ${item.item_id}`,
                        item_id: item.item_id
                    });
                }
            }

            res.json({ success: true, message: 'Stok mencukupi' });
        } catch (error) {
            logger.error('Error checking stock', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getLastSellingPrice = async (req, res) => {
        try {
            const { item_id, item_unit_id, customer_category_id, customer_id } = req.query;
            
            if (!item_id || !item_unit_id || !customer_category_id) {
                return res.status(400).json({ message: 'Missing required parameters' });
            }
            
            let query = `
                SELECT sd.price, s.date, s.invoice_no
                FROM sale_details sd
                JOIN sales s ON sd.sale_id = s.id
                JOIN customers c ON s.customer_id = c.id
                WHERE sd.item_id = ? 
                  AND sd.item_unit_id = ? 
                  AND c.customer_category_id = ?
                  AND s.status IN ('success', 'completed')
            `;
            let params = [item_id, item_unit_id, customer_category_id];

            if (customer_id) {
                query += ` AND s.customer_id = ?`;
                params.push(customer_id);
            }

            query += `
                ORDER BY s.date DESC, s.id DESC
                LIMIT 1
            `;
            
            const [rows] = await db.execute(query, params);
            
            if (rows.length === 0) {
                return res.json({ price: null });
            }
            
            res.json(rows[0]);
        } catch (error) {
            logger.error('Error fetching last selling price', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    incrementPrintCount = async (req, res) => {
        try {
            const { id } = req.params;
            await db.execute('UPDATE sales SET print_count = print_count + 1 WHERE id = ?', [id]);
            const [rows] = await db.execute('SELECT print_count FROM sales WHERE id = ?', [id]);
            res.json({ success: true, print_count: rows[0]?.print_count || 0 });
        } catch (error) {
            logger.error('Error incrementing print count', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new SaleController();
