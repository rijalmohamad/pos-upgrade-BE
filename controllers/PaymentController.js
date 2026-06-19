const db = require('../config/db');
const logger = require('../config/logger');

class PaymentController {
    getUnpaid = async (req, res) => {
        try {
            const { type } = req.query;

            if (type === 'sale') {
                const statusSuccess = 'success';
                const modelSale = 'App\\Models\\Sale'; 

                const [sales] = await db.execute(`
                    SELECT 
                        s.id, 
                        s.invoice_no, 
                        s.date, 
                        s.total, 
                        c.name AS customer_name,
                        (COALESCE(s.pay_amount, 0) + COALESCE(p.total_paid, 0)) AS paid_amount,
                        (s.total - COALESCE(s.pay_amount, 0) - COALESCE(p.total_paid, 0)) AS remaining_amount
                    FROM sales s
                    LEFT JOIN customers c ON s.customer_id = c.id
                    LEFT JOIN (
                        SELECT payable_id, SUM(amount) AS total_paid 
                        FROM payments 
                        WHERE payable_type = ? 
                        GROUP BY payable_id
                    ) p ON p.payable_id = s.id
                    WHERE LOWER(s.status) = LOWER(?) 
                    HAVING remaining_amount > 0
                `, [modelSale, statusSuccess]);

                
                const mapped = sales.map(s => ({
                    id: s.id,
                    invoice_no: s.invoice_no,
                    date: s.date,
                    total: s.total,
                    paid_amount: s.paid_amount,
                    remaining_amount: s.remaining_amount,
                    customer: { name: s.customer_name }
                }));

                res.json(mapped);
            } else if (type === 'purchase') {
                const modelPurchase = 'App\\Models\\Purchase';

                const [purchases] = await db.execute(`
                    SELECT 
                        p.id, 
                        p.purchase_no, 
                        p.date, 
                        p.total, 
                        sup.name as supplier_name,
                        (COALESCE(p.pay_amount, 0) + COALESCE(pay.total_paid, 0)) AS paid_amount,
                        (p.total - COALESCE(p.pay_amount, 0) - COALESCE(pay.total_paid, 0)) AS remaining_amount
                    FROM purchases p
                    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
                    LEFT JOIN (
                        SELECT payable_id, SUM(amount) AS total_paid
                        FROM payments
                        WHERE payable_type = ?
                        GROUP BY payable_id
                    ) pay ON pay.payable_id = p.id
                    HAVING remaining_amount > 0
                `, [modelPurchase]);

                const mapped = purchases.map(p => ({
                    id: p.id,
                    purchase_no: p.purchase_no,
                    date: p.date,
                    total: p.total,
                    paid_amount: p.paid_amount,
                    remaining_amount: p.remaining_amount,
                    supplier: { name: p.supplier_name }
                }));

                res.json(mapped);
            } else {
                res.status(400).json({ message: 'Invalid type' });
            }
        } catch (error) {
            logger.error('Error fetching unpaid payments', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    store = async (req, res) => {
        try {
            const { payable_type, payable_id, amount, payment_method, note } = req.body;

            if (!payable_type || !payable_id || !amount || !payment_method) {
                return res.status(400).json({ message: 'Payable type, ID, amount and method are required' });
            }

            let remaining = 0;
            if (payable_type === 'sale') {
                const [sales] = await db.execute(`
                    SELECT (s.total - COALESCE((SELECT SUM(amount) FROM payments WHERE payable_type = 'App\\\\Models\\\\Sale' AND payable_id = s.id), 0)) as remaining
                    FROM sales s WHERE s.id = ?
                `, [payable_id]);
                if (sales.length === 0) return res.status(404).json({ message: 'Sale not found' });
                remaining = sales[0].remaining;
            } else {
                const [purchases] = await db.execute(`
                    SELECT (p.total - COALESCE(p.pay_amount, 0) - COALESCE((SELECT SUM(amount) FROM payments WHERE payable_type = 'App\\\\Models\\\\Purchase' AND payable_id = p.id), 0)) as remaining
                    FROM purchases p WHERE p.id = ?
                `, [payable_id]);
                if (purchases.length === 0) return res.status(404).json({ message: 'Purchase not found' });
                remaining = purchases[0].remaining;
            }

            if (amount > remaining) {
                return res.status(422).json({ message: 'Jumlah bayar melebihi sisa tagihan' });
            }

            const [cashAcc] = await db.execute(`SELECT id FROM accounts WHERE code = '1-1001' LIMIT 1`);
            const [bankAcc] = await db.execute(`SELECT id FROM accounts WHERE code = '1-1003' OR name LIKE '%Bank%' LIMIT 1`);
            const [piutangAcc] = await db.execute(`SELECT id FROM accounts WHERE code = '1-1101' LIMIT 1`);
            const [utangAcc] = await db.execute(`SELECT id FROM accounts WHERE code = '2-2101' LIMIT 1`);

            let sourceAccId = payment_method === 'Cash' ? cashAcc[0]?.id : bankAcc[0]?.id;
            if (!sourceAccId) sourceAccId = cashAcc[0]?.id; // Fallback to cash

            if (!sourceAccId) {
                return res.status(500).json({ message: 'Account for payment method not found' });
            }

            const connection = await db.getConnection();
            await connection.beginTransaction();

            try {
                const [payResult] = await connection.execute(
                    `INSERT INTO payments (payable_type, payable_id, amount, payment_method, date, note, user_id, account_id) 
                     VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?)`,
                    [payable_type === 'sale' ? 'App\\Models\\Sale' : 'App\\Models\\Purchase', payable_id, amount, payment_method, note, req.user.id, sourceAccId]
                );

                const [journalResult] = await connection.execute(
                    `INSERT INTO journals (date, description, source_type, source_id, user_id) VALUES (CURDATE(), ?, 'Payment', ?, ?)`,
                    [note || `Pelunasan ${payable_type === 'sale' ? 'Piutang' : 'Utang'}`, payResult.insertId, req.user.id]
                );
                const journalId = journalResult.insertId;

                if (payable_type === 'sale') {
                    await connection.execute(
                        `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                        [journalId, sourceAccId, amount]
                    );
                    await connection.execute(
                        `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                        [journalId, piutangAcc[0]?.id || 2, amount]
                    );
                } else {
                    await connection.execute(
                        `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                        [journalId, utangAcc[0]?.id || 3, amount]
                    );
                    await connection.execute(
                        `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                        [journalId, sourceAccId, amount]
                    );
                }

                await connection.commit();
                connection.release();

                res.status(201).json({ payment_id: payResult.insertId });
            } catch (error) {
                await connection.rollback();
                connection.release();
                throw error;
            }
        } catch (error) {
            logger.error('Error storing payment', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getHistory = async (req, res) => {
        try {
            const { page = 1, payable_type, start_date, end_date, ref_no, name } = req.query;
            const limit = 10;
            const offset = (parseInt(page) - 1) * limit;

            let joinClause = `LEFT JOIN users u ON p.user_id = u.id `;
            if (ref_no || name) {
                joinClause += `
                    LEFT JOIN sales s ON p.payable_type = 'App\\\\Models\\\\Sale' AND p.payable_id = s.id
                    LEFT JOIN purchases pur ON p.payable_type = 'App\\\\Models\\\\Purchase' AND p.payable_id = pur.id
                `;
            }
            if (name) {
                joinClause += `
                    LEFT JOIN customers c ON s.customer_id = c.id
                    LEFT JOIN suppliers sup ON pur.supplier_id = sup.id
                `;
            }

            let whereClause = `WHERE 1=1 `;
            const params = [];

            if (payable_type) {
                whereClause += ` AND p.payable_type = ?`;
                params.push(payable_type === 'sale' ? 'App\\Models\\Sale' : 'App\\Models\\Purchase');
            }

            if (start_date) {
                whereClause += ` AND p.date >= ?`;
                params.push(start_date);
            }

            if (end_date) {
                whereClause += ` AND p.date <= ?`;
                params.push(end_date);
            }

            if (ref_no) {
                whereClause += ` AND (s.invoice_no LIKE ? OR pur.purchase_no LIKE ?)`;
                params.push(`%${ref_no}%`, `%${ref_no}%`);
            }

            if (name) {
                whereClause += ` AND (c.name LIKE ? OR sup.name LIKE ?)`;
                params.push(`%${name}%`, `%${name}%`);
            }

            let query = `SELECT p.*, u.name as user_name FROM payments p ` + joinClause + whereClause;

            const [rows] = await db.execute(query + ` ORDER BY p.date DESC, p.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
            
            let countQuery = `SELECT COUNT(*) as count FROM payments p ` + joinClause + whereClause;
            const [totalRows] = await db.execute(countQuery, params);

            for (const row of rows) {
                if (row.payable_type === 'App\\Models\\Sale') {
                    const [sales] = await db.execute(`
                        SELECT s.invoice_no, c.name as customer_name 
                        FROM sales s 
                        LEFT JOIN customers c ON s.customer_id = c.id 
                        WHERE s.id = ?
                    `, [row.payable_id]);
                    if (sales.length > 0) {
                        row.payable = { invoice_no: sales[0].invoice_no, customer: { name: sales[0].customer_name } };
                    }
                } else {
                    const [purchases] = await db.execute(`
                        SELECT p.purchase_no, sup.name as supplier_name 
                        FROM purchases p 
                        LEFT JOIN suppliers sup ON p.supplier_id = sup.id 
                        WHERE p.id = ?
                    `, [row.payable_id]);
                    if (purchases.length > 0) {
                        row.payable = { purchase_no: purchases[0].purchase_no, supplier: { name: purchases[0].supplier_name } };
                    }
                }
                row.user = { name: row.user_name };
            }

            res.json({
                data: rows,
                current_page: parseInt(page),
                last_page: Math.ceil(totalRows[0].count / limit),
                total: totalRows[0].count
            });
        } catch (error) {
            logger.error('Error fetching payment history', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new PaymentController();
