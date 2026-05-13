const db = require('../config/db');
const logger = require('../config/logger');

class CompanyController {
    get = async (req, res) => {
        try {
            const [rows] = await db.execute('SELECT * FROM company_profiles LIMIT 1');
            if (rows.length === 0) {
                return res.json({});
            }
            res.json(rows[0]);
        } catch (error) {
            logger.error('Error fetching company profile', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    update = async (req, res) => {
        try {
            const { name, address, city, phone, email, receipt_notes } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [rows] = await db.execute('SELECT id FROM company_profiles LIMIT 1');

            if (rows.length === 0) {
                // Create
                const [result] = await db.execute(
                    'INSERT INTO company_profiles (name, address, city, phone, email, receipt_notes) VALUES (?, ?, ?, ?, ?, ?)',
                    [name, address, city, phone, email, receipt_notes]
                );
                res.status(201).json({ id: result.insertId, name, address, city, phone, email, receipt_notes });
            } else {
                // Update
                const id = rows[0].id;
                await db.execute(
                    'UPDATE company_profiles SET name = ?, address = ?, city = ?, phone = ?, email = ?, receipt_notes = ? WHERE id = ?',
                    [name, address, city, phone, email, receipt_notes, id]
                );
                res.json({ id, name, address, city, phone, email, receipt_notes });
            }
        } catch (error) {
            logger.error('Error updating company profile', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new CompanyController();
