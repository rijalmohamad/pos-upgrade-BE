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
            const modelSale = 'App\\Models\\Sale';

            const [details] = await db.execute(`
                SELECT 
                    s.invoice_no, 
                    s.date, 
                    s.due_date, 
                    (s.total - COALESCE(s.pay_amount, 0) - COALESCE(p.total_paid, 0)) AS remaining
                FROM sales s
                LEFT JOIN (
                    SELECT payable_id, SUM(amount) AS total_paid 
                    FROM payments 
                    WHERE payable_type = ? 
                    GROUP BY payable_id
                ) p ON p.payable_id = s.id
                WHERE s.customer_id = ? AND LOWER(s.status) = 'success'
                HAVING remaining > 0
            `, [modelSale, id]);

            const debt = details.reduce((sum, item) => sum + (parseFloat(item.remaining) || 0), 0);

            res.json({ success: true, debt, details });
        } catch (error) {
            logger.error('Error fetching customer debt', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new CustomerController();
