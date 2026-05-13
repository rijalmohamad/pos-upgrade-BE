const db = require('../config/db');
const logger = require('../config/logger');

class StockTransferController {
    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const query = `
                SELECT st.*, fw.name as from_warehouse_name, tw.name as to_warehouse_name, u.name as user_name
                FROM stock_transfers st
                LEFT JOIN warehouses fw ON st.from_warehouse_id = fw.id
                LEFT JOIN warehouses tw ON st.to_warehouse_id = tw.id
                LEFT JOIN users u ON st.user_id = u.id
                ORDER BY st.id DESC
                LIMIT ? OFFSET ?
            `;
            const [rows] = await db.execute(query, [limit.toString(), offset.toString()]);

            const [countResult] = await db.execute('SELECT COUNT(*) as total FROM stock_transfers');
            const total = countResult[0].total;
            const lastPage = Math.ceil(total / limit);

            res.json({
                data: rows.map(r => ({
                    ...r,
                    from_warehouse: r.from_warehouse_id ? { name: r.from_warehouse_name } : null,
                    to_warehouse: r.to_warehouse_id ? { name: r.to_warehouse_name } : null,
                    user: r.user_id ? { name: r.user_name } : null
                })),
                total: total,
                current_page: page,
                last_page: lastPage,
                per_page: limit
            });
        } catch (error) {
            logger.error('Error fetching stock transfers', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getById = async (req, res) => {
        try {
            const { id } = req.params;
            
            const [rows] = await db.execute(`
                SELECT st.*, fw.name as from_warehouse_name, tw.name as to_warehouse_name, u.name as user_name
                FROM stock_transfers st
                LEFT JOIN warehouses fw ON st.from_warehouse_id = fw.id
                LEFT JOIN warehouses tw ON st.to_warehouse_id = tw.id
                LEFT JOIN users u ON st.user_id = u.id
                WHERE st.id = ?
            `, [id]);
            
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Not found' });
            }
            
            const transfer = rows[0];
            
            // Get details
            const [detailRows] = await db.execute(`
                SELECT std.*, i.name as item_name
                FROM stock_transfer_details std
                LEFT JOIN items i ON std.item_id = i.id
                WHERE std.stock_transfer_id = ?
            `, [id]);
            
            res.json({
                ...transfer,
                from_warehouse: transfer.from_warehouse_id ? { name: transfer.from_warehouse_name } : null,
                to_warehouse: transfer.to_warehouse_id ? { name: transfer.to_warehouse_name } : null,
                user: transfer.user_id ? { name: transfer.user_name } : null,
                details: detailRows.map(d => ({
                    ...d,
                    item: { name: d.item_name }
                }))
            });
        } catch (error) {
            logger.error('Error fetching stock transfer by ID', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { from_warehouse_id, to_warehouse_id, date, note, items } = req.body;

            if (!from_warehouse_id || !to_warehouse_id || !items || items.length === 0) {
                return res.status(400).json({ message: 'From, To warehouse and items are required' });
            }

            if (from_warehouse_id === to_warehouse_id) {
                return res.status(400).json({ message: 'Gudang asal dan tujuan tidak boleh sama' });
            }

            // Generate Transfer No: TRF-YYYYMMDD-XXXX
            const dateObj = new Date(date);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const datePrefix = `${year}${month}${day}`;

            const [countResult] = await conn.execute(
                "SELECT COUNT(*) as total FROM stock_transfers WHERE transfer_no LIKE ?",
                [`TRF-${datePrefix}-%`]
            );
            const count = countResult[0].total;
            const transferNo = `TRF-${datePrefix}-${(count + 1).toString().padStart(4, '0')}`;

            const [result] = await conn.execute(
                `INSERT INTO stock_transfers (
                    transfer_no, from_warehouse_id, to_warehouse_id, date, note, status, user_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    transferNo, from_warehouse_id, to_warehouse_id, date, note || null, 'completed', req.user.id
                ]
            );
            const transferId = result.insertId;

            for (const item of items) {
                const qty = parseFloat(item.qty);

                // Insert details
                await conn.execute(
                    `INSERT INTO stock_transfer_details (
                        stock_transfer_id, item_id, qty, created_at, updated_at
                    ) VALUES (?, ?, ?, NOW(), NOW())`,
                    [transferId, item.item_id, qty]
                );

                // Deduct from Source
                const [sourceStockRows] = await conn.execute(
                    'SELECT qty FROM stocks WHERE item_id = ? AND warehouse_id = ?',
                    [item.item_id, from_warehouse_id]
                );
                const sourceQtyBefore = sourceStockRows[0]?.qty || 0;
                const sourceQtyAfter = sourceQtyBefore - qty;

                if (sourceQtyBefore < qty) {
                    throw new Error(`Stok tidak mencukupi untuk item ID ${item.item_id} di gudang asal.`);
                }

                await conn.execute(
                    'UPDATE stocks SET qty = qty - ? WHERE item_id = ? AND warehouse_id = ?',
                    [qty, item.item_id, from_warehouse_id]
                );

                // Insert history for source
                await conn.execute(
                    `INSERT INTO stock_histories (
                        item_id, warehouse_id, reference_type, reference_id, qty_change, qty_before, qty_after, note, user_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        item.item_id, from_warehouse_id, 'Transfer Out', transferId, -qty, sourceQtyBefore, sourceQtyAfter, `Mutasi ke Gudang ID ${to_warehouse_id}`, req.user.id
                    ]
                );

                // Add to Destination
                const [destStockRows] = await conn.execute(
                    'SELECT qty FROM stocks WHERE item_id = ? AND warehouse_id = ?',
                    [item.item_id, to_warehouse_id]
                );
                const destQtyBefore = destStockRows[0]?.qty || 0;
                const destQtyAfter = destQtyBefore + qty;

                await conn.execute(
                    'INSERT INTO stocks (item_id, warehouse_id, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + ?',
                    [item.item_id, to_warehouse_id, qty, qty]
                );

                // Insert history for destination
                await conn.execute(
                    `INSERT INTO stock_histories (
                        item_id, warehouse_id, reference_type, reference_id, qty_change, qty_before, qty_after, note, user_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        item.item_id, to_warehouse_id, 'Transfer In', transferId, qty, destQtyBefore, destQtyAfter, `Mutasi dari Gudang ID ${from_warehouse_id}`, req.user.id
                    ]
                );
            }

            await conn.commit();
            res.status(201).json({ message: 'Mutasi stok berhasil disimpan', id: transferId, transfer_no: transferNo });
        } catch (error) {
            await conn.rollback();
            logger.error('Error creating stock transfer', error);
            res.status(500).json({ message: error.message || 'Internal server error' });
        } finally {
            conn.release();
        }
    };
}

module.exports = new StockTransferController();
