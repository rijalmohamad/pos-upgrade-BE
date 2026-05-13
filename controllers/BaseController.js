const db = require('../config/db');
const logger = require('../config/logger');

class BaseController {
    constructor(tableName) {
        this.tableName = tableName;
    }

    // Standard CRUD - Get All with Server-side Pagination
    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            // Get data with limit
            const [rows] = await db.query(
                `SELECT * FROM ${this.tableName} LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            // Get total count
            const [totalRows] = await db.execute(`SELECT COUNT(*) as total FROM ${this.tableName}`);
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
            logger.error(`Error fetching all from ${this.tableName}`, error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    // Standard CRUD - Get By ID
    getById = async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await db.execute(`SELECT * FROM ${this.tableName} WHERE id = ?`, [id]);
            
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Not found' });
            }
            res.json(rows[0]);
        } catch (error) {
            logger.error(`Error fetching by ID from ${this.tableName}`, error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    // Standard CRUD - Delete
    delete = async (req, res) => {
        try {
            const { id } = req.params;
            await db.execute(`DELETE FROM ${this.tableName} WHERE id = ?`, [id]);
            res.json({ message: 'Deleted successfully' });
        } catch (error) {
            logger.error(`Error deleting from ${this.tableName}`, error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
    
    // Abstract method placeholder for specialized creates/updates
    // because usually they need specific column names or encryption
}

module.exports = BaseController;
