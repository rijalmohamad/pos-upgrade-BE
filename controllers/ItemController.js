const BaseController = require('./BaseController');
const db = require('../config/db');
const logger = require('../config/logger');
const fs = require('fs');
const { parse } = require('csv-parse');

class ItemController extends BaseController {
    constructor() {
        super('items');
    }

    // Override getAll to include relations
    getAll = async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';

            const warehouseId = req.query.warehouse_id || null;

            let query = `
                SELECT i.*, c.name as category_name
            `;
            if (warehouseId) {
                query += `, COALESCE(s.qty, 0) as available_qty`;
            }
            query += `
                FROM items i 
                LEFT JOIN item_categories c ON i.item_category_id = c.id
            `;
            if (warehouseId) {
                query += ` LEFT JOIN stocks s ON i.id = s.item_id AND s.warehouse_id = ?`;
            }
            
            let countQuery = `SELECT COUNT(*) as total FROM items i`;
            let params = [];
            let countParams = [];

            if (warehouseId) {
                params.push(warehouseId);
            }

            if (search) {
                query += ` WHERE i.name LIKE ? OR i.code LIKE ?`;
                countQuery += ` WHERE i.name LIKE ? OR i.code LIKE ?`;
                params.push(`%${search}%`, `%${search}%`);
                countParams.push(`%${search}%`, `%${search}%`);
            }

            query += ` LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const [rows] = await db.query(query, params);
            const [totalRows] = await db.query(countQuery, countParams);
            const total = totalRows[0].total;
            const lastPage = Math.ceil(total / limit);

            // Fetch units and prices for each item
            for (let item of rows) {
                const [units] = await db.execute(`
                    SELECT iu.*, u.name as unit_name 
                    FROM item_units iu 
                    LEFT JOIN units u ON iu.unit_id = u.id 
                    WHERE iu.item_id = ?
                `, [item.id]);

                for (let unit of units) {
                    const [prices] = await db.execute(`
                        SELECT ip.*, cc.name as customer_category_name, cc.priority as customer_category_priority
                        FROM item_prices ip 
                        LEFT JOIN customer_categories cc ON ip.customer_category_id = cc.id 
                        WHERE ip.item_unit_id = ?
                    `, [unit.id]);
                    unit.prices = prices;
                }
                item.item_units = units;
                item.category = { id: item.item_category_id, name: item.category_name };
            }

            res.json({
                data: rows,
                total: total,
                current_page: page,
                last_page: lastPage,
                per_page: limit
            });
        } catch (error) {
            logger.error('Error fetching items', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    getById = async (req, res) => {
        try {
            const { id } = req.params;
            const warehouseId = req.query.warehouse_id || null;
            const [rows] = await db.execute(`
                SELECT i.*, c.name as category_name,
                       COALESCE(s.qty, 0) as available_qty
                FROM items i 
                LEFT JOIN item_categories c ON i.item_category_id = c.id 
                LEFT JOIN stocks s ON i.id = s.item_id AND s.warehouse_id = ?
                WHERE i.id = ?
            `, [warehouseId, id]);

            if (rows.length === 0) return res.status(404).json({ message: 'Not found' });

            const item = rows[0];
            item.category = { id: item.item_category_id, name: item.category_name };

            const [units] = await db.execute(`
                SELECT iu.*, u.name as unit_name 
                FROM item_units iu 
                LEFT JOIN units u ON iu.unit_id = u.id 
                WHERE iu.item_id = ?
                `, [id]);
    
                for (let unit of units) {
                    const [prices] = await db.execute(`
                        SELECT ip.*, cc.name as customer_category_name, cc.priority as customer_category_priority
                        FROM item_prices ip 
                        LEFT JOIN customer_categories cc ON ip.customer_category_id = cc.id 
                        WHERE ip.item_unit_id = ?
                    `, [unit.id]);
                    unit.prices = prices;
                }
                item.item_units = units;
    
                res.json(item);
            } catch (error) {
                logger.error('Error fetching item by ID', error);
                res.status(500).json({ message: 'Internal server error' });
            }
        };
    
        create = async (req, res) => {
            const conn = await db.getConnection();
            await conn.beginTransaction();
            try {
                const { item_category_id, name, min_stock, weight, units } = req.body;
                let { code } = req.body;
    
                if (!code) {
                    const [lastItem] = await conn.execute("SELECT code FROM items WHERE code LIKE 'BRG-%' ORDER BY id DESC LIMIT 1");
                    let lastNumber = 0;
                    if (lastItem.length > 0) {
                        lastNumber = parseInt(lastItem[0].code.replace('BRG-', '')) || 0;
                    }
                    code = 'BRG-' + (lastNumber + 1).toString().padStart(6, '0');
                }
    
                const photoPath = req.file ? req.file.path : null;
    
                const [itemResult] = await conn.execute(
                    'INSERT INTO items (item_category_id, code, name, min_stock, weight, photo) VALUES (?, ?, ?, ?, ?, ?)',
                    [item_category_id, code, name, min_stock || 0, weight || 0, photoPath]
                );
                const itemId = itemResult.insertId;
    
                const unitsData = JSON.parse(units); // Assuming units are sent as JSON string due to multipart
                for (let i = 0; i < unitsData.length; i++) {
                    const u = unitsData[i];
                    const [unitResult] = await conn.execute(
                        'INSERT INTO item_units (item_id, unit_id, amount, is_base, last_purchase_price) VALUES (?, ?, ?, ?, ?)',
                        [itemId, u.unit_id, u.amount, i === 0 ? 1 : 0, u.purchase_price || 0]
                    );
                    const itemUnitId = unitResult.insertId;
    
                    for (const catId in u.prices) {
                        await conn.execute(
                            'INSERT INTO item_prices (item_unit_id, customer_category_id, price) VALUES (?, ?, ?)',
                            [itemUnitId, catId, Math.min(parseFloat(u.prices[catId]) || 0, 9999999999999.99)]
                        );
                    }
                }
    
                await conn.commit();
                res.status(201).json({ message: 'Barang berhasil disimpan', id: itemId });
            } catch (error) {
                await conn.rollback();
                logger.error('Error creating item', error);
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
                const { item_category_id, code, name, min_stock, weight, units } = req.body;
    
                const [item] = await conn.execute('SELECT photo FROM items WHERE id = ?', [id]);
                if (item.length === 0) return res.status(404).json({ message: 'Not found' });
    
                let photoPath = item[0].photo;
                if (req.file) {
                    if (photoPath && fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
                    photoPath = req.file.path;
                }
    
                await conn.execute(
                    'UPDATE items SET item_category_id = ?, code = ?, name = ?, min_stock = ?, weight = ?, photo = ? WHERE id = ?',
                    [item_category_id, code, name, min_stock || 0, weight || 0, photoPath, id]
                );
    
                const unitsData = JSON.parse(units);
                console.log('Units Data received:', JSON.stringify(unitsData, null, 2));
                const providedIds = [];
    
                for (let i = 0; i < unitsData.length; i++) {
                    const u = unitsData[i];
                    let itemUnitId = u.id;
    
                    if (itemUnitId) {
                        await conn.execute(
                            'UPDATE item_units SET unit_id = ?, amount = ?, is_base = ?, last_purchase_price = ? WHERE id = ? AND item_id = ?',
                            [u.unit_id, u.amount, i === 0 ? 1 : 0, u.purchase_price || 0, itemUnitId, id]
                        );
                    } else {
                        const [unitResult] = await conn.execute(
                            'INSERT INTO item_units (item_id, unit_id, amount, is_base, last_purchase_price) VALUES (?, ?, ?, ?, ?)',
                            [id, u.unit_id, u.amount, i === 0 ? 1 : 0, u.purchase_price || 0]
                        );
                        itemUnitId = unitResult.insertId;
                    }
                    providedIds.push(itemUnitId);
    
                    for (const catId in u.prices) {
                        const [existingPrice] = await conn.execute(
                            'SELECT id FROM item_prices WHERE item_unit_id = ? AND customer_category_id = ?',
                            [itemUnitId, catId]
                        );
                        if (existingPrice.length > 0) {
                            console.log('Updating price:', u.prices[catId], 'for id:', existingPrice[0].id);
                            await conn.execute(
                                'UPDATE item_prices SET price = ? WHERE id = ?',
                                [Math.min(parseFloat(u.prices[catId]) || 0, 9999999999999.99), existingPrice[0].id]
                            );
                        } else {
                            await conn.execute(
                                'INSERT INTO item_prices (item_unit_id, customer_category_id, price) VALUES (?, ?, ?)',
                                [itemUnitId, catId, Math.min(parseFloat(u.prices[catId]) || 0, 9999999999999.99)]
                            );
                        }
                    }
                }
    
                // Delete units not provided
                if (providedIds.length > 0) {
                    const placeholders = providedIds.map(() => '?').join(',');
                    await conn.execute(`DELETE FROM item_units WHERE item_id = ? AND id NOT IN (${placeholders})`, [id, ...providedIds]);
                }
    
                await conn.commit();
                res.json({ message: 'Barang berhasil diperbarui' });
            } catch (error) {
                await conn.rollback();
                logger.error('Error updating item', error);
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
                const [item] = await conn.execute('SELECT photo FROM items WHERE id = ?', [id]);
                if (item.length === 0) return res.status(404).json({ message: 'Not found' });
    
                if (item[0].photo && fs.existsSync(item[0].photo)) fs.unlinkSync(item[0].photo);
    
                // Delete cascade might handle this if FK set to cascade, but let's do it manually to be safe
                await conn.execute('DELETE FROM item_prices WHERE item_unit_id IN (SELECT id FROM item_units WHERE item_id = ?)', [id]);
                await conn.execute('DELETE FROM item_units WHERE item_id = ?', [id]);
                await conn.execute('DELETE FROM items WHERE id = ?', [id]);
    
                await conn.commit();
                res.json({ message: 'Barang berhasil dihapus' });
            } catch (error) {
                await conn.rollback();
                logger.error('Error deleting item', error);
                res.status(500).json({ message: 'Internal server error' });
            } finally {
                conn.release();
            }
        };
    downloadTemplate = async (req, res) => {
        try {
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Template Barang');

            worksheet.columns = [
                { header: 'code', key: 'code', width: 15 },
                { header: 'name', key: 'name', width: 30 },
                { header: 'category', key: 'category', width: 20 },
                { header: 'unit', key: 'unit', width: 15 },
                { header: 'harga beli', key: 'harga_beli', width: 15 },
                { header: 'general', key: 'general', width: 15 },
                { header: 'reseller', key: 'reseller', width: 15 },
                { header: 'top-reseller', key: 'top_reseller', width: 15 },
                { header: 'special-reseller', key: 'special_reseller', width: 15 },
                { header: 'super-seller', key: 'super_seller', width: 15 }
            ];

            const [units] = await db.execute('SELECT name FROM units');
            const unitNames = units.map(u => u.name);

            worksheet.addRow({
                code: 'BRG01',
                name: '511 KEMASAN POKPHAND',
                category: 'PAKAN AYAM',
                unit: unitNames[0] || 'DUS',
                harga_beli: 215000,
                general: 250000,
                reseller: 245000,
                top_reseller: 235000,
                special_reseller: 225000,
                super_seller: 220000
            });

            // Add hidden sheet for units to avoid 255 char limit in list validation
            const unitSheet = workbook.addWorksheet('Data_Units', { state: 'hidden' });
            unitNames.forEach((name, index) => {
                unitSheet.getCell(`A${index + 1}`).value = name;
            });

            if (unitNames.length > 0) {
                for (let i = 2; i <= 1000; i++) {
                    worksheet.getCell(`D${i}`).dataValidation = {
                        type: 'list',
                        allowBlank: true,
                        formulae: [`Data_Units!$A$1:$A$${unitNames.length}`]
                    };
                }
            }

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=template_barang.xlsx');

            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            logger.error('Error generating template', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    };

    importExcel = async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'File tidak ditemukan' });
        }

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const conn = await db.getConnection();
        await conn.beginTransaction();

        try {
            await workbook.xlsx.readFile(req.file.path);
            const worksheet = workbook.getWorksheet(1);
            const rows = [];

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                rows.push({
                    rowNumber,
                    code: row.getCell(1).value,
                    name: row.getCell(2).value,
                    category: row.getCell(3).value,
                    unit: row.getCell(4).value,
                    harga_beli: row.getCell(5).value,
                    general: row.getCell(6).value,
                    reseller: row.getCell(7).value,
                    top_reseller: row.getCell(8).value,
                    special_reseller: row.getCell(9).value,
                    super_seller: row.getCell(10).value
                });
            });

            const [customerCategories] = await conn.execute('SELECT id, name, priority FROM customer_categories ORDER BY priority ASC');
            const [dbUnits] = await conn.execute('SELECT id, name FROM units');
            const [dbCategories] = await conn.execute('SELECT id, name FROM item_categories');

            const errors = [];
            const itemsToInsert = [];

            for (const r of rows) {
                if (!r.name) {
                    errors.push(`Baris ${r.rowNumber}: Nama barang tidak boleh kosong`);
                    continue;
                }
                if (!r.unit) {
                    errors.push(`Baris ${r.rowNumber}: Satuan tidak boleh kosong`);
                    continue;
                }

                const unit = dbUnits.find(u => u.name.toLowerCase() === r.unit.toString().toLowerCase());
                if (!unit) {
                    errors.push(`Baris ${r.rowNumber}: Satuan "${r.unit}" tidak ada di database. Silakan buat di master satuan.`);
                    continue;
                }

                let categoryId = null;
                if (r.category) {
                    const cat = dbCategories.find(c => c.name.toLowerCase() === r.category.toString().toLowerCase());
                    if (cat) {
                        categoryId = cat.id;
                    } else {
                        errors.push(`Baris ${r.rowNumber}: Kategori "${r.category}" tidak ada di database.`);
                        continue;
                    }
                }

                if (r.code) {
                    const [dupCode] = await conn.execute('SELECT id FROM items WHERE code = ?', [r.code]);
                    if (dupCode.length > 0) {
                        errors.push(`Baris ${r.rowNumber}: Kode barang "${r.code}" sudah ada.`);
                        continue;
                    }
                }
                const [dupName] = await conn.execute('SELECT id FROM items WHERE name = ?', [r.name]);
                if (dupName.length > 0) {
                    errors.push(`Baris ${r.rowNumber}: Nama barang "${r.name}" sudah ada.`);
                    continue;
                }

                const prices = {};
                const filePrices = [r.general, r.reseller, r.top_reseller, r.special_reseller, r.super_seller];
                
                for (let i = 0; i < customerCategories.length; i++) {
                    const cc = customerCategories[i];
                    const price = filePrices[i];
                    prices[cc.id] = parseFloat(price) || 0;
                }

                itemsToInsert.push({
                    code: r.code,
                    name: r.name,
                    item_category_id: categoryId,
                    unit_id: unit.id,
                    harga_beli: parseFloat(r.harga_beli) || 0,
                    prices: prices
                });
            }

            if (errors.length > 0) {
                await conn.rollback();
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ message: 'Import gagal karena ada kesalahan data', errors });
            }

            for (const item of itemsToInsert) {
                let code = item.code;
                if (!code) {
                    const [lastItem] = await conn.execute("SELECT code FROM items WHERE code LIKE 'BRG-%' ORDER BY id DESC LIMIT 1");
                    let lastNumber = 0;
                    if (lastItem.length > 0) {
                        lastNumber = parseInt(lastItem[0].code.replace('BRG-', '')) || 0;
                    }
                    code = 'BRG-' + (lastNumber + 1).toString().padStart(6, '0');
                }

                const [itemResult] = await conn.execute(
                    'INSERT INTO items (item_category_id, code, name, min_stock, weight, photo) VALUES (?, ?, ?, ?, ?, ?)',
                    [item.item_category_id, code, item.name, 0, 0, null]
                );
                const itemId = itemResult.insertId;

                const [unitResult] = await conn.execute(
                    'INSERT INTO item_units (item_id, unit_id, amount, is_base, last_purchase_price) VALUES (?, ?, ?, ?, ?)',
                    [itemId, item.unit_id, 1, 1, item.harga_beli]
                );
                const itemUnitId = unitResult.insertId;

                for (const catId in item.prices) {
                    await conn.execute(
                        'INSERT INTO item_prices (item_unit_id, customer_category_id, price) VALUES (?, ?, ?)',
                        [itemUnitId, catId, item.prices[catId]]
                    );
                }
            }

            await conn.commit();
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            
            res.json({ message: `Berhasil mengimport ${itemsToInsert.length} barang.` });
        } catch (error) {
            await conn.rollback();
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            logger.error('Error importing excel', error);
            res.status(500).json({ message: 'Internal server error' });
        } finally {
            conn.release();
        }
    };
}

module.exports = new ItemController();
