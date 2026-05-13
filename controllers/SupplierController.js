const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class SupplierController extends BaseController {
    constructor() {
        super('suppliers');
    }

    create = async (req, res) => {
        try {
            const { name, phone, address, email, company } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [result] = await db.execute(
                'INSERT INTO suppliers (name, phone, address, email, company) VALUES (?, ?, ?, ?, ?)',
                [name, phone || null, address || null, email || null, company || null]
            );
            res.status(201).json({ id: result.insertId, name, phone, address, email, company });
        } catch (error) {
            logger.error('Error creating supplier', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { name, phone, address, email, company } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            await db.execute(
                'UPDATE suppliers SET name = ?, phone = ?, address = ?, email = ?, company = ? WHERE id = ?',
                [name, phone || null, address || null, email || null, company || null, id]
            );
            res.json({ id, name, phone, address, email, company });
        } catch (error) {
            logger.error('Error updating supplier', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new SupplierController();
