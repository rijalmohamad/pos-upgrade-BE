const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class CustomerController extends BaseController {
    constructor() {
        super('customers');
    }

    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const [rows] = await db.query(`
                SELECT c.*, cc.name as category_name, cc.priority as customer_category_priority
                FROM customers c
                LEFT JOIN customer_categories cc ON c.customer_category_id = cc.id
                LIMIT ? OFFSET ?
            `, [limit, offset]);

            const [totalRows] = await db.execute('SELECT COUNT(*) as total FROM customers');
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
            logger.error('Error fetching customers', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        try {
            const { customer_category_id, name, alias, is_default, phone, address, credit_limit, term_days } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [result] = await db.execute(
                'INSERT INTO customers (customer_category_id, name, alias, is_default, phone, address, credit_limit, term_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [customer_category_id || null, name, alias || null, is_default || 0, phone || null, address || null, credit_limit || 0, term_days || 0]
            );
            res.status(201).json({ id: result.insertId, name });
        } catch (error) {
            logger.error('Error creating customer', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { customer_category_id, name, alias, is_default, phone, address, credit_limit, term_days } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            await db.execute(
                'UPDATE customers SET customer_category_id = ?, name = ?, alias = ?, is_default = ?, phone = ?, address = ?, credit_limit = ?, term_days = ? WHERE id = ?',
                [customer_category_id || null, name, alias || null, is_default || 0, phone || null, address || null, credit_limit || 0, term_days || 0, id]
            );
            res.json({ id, name });
        } catch (error) {
            logger.error('Error updating customer', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getDebt = async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await db.execute(
                'SELECT SUM(total - pay_amount) as debt FROM sales WHERE customer_id = ? AND pay_amount < total',
                [id]
            );
            const debt = rows[0]?.debt || 0;

            const [details] = await db.execute(
                'SELECT invoice_no, date, due_date, (total - pay_amount) as remaining FROM sales WHERE customer_id = ? AND pay_amount < total',
                [id]
            );

            res.json({ success: true, debt, details });
        } catch (error) {
            logger.error('Error fetching customer debt', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new CustomerController();
