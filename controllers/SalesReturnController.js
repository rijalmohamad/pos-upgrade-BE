const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class SalesReturnController extends BaseController {
    constructor() {
        super('sales_returns');
    }

    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            let query = `
                SELECT sr.*, s.invoice_no as sale_invoice_no, u.name as user_name, app.name as approver_name
                FROM sales_returns sr
                LEFT JOIN sales s ON sr.sale_id = s.id
                LEFT JOIN users u ON sr.user_id = u.id
                LEFT JOIN users app ON sr.approved_by = app.id
                ORDER BY sr.id DESC
                LIMIT ? OFFSET ?
            `;

            const [rows] = await db.execute(query, [limit.toString(), offset.toString()]);

            const [totalRows] = await db.execute('SELECT COUNT(*) as total FROM sales_returns');
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
            logger.error('Error fetching sales returns', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getById = async (req, res) => {
        try {
            const { id } = req.params;

            const [rows] = await db.execute(`
                SELECT sr.*, s.invoice_no as sale_invoice_no, s.warehouse_id, u.name as user_name, app.name as approver_name
                FROM sales_returns sr
                LEFT JOIN sales s ON sr.sale_id = s.id
                LEFT JOIN users u ON sr.user_id = u.id
                LEFT JOIN users app ON sr.approved_by = app.id
                WHERE sr.id = ?
            `, [id]);

            if (rows.length === 0) {
                return res.status(404).json({ message: 'Not found' });
            }

            const salesReturn = rows[0];

            // Get details
            const [detailRows] = await db.execute(`
                SELECT srd.*, i.name as item_name, u.name as unit_name
                FROM sales_return_details srd
                LEFT JOIN items i ON srd.item_id = i.id
                LEFT JOIN item_units iu ON srd.item_unit_id = iu.id
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE srd.sales_return_id = ?
            `, [id]);

            // Format details to match frontend expectations
            salesReturn.details = detailRows.map(d => ({
                ...d,
                item: { name: d.item_name },
                unit: { unit: { name: d.unit_name } }
            }));

            res.json(salesReturn);
        } catch (error) {
            logger.error('Error fetching sales return by ID', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { sale_id, date, reason, items } = req.body;

            if (!sale_id || !items || items.length === 0) {
                return res.status(400).json({ message: 'Sale ID and items are required' });
            }

            // Generate Return No: RET-YYYYMMDD-XXXX
            const dateObj = new Date(date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const datePrefix = `${year}${month}${day}`;

            const [countResult] = await conn.execute(
                "SELECT COUNT(*) as total FROM sales_returns WHERE return_no LIKE ?",
                [`RET-${datePrefix}-%`]
            );
            const count = countResult[0].total;
            const returnNo = `RET-${datePrefix}-${(count + 1).toString().padStart(4, '0')}`;

            const totalAmount = items.reduce((acc, item) => acc + parseFloat(item.subtotal), 0);

            const [result] = await conn.execute(
                `INSERT INTO sales_returns (sale_id, return_no, date, status, total_amount, reason, user_id)
                 VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
                [sale_id, returnNo, date, totalAmount, reason, req.user.id]
            );
            const salesReturnId = result.insertId;

            for (const item of items) {
                await conn.execute(
                    `INSERT INTO sales_return_details (sales_return_id, item_id, item_unit_id, qty, price, subtotal)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [salesReturnId, item.item_id, item.item_unit_id, item.qty, item.price, item.subtotal]
                );
            }

            await conn.commit();
            res.status(201).json({ message: 'Pengajuan retur berhasil dibuat, menunggu persetujuan manajer', id: salesReturnId });
        } catch (error) {
            await conn.rollback();
            logger.error('Error creating sales return', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };

    approve = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { id } = req.params;

            const [returnRows] = await conn.execute(`
                SELECT sr.*, s.warehouse_id, s.invoice_no, s.payment_method
                FROM sales_returns sr
                LEFT JOIN sales s ON sr.sale_id = s.id
                WHERE sr.id = ?
            `, [id]);

            if (returnRows.length === 0) {
                return res.status(404).json({ message: 'Not found' });
            }

            const salesReturn = returnRows[0];

            if (salesReturn.status !== 'pending') {
                return res.status(400).json({ message: 'Hanya pengajuan pending yang dapat disetujui' });
            }

            // Get details
            const [details] = await conn.execute('SELECT * FROM sales_return_details WHERE sales_return_id = ?', [id]);

            let totalCost = 0;
            for (const detail of details) {
                const [unitRows] = await conn.execute('SELECT amount, last_purchase_price FROM item_units WHERE id = ?', [detail.item_unit_id]);
                const amount = unitRows[0]?.amount || 1;
                const cost = unitRows[0]?.last_purchase_price || 0;
                totalCost += cost * detail.qty;

                const baseQty = detail.qty * amount;

                // Increase stock
                await conn.execute(
                    'UPDATE stocks SET qty = qty + ? WHERE item_id = ? AND warehouse_id = ?',
                    [baseQty, detail.item_id, salesReturn.warehouse_id]
                );

                // Insert stock history
                await conn.execute(
                    `INSERT INTO stock_histories (
                        item_id, warehouse_id, type, qty, reference_no, description, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        detail.item_id, salesReturn.warehouse_id, 'in', baseQty, salesReturn.return_no, `Retur Penjualan #${salesReturn.return_no} (Inv: ${salesReturn.invoice_no})`
                    ]
                );
            }

            // Insert Journal
            const [revAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '4-4101' OR name LIKE '%Pendapatan%' LIMIT 1`);
            const [cashAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1001' OR name LIKE '%Kas%' LIMIT 1`);
            const [piutangAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1101' OR name LIKE '%Piutang%' LIMIT 1`);

            const revAccId = revAcc[0]?.id || 5; 
            const cashAccId = cashAcc[0]?.id || 1; 
            const piutangAccId = piutangAcc[0]?.id || 2; 

            const [journalResult] = await conn.execute(
                `INSERT INTO journals (date, reference_no, description, source_type, source_id, user_id) VALUES (?, ?, ?, 'Sales Return', ?, ?)`,
                [salesReturn.date, salesReturn.return_no, `Retur Penjualan #${salesReturn.return_no}`, id, req.user.id]
            );
            const journalId = journalResult.insertId;

            // Debit Revenue (Reduce Revenue)
            await conn.execute(
                `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                [journalId, revAccId, salesReturn.total_amount]
            );

            // Credit Cash or AR
            const creditAccId = salesReturn.payment_method === 'Cash' ? cashAccId : piutangAccId;
            await conn.execute(
                `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                [journalId, creditAccId, salesReturn.total_amount]
            );

            // Journal 2: Reverse COGS
            if (totalCost > 0) {
                const [cogsAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '5-5101' OR name LIKE '%HPP%' LIMIT 1`);
                const [invAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1201' OR name LIKE '%Persediaan%' LIMIT 1`);

                const cogsAccId = cogsAcc[0]?.id || 7; 
                const invAccId = invAcc[0]?.id || 4; 

                const [cogsJournalResult] = await conn.execute(
                    `INSERT INTO journals (date, reference_no, description, source_type, source_id, user_id) VALUES (?, ?, ?, 'Sales Return', ?, ?)`,
                    [salesReturn.date, salesReturn.return_no, `HPP Retur Penjualan #${salesReturn.return_no}`, id, req.user.id]
                );
                const cogsJournalId = cogsJournalResult.insertId;

                // Debit Inventory
                await conn.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                    [cogsJournalId, invAccId, totalCost]
                );

                // Credit COGS
                await conn.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                    [cogsJournalId, cogsAccId, totalCost]
                );
            }

            await conn.execute(
                'UPDATE sales_returns SET status = "approved", approved_by = ? WHERE id = ?',
                [req.user.id, id]
            );

            await conn.commit();
            res.json({ message: 'Retur berhasil disetujui dan stok telah diperbarui' });
        } catch (error) {
            await conn.rollback();
            logger.error('Error approving sales return', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };

    reject = async (req, res) => {
        try {
            const { id } = req.params;

            const [rows] = await db.execute('SELECT status FROM sales_returns WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).json({ message: 'Not found' });

            if (rows[0].status !== 'pending') {
                return res.status(400).json({ message: 'Hanya pengajuan pending yang dapat ditolak' });
            }

            await db.execute('UPDATE sales_returns SET status = "cancelled" WHERE id = ?', [id]);
            res.json({ message: 'Pengajuan retur telah dibatalkan/ditolak' });
        } catch (error) {
            logger.error('Error rejecting sales return', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    delete = async (req, res) => {
        try {
            const { id } = req.params;

            const [rows] = await db.execute('SELECT status FROM sales_returns WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).json({ message: 'Not found' });

            if (rows[0].status !== 'pending') {
                return res.status(400).json({ message: 'Hanya pengajuan pending yang dapat dihapus' });
            }

            await db.execute('DELETE FROM sales_returns WHERE id = ?', [id]);
            res.json({ message: 'Pengajuan retur berhasil dihapus' });
        } catch (error) {
            logger.error('Error deleting sales return', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new SalesReturnController();
