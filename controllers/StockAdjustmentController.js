const db = require('../config/db');
const logger = require('../config/logger');

class StockAdjustmentController {
    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const query = `
                SELECT sa.*, i.name as item_name, i.code as item_code, w.name as warehouse_name, u.name as user_name
                FROM stock_adjustments sa
                LEFT JOIN items i ON sa.item_id = i.id
                LEFT JOIN warehouses w ON sa.warehouse_id = w.id
                LEFT JOIN users u ON sa.user_id = u.id
                ORDER BY sa.id DESC
                LIMIT ? OFFSET ?
            `;
            const [rows] = await db.execute(query, [limit.toString(), offset.toString()]);

            const [countResult] = await db.execute('SELECT COUNT(*) as total FROM stock_adjustments');
            const total = countResult[0].total;
            const lastPage = Math.ceil(total / limit);

            res.json({
                data: rows.map(r => ({
                    ...r,
                    item: { name: r.item_name, code: r.item_code },
                    warehouse: r.warehouse_id ? { name: r.warehouse_name } : null,
                    user: r.user_id ? { name: r.user_name } : null
                })),
                total: total,
                current_page: page,
                last_page: lastPage,
                per_page: limit
            });
        } catch (error) {
            logger.error('Error fetching stock adjustments', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { item_id, warehouse_id, type, qty, note } = req.body;

            if (!item_id || !warehouse_id || !type || !qty) {
                return res.status(400).json({ message: 'Item, warehouse, type and qty are required' });
            }

            const qtyChange = type === 'PLUS' ? parseInt(qty) : -parseInt(qty);

            const [result] = await conn.execute(
                `INSERT INTO stock_adjustments (
                    item_id, warehouse_id, qty_change, type, note, user_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    item_id, warehouse_id, qtyChange, type, note || null, req.user.id
                ]
            );
            const adjustmentId = result.insertId;

            // Get current stock to calculate before/after
            const [stockRows] = await conn.execute(
                'SELECT qty FROM stocks WHERE item_id = ? AND warehouse_id = ?',
                [item_id, warehouse_id]
            );
            const qtyBefore = stockRows[0]?.qty || 0;
            const qtyAfter = qtyBefore + qtyChange;

            // Update Stock
            await conn.execute(
                'INSERT INTO stocks (item_id, warehouse_id, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + ?',
                [item_id, warehouse_id, qtyChange, qtyChange]
            );

            // Insert stock history
            await conn.execute(
                `INSERT INTO stock_histories (
                    item_id, warehouse_id, reference_type, reference_id, qty_change, qty_before, qty_after, note, user_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    item_id, warehouse_id, 'Adjustment', adjustmentId, qtyChange, qtyBefore, qtyAfter, note || `Adjustment ${type}`, req.user.id
                ]
            );

            await conn.commit();
            res.status(201).json({ message: 'Penyesuaian stok berhasil disimpan', id: adjustmentId });
        } catch (error) {
            await conn.rollback();
            logger.error('Error creating stock adjustment', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };
}

module.exports = new StockAdjustmentController();
