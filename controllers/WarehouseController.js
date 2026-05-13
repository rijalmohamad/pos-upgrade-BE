const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class WarehouseController extends BaseController {
    constructor() {
        super('warehouses');
    }

    getAll = async (req, res) => {
        try {
            const userId = req.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            // Check if user has restricted access
            const [accessRows] = await db.query('SELECT warehouse_id FROM user_warehouses WHERE user_id = ?', [userId]);
            
            if (accessRows.length === 0) {
                return res.json({
                    data: [],
                    total: 0,
                    current_page: page,
                    last_page: 1,
                    per_page: limit
                });
            }

            const allowedIds = accessRows.map(r => r.warehouse_id);
            
            let query = `SELECT * FROM warehouses WHERE id IN (${allowedIds.join(',')})`;
            let countQuery = `SELECT COUNT(*) as total FROM warehouses WHERE id IN (${allowedIds.join(',')})`;
            
            query += ` LIMIT ? OFFSET ?`;
            const params = [limit, offset];

            const [rows] = await db.query(query, params);
            const [totalRows] = await db.execute(countQuery);
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
            logger.error(`Error fetching warehouses`, error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getAllUnfiltered = async (req, res) => {
        try {
            const [rows] = await db.query('SELECT * FROM warehouses');
            res.json({ data: rows });
        } catch (error) {
            logger.error(`Error fetching all warehouses`, error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        try {
            const { name, code, address, phone, is_active, is_default } = req.body;
            if (!name || !code) {
                return res.status(400).json({ message: 'Name and code are required' });
            }

            // Check if code exists
            const [existing] = await db.execute('SELECT id FROM warehouses WHERE code = ?', [code]);
            if (existing.length > 0) {
                return res.status(400).json({ message: 'Warehouse code already exists' });
            }

            if (is_default === 1) {
                // Reset other defaults
                await db.execute('UPDATE warehouses SET is_default = 0');
            }

            const [result] = await db.execute(
                'INSERT INTO warehouses (name, code, address, phone, is_active, is_default) VALUES (?, ?, ?, ?, ?, ?)',
                [name, code, address, phone, is_active ?? 1, is_default ?? 0]
            );

            res.status(201).json({ id: result.insertId, name, code, address, phone, is_active, is_default });
        } catch (error) {
            logger.error('Error creating warehouse', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { name, code, address, phone, is_active, is_default } = req.body;
            if (!name || !code) {
                return res.status(400).json({ message: 'Name and code are required' });
            }

            // Check if code exists for other warehouse
            const [existing] = await db.execute('SELECT id FROM warehouses WHERE code = ? AND id != ?', [code, id]);
            if (existing.length > 0) {
                return res.status(400).json({ message: 'Warehouse code already exists' });
            }

            if (is_default === 1) {
                // Reset other defaults
                await db.execute('UPDATE warehouses SET is_default = 0');
            }

            await db.execute(
                'UPDATE warehouses SET name = ?, code = ?, address = ?, phone = ?, is_active = ?, is_default = ? WHERE id = ?',
                [name, code, address, phone, is_active, is_default, id]
            );

            res.json({ id, name, code, address, phone, is_active, is_default });
        } catch (error) {
            logger.error('Error updating warehouse', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new WarehouseController();
