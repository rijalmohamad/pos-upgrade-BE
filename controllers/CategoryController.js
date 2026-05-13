const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');
const fs = require('fs');
const { parse } = require('csv-parse');

class CategoryController extends BaseController {
    constructor() {
        super('item_categories');
    }

    create = async (req, res) => {
        try {
            const { name } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [existing] = await db.execute('SELECT id FROM item_categories WHERE name = ?', [name]);
            if (existing.length > 0) return res.status(400).json({ message: 'Category already exists' });

            const [result] = await db.execute('INSERT INTO item_categories (name) VALUES (?)', [name]);
            res.status(201).json({ id: result.insertId, name });
        } catch (error) {
            logger.error('Error creating category', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { name } = req.body;
            if (!name) return res.status(400).json({ message: 'Name is required' });

            const [existing] = await db.execute('SELECT id FROM item_categories WHERE name = ? AND id != ?', [name, id]);
            if (existing.length > 0) return res.status(400).json({ message: 'Category already exists' });

            await db.execute('UPDATE item_categories SET name = ? WHERE id = ?', [name, id]);
            res.json({ id, name });
        } catch (error) {
            logger.error('Error updating category', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    importCsv = async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ message: 'File is required' });

            const results = [];
            fs.createReadStream(req.file.path)
                .pipe(parse({ columns: false, trim: true }))
                .on('data', (data) => {
                    if (data[0] && data[0].toLowerCase() !== 'name') {
                        results.push(data[0]);
                    }
                })
                .on('end', async () => {
                    let count = 0;
                    for (const name of results) {
                        if (name) {
                            const [existing] = await db.execute('SELECT id FROM item_categories WHERE name = ?', [name]);
                            if (existing.length === 0) {
                                await db.execute('INSERT INTO item_categories (name) VALUES (?)', [name]);
                                count++;
                            }
                        }
                    }
                    fs.unlinkSync(req.file.path); // remove temp file
                    res.json({ message: `Berhasil mengimport ${count} kategori` });
                });
        } catch (error) {
            logger.error('Error importing categories', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };
}

module.exports = new CategoryController();
