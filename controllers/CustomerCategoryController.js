const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class CustomerCategoryController extends BaseController {
    constructor() {
        super('customer_categories');
    }

    create = async (req, res) => {
        try {
            const { name } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [existing] = await db.execute('SELECT id FROM customer_categories WHERE name = ?', [name]);
            if (existing.length > 0) return res.status(400).json({ message: 'Category already exists' });

            const [result] = await db.execute('INSERT INTO customer_categories (name) VALUES (?)', [name]);
            res.status(201).json({ id: result.insertId, name });
        } catch (error) {
            logger.error('Error creating customer category', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { name } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [existing] = await db.execute('SELECT id FROM customer_categories WHERE name = ? AND id != ?', [name, id]);
            if (existing.length > 0) return res.status(400).json({ message: 'Category already exists' });

            await db.execute('UPDATE customer_categories SET name = ? WHERE id = ?', [name, id]);
            res.json({ id, name });
        } catch (error) {
            logger.error('Error updating customer category', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new CustomerCategoryController();
