const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class DiscountPackageController extends BaseController {
    constructor() {
        super('discount_packages');
    }

    // Override getAll to include items
    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const [rows] = await db.execute(
                `SELECT * FROM discount_packages LIMIT ? OFFSET ?`,
                [limit.toString(), offset.toString()]
            );

            const [totalRows] = await db.execute(`SELECT COUNT(*) as total FROM discount_packages`);
            const total = totalRows[0].total;
            const lastPage = Math.ceil(total / limit);

            for (let pkg of rows) {
                const [items] = await db.execute(`
                    SELECT dpi.*, i.name as item_name, u.name as unit_name
                    FROM discount_package_items dpi 
                    LEFT JOIN items i ON dpi.item_id = i.id 
                    LEFT JOIN item_units iu ON dpi.item_unit_id = iu.id
                    LEFT JOIN units u ON iu.unit_id = u.id
                    WHERE dpi.discount_package_id = ?
                `, [pkg.id]);
                pkg.items = items;
            }

            res.json({
                data: rows,
                total: total,
                current_page: page,
                last_page: lastPage,
                per_page: limit
            });
        } catch (error) {
            logger.error('Error fetching discount packages', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getById = async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await db.execute(`SELECT * FROM discount_packages WHERE id = ?`, [id]);
            
            if (rows.length === 0) return res.status(404).json({ message: 'Not found' });

            const pkg = rows[0];
            const [items] = await db.execute(`
                SELECT dpi.*, i.name as item_name, u.name as unit_name
                FROM discount_package_items dpi 
                LEFT JOIN items i ON dpi.item_id = i.id 
                LEFT JOIN item_units iu ON dpi.item_unit_id = iu.id
                LEFT JOIN units u ON iu.unit_id = u.id
                WHERE dpi.discount_package_id = ?
            `, [id]);
            pkg.items = items;

            res.json(pkg);
        } catch (error) {
            logger.error('Error fetching discount package by ID', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { name, discount_amount, valid_until, is_all_items_required, is_active, items } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [pkgResult] = await conn.execute(
                'INSERT INTO discount_packages (name, discount_amount, valid_until, is_all_items_required, is_active) VALUES (?, ?, ?, ?, ?)',
                [name, discount_amount, valid_until || null, is_all_items_required !== undefined ? is_all_items_required : 1, is_active !== undefined ? is_active : 1]
            );
            const pkgId = pkgResult.insertId;

            if (items && Array.isArray(items)) {
                for (const item of items) {
                    await conn.execute(
                        'INSERT INTO discount_package_items (discount_package_id, item_id, min_qty, item_unit_id) VALUES (?, ?, ?, ?)',
                        [pkgId, item.item_id, item.min_qty, item.item_unit_id || null]
                    );
                }
            }

            await conn.commit();
            res.status(201).json({ message: 'Paket diskon berhasil dibuat', id: pkgId });
        } catch (error) {
            await conn.rollback();
            logger.error('Error creating discount package', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };

    update = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { id } = req.params;
            const { name, discount_amount, valid_until, is_all_items_required, is_active, items } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            await conn.execute(
                'UPDATE discount_packages SET name = ?, discount_amount = ?, valid_until = ?, is_all_items_required = ?, is_active = ? WHERE id = ?',
                [name, discount_amount, valid_until || null, is_all_items_required !== undefined ? is_all_items_required : 1, is_active !== undefined ? is_active : 1, id]
            );

            // Delete existing items and re-insert
            await conn.execute('DELETE FROM discount_package_items WHERE discount_package_id = ?', [id]);

            if (items && Array.isArray(items)) {
                for (const item of items) {
                    await conn.execute(
                        'INSERT INTO discount_package_items (discount_package_id, item_id, min_qty, item_unit_id) VALUES (?, ?, ?, ?)',
                        [id, item.item_id, item.min_qty, item.item_unit_id || null]
                    );
                }
            }

            await conn.commit();
            res.json({ message: 'Paket diskon berhasil diperbarui' });
        } catch (error) {
            await conn.rollback();
            logger.error('Error updating discount package', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };

    delete = async (req, res) => {
        const conn = await db.getConnection();
        await conn.beginTransaction();
        try {
            const { id } = req.params;
            
            // Delete items first (or rely on cascade if set, but let's be explicit)
            await conn.execute('DELETE FROM discount_package_items WHERE discount_package_id = ?', [id]);
            await conn.execute('DELETE FROM discount_packages WHERE id = ?', [id]);

            await conn.commit();
            res.json({ message: 'Paket diskon berhasil dihapus' });
        } catch (error) {
            await conn.rollback();
            logger.error('Error deleting discount package', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };

    check = async (req, res) => {
        try {
            const { cart } = req.body;
            if (!cart || !Array.isArray(cart)) return res.json([]);

            // Fetch all active packages with items
            const [packages] = await db.execute(`
                SELECT * FROM discount_packages 
                WHERE is_active = 1 AND (valid_until IS NULL OR valid_until >= CURDATE())
            `);

            for (let pkg of packages) {
                const [items] = await db.execute(`
                    SELECT dpi.*, iu.amount as unit_amount
                    FROM discount_package_items dpi
                    LEFT JOIN item_units iu ON dpi.item_unit_id = iu.id
                    WHERE dpi.discount_package_id = ?
                `, [pkg.id]);
                pkg.items = items;
            }

            const availablePackages = [];

            for (const pkg of packages) {
                let satisfied = false;
                if (pkg.is_all_items_required === 1) {
                    satisfied = pkg.items.every(pkgItem => {
                        const cartItem = cart.find(c => c.item_id === pkgItem.item_id);
                        return cartItem && cartItem.qty >= pkgItem.min_qty;
                    });
                } else {
                    satisfied = pkg.items.some(pkgItem => {
                        const cartItem = cart.find(c => c.item_id === pkgItem.item_id);
                        return cartItem && cartItem.qty >= pkgItem.min_qty;
                    });
                }

                if (satisfied) {
                    availablePackages.push(pkg);
                }
            }

            res.json(availablePackages);
        } catch (error) {
            logger.error('Error checking discount packages', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new DiscountPackageController();
