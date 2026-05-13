const BaseController = require('./BaseController');

const db = require('../config/db');
const logger = require('../config/logger');

class PermissionController extends BaseController {
    constructor() {
        super('permissions');
    }

    getAll = async (req, res) => {
        try {
            const [rows] = await db.execute(`SELECT * FROM permissions ORDER BY id ASC`);
            res.json(rows);
        } catch (error) {
            logger.error(`Error fetching permissions`, error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new PermissionController();
