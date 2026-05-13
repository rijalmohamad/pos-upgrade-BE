const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');
const bcrypt = require('bcryptjs');

class UserController extends BaseController {
    constructor() {
        super('users');
    }

    // Override getAll to include role name
    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const [rows] = await db.query(
                `SELECT u.id, u.name, u.email, u.role_id, r.name as role_name, u.created_at 
                 FROM users u 
                 LEFT JOIN roles r ON u.role_id = r.id 
                 LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            const [countResult] = await db.query('SELECT COUNT(*) as total FROM users');
            const total = countResult[0].total;

            res.json({
                data: rows.map(r => ({
                    ...r,
                    role: r.role_id ? { name: r.role_name } : null
                })),
                current_page: page,
                last_page: Math.ceil(total / limit),
                total: total
            });
        } catch (error) {
            logger.error('Error fetching users', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        try {
            const { name, email, password, role_id } = req.body;
            if (!name || !email || !password) {
                return res.status(400).json({ message: 'Name, email and password are required' });
            }

            const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
            if (existing.length > 0) {
                return res.status(400).json({ message: 'Email already registered' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            const [result] = await db.execute(
                'INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, ?)',
                [name, email, hashedPassword, role_id]
            );

            res.status(201).json({ id: result.insertId, name, email, role_id });
        } catch (error) {
            logger.error('Error creating user', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { name, email, password, role_id } = req.body;
            if (!name || !email) {
                return res.status(400).json({ message: 'Name and email are required' });
            }

            const [existing] = await db.execute('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
            if (existing.length > 0) {
                return res.status(400).json({ message: 'Email already registered' });
            }

            let query = 'UPDATE users SET name = ?, email = ?, role_id = ?';
            let params = [name, email, role_id];

            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                query += ', password = ?';
                params.push(hashedPassword);
            }

            query += ' WHERE id = ?';
            params.push(id);

            await db.execute(query, params);
            res.json({ id, name, email, role_id });
        } catch (error) {
            logger.error('Error updating user', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getWarehouses = async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await db.query('SELECT warehouse_id FROM user_warehouses WHERE user_id = ?', [id]);
            const warehouseIds = rows.map(r => r.warehouse_id);
            res.json(warehouseIds);
        } catch (error) {
            logger.error('Error fetching user warehouses', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    updateWarehouses = async (req, res) => {
        const { id } = req.params;
        const { warehouse_ids } = req.body;

        if (!Array.isArray(warehouse_ids)) {
            return res.status(400).json({ message: 'warehouse_ids must be an array' });
        }

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute('DELETE FROM user_warehouses WHERE user_id = ?', [id]);

            if (warehouse_ids.length > 0) {
                const values = warehouse_ids.map(wId => [id, wId]);
                await conn.query('INSERT INTO user_warehouses (user_id, warehouse_id) VALUES ?', [values]);
            }

            await conn.commit();

            res.json({ message: 'Warehouse access updated successfully' });
        } catch (error) {
            await conn.rollback();
            logger.error('Error updating user warehouses', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };
}

module.exports = new UserController();
