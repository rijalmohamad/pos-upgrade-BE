const db = require('../config/db');
const logger = require('../config/logger');

class JournalController {
    store = async (req, res) => {
        try {
            const { date, reference_no, description, items } = req.body;

            if (!date || !description || !items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ message: 'Date, description and items are required' });
            }

            // Validate balance
            let totalDebit = 0;
            let totalCredit = 0;
            for (const item of items) {
                totalDebit += parseFloat(item.debit) || 0;
                totalCredit += parseFloat(item.credit) || 0;
            }

            if (Math.abs(totalDebit - totalCredit) > 0.01) {
                return res.status(422).json({ message: 'Total Debit dan Kredit tidak seimbang!' });
            }

            // Start transaction
            const connection = await db.getConnection();
            await connection.beginTransaction();

            try {
                const [journalResult] = await connection.execute(
                    `INSERT INTO journals (date, reference_no, description, source_type, user_id) 
                     VALUES (?, ?, ?, 'Manual', ?)`,
                    [date, reference_no || null, description, req.user.id]
                );
                const journalId = journalResult.insertId;

                for (const item of items) {
                    await connection.execute(
                        `INSERT INTO journal_items (journal_id, account_id, debit, credit) 
                         VALUES (?, ?, ?, ?)`,
                        [journalId, item.account_id, item.debit || 0, item.credit || 0]
                    );
                }

                await connection.commit();
                connection.release();

                res.status(201).json({ journal_id: journalId, total: totalDebit });
            } catch (error) {
                await connection.rollback();
                connection.release();
                throw error;
            }
        } catch (error) {
            logger.error('Error storing manual journal', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new JournalController();
