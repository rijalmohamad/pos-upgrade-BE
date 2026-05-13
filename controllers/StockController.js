const db = require('../config/db');
const logger = require('../config/logger');

class StockController {
    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';
            const warehouseId = req.query.warehouse_id || null;

            let query = `
                SELECT i.*, c.name as category_name
                FROM items i
                LEFT JOIN item_categories c ON i.item_category_id = c.id
                WHERE 1=1
            `;
            const params = [];

            if (search) {
                query += ` AND (i.name LIKE ? OR i.code LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`);
            }

            query += ` ORDER BY i.id DESC LIMIT ? OFFSET ?`;
            params.push(limit.toString(), offset.toString());

            const [items] = await db.execute(query, params);

            if (items.length === 0) {
                return res.json({
                    data: [],
                    total: 0,
                    current_page: page,
                    last_page: 1,
                    per_page: limit
                });
            }

            const itemIds = items.map(i => i.id);
            const placeholders = itemIds.map(() => '?').join(',');

            // Fetch stock for these items
            let stockQuery = `
                SELECT item_id, warehouse_id, qty
                FROM stocks
                WHERE item_id IN (${placeholders})
            `;
            const stockParams = [...itemIds];
            if (warehouseId) {
                stockQuery += ` AND warehouse_id = ?`;
                stockParams.push(warehouseId);
            }
            const [stocks] = await db.execute(stockQuery, stockParams);

            // Fetch booking qty for these items
            let bookingQuery = `
                SELECT sd.item_id, SUM(sd.qty * iu.amount) as booking_qty
                FROM sale_details sd
                JOIN sales s ON sd.sale_id = s.id
                JOIN item_units iu ON sd.item_unit_id = iu.id
                WHERE sd.item_id IN (${placeholders}) AND s.status = 'booking'
            `;
            const bookingParams = [...itemIds];
            if (warehouseId) {
                bookingQuery += ` AND s.warehouse_id = ?`;
                bookingParams.push(warehouseId);
            }
            bookingQuery += ` GROUP BY sd.item_id`;
            const [bookings] = await db.execute(bookingQuery, bookingParams);

            // Fetch item units for these items
            const [units] = await db.execute(`
                SELECT iu.*, u.name as unit_name
                FROM item_units iu
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE iu.item_id IN (${placeholders})
            `, itemIds);

            // Map everything together
            const data = items.map(item => {
                const itemStocks = stocks.filter(s => s.item_id === item.id);
                const itemBookings = bookings.find(b => b.item_id === item.id);
                const itemUnits = units.filter(u => u.item_id === item.id);

                let available_qty = 0;
                if (warehouseId) {
                    const ws = itemStocks.find(s => s.warehouse_id == warehouseId);
                    available_qty = ws ? parseFloat(ws.qty) : 0;
                } else {
                    available_qty = itemStocks.reduce((acc, s) => acc + parseFloat(s.qty), 0);
                }

                const booking_qty = itemBookings ? parseFloat(itemBookings.booking_qty) : 0;
                const physical_stock = available_qty + booking_qty;

                return {
                    ...item,
                    category: item.item_category_id ? { name: item.category_name } : null,
                    physical_stock,
                    booking_qty,
                    available_qty,
                    item_units: itemUnits.map(u => ({
                        id: u.id,
                        amount: u.amount,
                        unit: { name: u.unit_name }
                    }))
                };
            });

            // Get total count
            let countQuery = `SELECT COUNT(*) as total FROM items WHERE 1=1`;
            const countParams = [];
            if (search) {
                countQuery += ` AND (name LIKE ? OR code LIKE ?)`;
                countParams.push(`%${search}%`, `%${search}%`);
            }
            const [countResult] = await db.execute(countQuery, countParams);
            const total = countResult[0].total;
            const lastPage = Math.ceil(total / limit);

            res.json({
                data: data,
                total: total,
                current_page: page,
                last_page: lastPage,
                per_page: limit
            });
        } catch (error) {
            logger.error('Error fetching stock report', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getHistory = async (req, res) => {
        try {
            const { id } = req.params;
            const warehouseId = req.query.warehouse_id || null;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            const [itemRows] = await db.execute('SELECT * FROM items WHERE id = ?', [id]);
            if (itemRows.length === 0) {
                return res.status(404).json({ message: 'Item not found' });
            }

            let query = `
                SELECT sh.*, u.name as user_name, w.name as warehouse_name
                FROM stock_histories sh
                LEFT JOIN users u ON sh.user_id = u.id
                LEFT JOIN warehouses w ON sh.warehouse_id = w.id
                WHERE sh.item_id = ?
            `;
            const params = [id];

            if (warehouseId) {
                query += ` AND sh.warehouse_id = ?`;
                params.push(warehouseId);
            }

            query += ` ORDER BY sh.id DESC LIMIT ? OFFSET ?`;
            params.push(limit.toString(), offset.toString());

            const [rows] = await db.execute(query, params);

            let countQuery = `SELECT COUNT(*) as total FROM stock_histories WHERE item_id = ?`;
            const countParams = [id];
            if (warehouseId) {
                countQuery += ` AND warehouse_id = ?`;
                countParams.push(warehouseId);
            }
            const [countResult] = await db.execute(countQuery, countParams);
            const total = countResult[0].total;

            res.json({
                item: itemRows[0],
                history: {
                    data: rows.map(r => ({
                        ...r,
                        user: r.user_id ? { name: r.user_name } : null,
                        warehouse: r.warehouse_id ? { name: r.warehouse_name } : null
                    })),
                    total: total,
                    current_page: page,
                    last_page: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            logger.error('Error fetching stock history', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new StockController();
