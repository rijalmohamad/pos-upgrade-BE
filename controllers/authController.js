const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }

        const [users] = await db.execute(
            'SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.email = ?',
            [username]
        );

        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = users[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role_id: user.roles_id },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        // Fetch permissions for this role
        const [permissions] = await db.execute(`
            SELECT p.name 
            FROM permission_role pr
            JOIN permissions p ON pr.permission_id = p.id
            WHERE pr.role_id = ?
        `, [user.role_id]);

        const permissionList = permissions.map(p => p.name);

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.email,
                role_name: user.role_name,
                permissions: [...new Set(permissionList)] // Unique values
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
