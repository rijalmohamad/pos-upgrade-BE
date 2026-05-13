const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class PurchaseReturnController extends BaseController {
    constructor() {
        super('purchase_returns');
    }

    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const query = `
                SELECT pr.*, p.purchase_no, s.name as supplier_name, u.name as user_name
                FROM purchase_returns pr
                LEFT JOIN purchases p ON pr.purchase_id = p.id
                LEFT JOIN suppliers s ON p.supplier_id = s.id
                LEFT JOIN users u ON pr.user_id = u.id
                ORDER BY pr.id DESC
                LIMIT ? OFFSET ?
            `;
            const [rows] = await db.execute(query, [limit.toString(), offset.toString()]);

            const [countResult] = await db.execute('SELECT COUNT(*) as total FROM purchase_returns');
            const total = countResult[0].total;
            const lastPage = Math.ceil(total / limit);

            res.json({
                data: rows,
                total: total,
                current_page: page,
                last_page: lastPage,
                per_page: limit
            });
        } catch (error) {
            logger.error('Error fetching purchase returns', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getById = async (req, res) => {
        try {
            const { id } = req.params;
            
            const [rows] = await db.execute(`
                SELECT pr.*, p.purchase_no, s.name as supplier_name, u.name as user_name
                FROM purchase_returns pr
                LEFT JOIN purchases p ON pr.purchase_id = p.id
                LEFT JOIN suppliers s ON p.supplier_id = s.id
                LEFT JOIN users u ON pr.user_id = u.id
                WHERE pr.id = ?
            `, [id]);
            
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Not found' });
            }
            
            const purchaseReturn = rows[0];
            
            // Get details
            const [detailRows] = await db.execute(`
                SELECT prd.*, i.name as item_name, u.name as unit_name
                FROM purchase_return_details prd
                LEFT JOIN items i ON prd.item_id = i.id
                LEFT JOIN item_units iu ON prd.item_unit_id = iu.id
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE prd.purchase_return_id = ?
            `, [id]);
            
            purchaseReturn.details = detailRows.map(d => ({
                ...d,
                item: { name: d.item_name },
                unit: { unit: { name: d.unit_name } }
            }));
            
            res.json(purchaseReturn);
        } catch (error) {
            logger.error('Error fetching purchase return by ID', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { purchase_id, date, note, items } = req.body;

            if (!purchase_id || !items || items.length === 0) {
                return res.status(400).json({ message: 'Purchase ID and items are required' });
            }

            // Generate Return No: PRB-YYYYMMDD-XXXX
            const dateObj = new Date(date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const datePrefix = `${year}${month}${day}`;

            const [countResult] = await conn.execute(
                "SELECT COUNT(*) as total FROM purchase_returns WHERE return_no LIKE ?",
                [`PRB-${datePrefix}-%`]
            );
            const count = countResult[0].total;
            const returnNo = `PRB-${datePrefix}-${(count + 1).toString().padStart(4, '0')}`;

            const total = items.reduce((acc, item) => acc + (item.qty * item.price), 0);

            const [result] = await conn.execute(
                `INSERT INTO purchase_returns (
                    return_no, purchase_id, date, total, note, user_id
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    returnNo, purchase_id, date, total, note || null, req.user.id
                ]
            );
            const returnId = result.insertId;

            // Get purchase warehouse and payment method
            const [purchaseRows] = await conn.execute('SELECT warehouse_id, payment_method FROM purchases WHERE id = ?', [purchase_id]);
            const warehouseId = purchaseRows[0]?.warehouse_id;
            const paymentMethod = purchaseRows[0]?.payment_method;

            for (const item of items) {
                const subtotal = item.qty * item.price;
                await conn.execute(
                    `INSERT INTO purchase_return_details (
                        purchase_return_id, purchase_detail_id, item_id, item_unit_id, qty, price, subtotal
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [returnId, item.purchase_detail_id, item.item_id, item.item_unit_id, item.qty, item.price, subtotal]
                );

                // Update Stock (Decrement)
                const [unitRows] = await conn.execute('SELECT amount FROM item_units WHERE id = ?', [item.item_unit_id]);
                const amount = unitRows[0]?.amount || 1;
                const baseQty = item.qty * amount;

                // Get current stock to calculate before/after
                const [stockRows] = await conn.execute(
                    'SELECT qty FROM stocks WHERE item_id = ? AND warehouse_id = ?',
                    [item.item_id, warehouseId]
                );
                const qtyBefore = stockRows[0]?.qty || 0;
                const qtyAfter = qtyBefore - baseQty;

                // Decrease stock
                await conn.execute(
                    'UPDATE stocks SET qty = qty - ? WHERE item_id = ? AND warehouse_id = ?',
                    [baseQty, item.item_id, warehouseId]
                );

                // Insert stock history
                await conn.execute(
                    `INSERT INTO stock_histories (
                        item_id, warehouse_id, reference_type, reference_id, qty_change, qty_before, qty_after, note, user_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        item.item_id, warehouseId, 'Purchase Return', returnId, -baseQty, qtyBefore, qtyAfter, `Retur Pembelian ${returnNo}`, req.user.id
                    ]
                );
            }

            // Insert Journal
            const [invAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1201' OR name LIKE '%Persediaan%' LIMIT 1`);
            const [cashAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '1-1001' OR name LIKE '%Kas%' LIMIT 1`);
            const [utangAcc] = await conn.execute(`SELECT id FROM accounts WHERE code = '2-2101' OR name LIKE '%Utang%' LIMIT 1`);

            const invAccId = invAcc[0]?.id || 4; 
            const cashAccId = cashAcc[0]?.id || 1; 
            const utangAccId = utangAcc[0]?.id || 3; 

            const [journalResult] = await conn.execute(
                `INSERT INTO journals (date, reference_no, description, source_type, source_id, user_id) VALUES (?, ?, ?, 'Purchase Return', ?, ?)`,
                [date, returnNo, `Retur Pembelian #${returnNo}`, returnId, req.user.id]
            );
            const journalId = journalResult.insertId;

            // Credit Inventory
            await conn.execute(
                `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                [journalId, invAccId, total]
            );

            // Debit Cash or AP
            const debitAccId = paymentMethod === 'Cash' ? cashAccId : utangAccId;
            await conn.execute(
                `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                [journalId, debitAccId, total]
            );

            await conn.commit();
            res.status(201).json({ message: 'Retur pembelian berhasil disimpan', id: returnId, return_no: returnNo });
        } catch (error) {
            await conn.rollback();
            logger.error('Error creating purchase return', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };
}

module.exports = new PurchaseReturnController();
