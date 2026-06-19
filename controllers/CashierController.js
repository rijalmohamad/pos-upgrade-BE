const db = require('../config/db');
const logger = require('../config/logger');

class CashierController {
    currentSession = async (req, res) => {
        try {
            const [rows] = await db.execute(
                `SELECT * FROM cashier_sessions WHERE user_id = ? AND status = 'open' LIMIT 1`,
                [req.user.id]
            );
            res.json(rows[0] || null);
        } catch (error) {
            logger.error('Error fetching current session', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    openSession = async (req, res) => {
        try {
            const { opening_balance } = req.body;
            if (opening_balance === undefined) {
                return res.status(400).json({ message: 'Opening balance is required' });
            }

            const [exists] = await db.execute(
                `SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open'`,
                [req.user.id]
            );
            if (exists.length > 0) {
                return res.status(422).json({ message: 'Sesi kasir sudah terbuka' });
            }

            const [result] = await db.execute(
                `INSERT INTO cashier_sessions (user_id, opening_balance, expected_cash, status, opened_at) 
                 VALUES (?, ?, ?, 'open', NOW())`,
                [req.user.id, opening_balance, opening_balance]
            );

            res.status(201).json({ id: result.insertId, user_id: req.user.id, opening_balance, expected_cash: opening_balance, status: 'open' });
        } catch (error) {
            logger.error('Error opening session', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    closeSession = async (req, res) => {
        try {
            const { actual_cash, settlement_by } = req.body;
            if (actual_cash === undefined) {
                return res.status(400).json({ message: 'Actual cash is required' });
            }

            const [session] = await db.execute(
                `SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' LIMIT 1`,
                [req.user.id]
            );
            if (session.length === 0) {
                return res.status(404).json({ message: 'No open session found' });
            }

            await db.execute(
                `UPDATE cashier_sessions 
                 SET actual_cash = ?, closing_balance = ?, settlement_by = ?, status = 'closed', closed_at = NOW() 
                 WHERE id = ?`,
                [actual_cash, actual_cash, settlement_by || 'Belum Diselesaikan', session[0].id]
            );

            res.json({ message: 'Sesi kasir berhasil ditutup' });
        } catch (error) {
            logger.error('Error closing session', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    deposit = async (req, res) => {
        try {
            const { amount, to_account_id, note } = req.body;
            if (!amount || !to_account_id) {
                return res.status(400).json({ message: 'Amount and to_account_id are required' });
            }

            const [session] = await db.execute(
                `SELECT id, expected_cash FROM cashier_sessions WHERE user_id = ? AND status = 'open' LIMIT 1`,
                [req.user.id]
            );
            if (session.length === 0) {
                return res.status(404).json({ message: 'No open session found' });
            }

            if (amount > session[0].expected_cash) {
                return res.status(422).json({ message: 'Jumlah setoran melebihi kas yang tersedia' });
            }

            const [cashAcc] = await db.execute(`SELECT id FROM accounts WHERE code = '1-1001' LIMIT 1`);
            if (cashAcc.length === 0) {
                return res.status(500).json({ message: 'Kas Kasir account (1-1001) not found' });
            }

            // Record Journal
            const [journalResult] = await db.execute(
                `INSERT INTO journals (date, description, source_type, user_id) VALUES (CURDATE(), ?, 'Transfer', ?)`,
                [note || `Setoran Kasir ${req.user.name}`, req.user.id]
            );
            const journalId = journalResult.insertId;

            // DR Target Account
            await db.execute(
                `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                [journalId, to_account_id, amount]
            );
            // CR Kas Kasir
            await db.execute(
                `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                [journalId, cashAcc[0].id, amount]
            );

            // Update Session
            await db.execute(
                `UPDATE cashier_sessions SET expected_cash = expected_cash - ? WHERE id = ?`,
                [amount, session[0].id]
            );

            res.json({ message: 'Setoran berhasil dicatat' });
        } catch (error) {
            logger.error('Error making deposit', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    storeCashTransaction = async (req, res) => {
        try {
            const { type, account_id, amount, note } = req.body;
            if (!type || !account_id || !amount) {
                return res.status(400).json({ message: 'Type, account_id and amount are required' });
            }

            const [session] = await db.execute(
                `SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' LIMIT 1`,
                [req.user.id]
            );

            const [cashAcc] = await db.execute(`SELECT id FROM accounts WHERE code = '1-1001' LIMIT 1`);
            if (cashAcc.length === 0) {
                return res.status(500).json({ message: 'Kas Kasir account (1-1001) not found' });
            }

            const [result] = await db.execute(
                `INSERT INTO cash_transactions (type, account_id, cash_account_id, amount, date, note, user_id, cashier_session_id) 
                 VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?)`,
                [type, account_id, cashAcc[0].id, amount, note, req.user.id, session.length > 0 ? session[0].id : null]
            );

            // Record Journal
            const [journalResult] = await db.execute(
                `INSERT INTO journals (date, description, source_type, source_id, user_id) VALUES (CURDATE(), ?, 'CashTransaction', ?, ?)`,
                [(type === 'in' ? 'Uang Masuk: ' : 'Uang Keluar: ') + note, result.insertId, req.user.id]
            );
            const journalId = journalResult.insertId;

            if (type === 'in') {
                // DR Kas Kasir, CR Target Account
                await db.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                    [journalId, cashAcc[0].id, amount]
                );
                await db.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                    [journalId, account_id, amount]
                );
            } else {
                // DR Target Account, CR Kas Kasir
                await db.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, ?, 0)`,
                    [journalId, account_id, amount]
                );
                await db.execute(
                    `INSERT INTO journal_items (journal_id, account_id, debit, credit) VALUES (?, ?, 0, ?)`,
                    [journalId, cashAcc[0].id, amount]
                );
            }

            // Update Session
            if (session.length > 0) {
                if (type === 'in') {
                    await db.execute(
                        `UPDATE cashier_sessions SET expected_cash = expected_cash + ? WHERE id = ?`,
                        [amount, session[0].id]
                    );
                } else {
                    await db.execute(
                        `UPDATE cashier_sessions SET expected_cash = expected_cash - ? WHERE id = ?`,
                        [amount, session[0].id]
                    );
                }
            }

            res.json({ message: 'Transaksi kas berhasil dicatat' });
        } catch (error) {
            logger.error('Error storing cash transaction', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getAccounts = async (req, res) => {
        try {
            const [rows] = await db.execute(`SELECT * FROM accounts ORDER BY code ASC`);
            res.json(rows);
        } catch (error) {
            logger.error('Error fetching accounts', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getHistory = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            const [rows] = await db.query(
                `SELECT cs.*, u.name as user_name 
                 FROM cashier_sessions cs
                 LEFT JOIN users u ON cs.user_id = u.id
                 WHERE cs.status = 'closed'
                 ORDER BY cs.closed_at DESC
                 LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            const [totalRows] = await db.execute(
                `SELECT COUNT(*) as total FROM cashier_sessions WHERE status = 'closed'`
            );

            res.json({
                data: rows,
                current_page: page,
                last_page: Math.ceil(totalRows[0].total / limit),
                total: totalRows[0].total
            });
        } catch (error) {
            logger.error('Error fetching cashier history', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    resolveSession = async (req, res) => {
        try {
            const { id } = req.params;
            const { settlement_by } = req.body;
            
            if (!settlement_by) {
                return res.status(400).json({ message: 'Settlement type is required' });
            }

            await db.execute(
                `UPDATE cashier_sessions SET settlement_by = ? WHERE id = ?`,
                [settlement_by, id]
            );

            res.json({ message: 'Penyelesaian berhasil diperbarui' });
        } catch (error) {
            logger.error('Error resolving session', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new CashierController();
