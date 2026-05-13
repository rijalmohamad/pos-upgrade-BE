const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');

class RoleController extends BaseController {
    constructor() {
        super('roles');
    }

    getAll = async (req, res) => {
        try {
            const [roles] = await db.execute(`SELECT * FROM roles ORDER BY id DESC`);
            
            for (const role of roles) {
                const [permissions] = await db.execute(
                    `SELECT p.id, p.name, p.slug FROM permissions p 
                     JOIN permission_role pr ON p.id = pr.permission_id 
                     WHERE pr.role_id = ?`,
                    [role.id]
                );
                role.permissions = permissions;
            }
            
            res.json(roles);
        } catch (error) {
            logger.error(`Error fetching roles`, error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    // Override getById to include permissions
    getById = async (req, res) => {
        try {
            const { id } = req.params;
            const [roles] = await db.execute(`SELECT * FROM roles WHERE id = ?`, [id]);
            
            if (roles.length === 0) {
                return res.status(404).json({ message: 'Not found' });
            }
            
            const role = roles[0];
            
            // Fetch permissions for this role
            const [permissions] = await db.execute(
                `SELECT p.id, p.name, p.slug FROM permissions p 
                 JOIN permission_role pr ON p.id = pr.permission_id 
                 WHERE pr.role_id = ?`,
                [id]
            );
            
            role.permissions = permissions;
            res.json(role);
        } catch (error) {
            logger.error(`Error fetching role by ID`, error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    create = async (req, res) => {
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            const { name, permission_ids, permissions } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [result] = await connection.execute('INSERT INTO roles (name) VALUES (?)', [name]);
            const roleId = result.insertId;

            const perms = permissions || permission_ids;
            if (perms && Array.isArray(perms)) {
                for (const permId of perms) {
                    await connection.execute('INSERT INTO permission_role (role_id, permission_id) VALUES (?, ?)', [roleId, permId]);
                }
            }

            await connection.commit();
            res.status(201).json({ id: roleId, name });
        } catch (error) {
            await connection.rollback();
            logger.error('Error creating role', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            connection.release();
        }
    };

    update = async (req, res) => {
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            const { id } = req.params;
            const { name, permission_ids, permissions } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            await connection.execute('UPDATE roles SET name = ? WHERE id = ?', [name, id]);

            const perms = permissions || permission_ids;
            if (perms && Array.isArray(perms)) {
                // Delete old mappings
                await connection.execute('DELETE FROM permission_role WHERE role_id = ?', [id]);
                // Insert new mappings
                for (const permId of perms) {
                    await connection.execute('INSERT INTO permission_role (role_id, permission_id) VALUES (?, ?)', [id, permId]);
                }
            }

            await connection.commit();
            res.json({ id, name });
        } catch (error) {
            await connection.rollback();
            logger.error('Error updating role', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            connection.release();
        }
    };

    delete = async (req, res) => {
        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            const { id } = req.params;
            // Delete mappings first
            await connection.execute('DELETE FROM permission_role WHERE role_id = ?', [id]);
            // Delete role
            await connection.execute('DELETE FROM roles WHERE id = ?', [id]);

            await connection.commit();
            res.json({ message: 'Deleted successfully' });
        } catch (error) {
            await connection.rollback();
            logger.error('Error deleting role', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            connection.release();
        }
    };
}

module.exports = new RoleController();
