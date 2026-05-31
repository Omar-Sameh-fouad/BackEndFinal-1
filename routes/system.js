const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { verifyToken, authorizeRoles } = require('../middlewares/verifyToken');
const multer = require('multer');
const os = require('os');
const upload = multer({ dest: os.tmpdir() });

router.get('/notifications', verifyToken, authorizeRoles('admin', 'pharmacist'), async (req, res) => {
  try {
    const [medicines] = await pool.query(`
      SELECT id, name, quantity, expiryDate
      FROM Medicine
      WHERE quantity <= 10
         OR expiryDate <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
    `);

    const today = new Date();
    const alerts = [];

    medicines.forEach(med => {
      med.quantity = parseFloat(med.quantity);
      if (med.quantity === 0) {
        alerts.push({ id: uuidv4(), type: 'low_stock', urgent: true, title: `نفاد كمية: ${med.name}`, message: `الكمية صفر! يرجى الطلب فوراً.` });
      } else if (med.quantity <= 10) {
        alerts.push({ id: uuidv4(), type: 'low_stock', urgent: false, title: `نقص مخزون: ${med.name}`, message: `متبقي ${med.quantity} علبة فقط.` });
      }

      const expiryDate = new Date(med.expiryDate);
      const diffDays = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        alerts.push({ id: uuidv4(), type: 'expiry', urgent: true, title: `دواء منتهي الصلاحية: ${med.name}`, message: `انتهت صلاحيته.` });
      } else if (diffDays <= 30) {
        alerts.push({ id: uuidv4(), type: 'expiry', urgent: true, title: `صلاحية توشك على الانتهاء: ${med.name}`, message: `سينتهي قريباً.` });
      }
    });
    res.json(alerts);
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في الخادم' }); }
});

// =================== تقرير الوردية الحالية (العداد الحالي) ===================
router.get('/reports/today', verifyToken, authorizeRoles('admin', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const isCashier = req.user.role === 'cashier';
    const cashierFilter = isCashier ? 'AND cashierId = ?' : '';
    const cashierParams = isCashier ? [req.user.id] : [];

    // التعديل: تجميع المبيعات اللي (isClosed = FALSE) عشان العداد يصفر بعد التقفيل
    const [sales] = await pool.query(
      `SELECT paymentMethod, SUM(total) as amount FROM Sale WHERE isClosed = FALSE ${cashierFilter} GROUP BY paymentMethod`,
      cashierParams
    );
    const [[countData]] = await pool.query(
      `SELECT COUNT(id) as count FROM Sale WHERE isClosed = FALSE ${cashierFilter}`,
      cashierParams
    );

    let totals = { cash: 0, card: 0, wallet: 0, insurance: 0 };
    let grandTotal = 0;
    sales.forEach(s => { totals[s.paymentMethod] = Number(s.amount); grandTotal += Number(s.amount); });

    res.json({ totals, grandTotal, salesCount: countData.count });
  } catch (err) {
    console.error('Shift Report Error:', err.message);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// =================== التقارير التاريخية ===================
router.get('/reports/historical', verifyToken, authorizeRoles('admin', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const { range } = req.query;
    const isCashier = req.user.role === 'cashier';
    const cashierFilter = isCashier ? 'AND cashierId = ?' : '';
    const cashierParam  = isCashier ? [req.user.id] : [];

    let sql, params;

    if (range === 'day') {
      sql = `SELECT DATE(ts) as date, SUM(total) as total, SUM(profit) as profit, COUNT(id) as count
             FROM Sale WHERE DATE(ts) = CURDATE() ${cashierFilter}
             GROUP BY DATE(ts) ORDER BY DATE(ts) ASC`;
      params = [...cashierParam];
    } else {
      const daysFilter = range === 'week' ? 7 : 30;
      sql = `SELECT DATE(ts) as date, SUM(total) as total, SUM(profit) as profit, COUNT(id) as count
             FROM Sale WHERE ts >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ${cashierFilter}
             GROUP BY DATE(ts) ORDER BY DATE(ts) ASC`;
      params = [daysFilter, ...cashierParam];
    }

    const [data] = await pool.query(sql, params);
    let overall = { total: 0, profit: 0, count: 0 };
    data.forEach(d => { overall.total += Number(d.total); overall.profit += Number(d.profit); overall.count += d.count; });

    res.json({ history: data, overall });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ' }); }
});

router.get('/security', verifyToken, authorizeRoles('admin', 'pharmacist'), async (req, res) => {
  try {
    const [sec] = await pool.query('SELECT setupComplete, recoveryEmail, recoveryPhone FROM ManagerSecurity WHERE id = "1"');
    res.json(sec.length > 0 ? sec[0] : { setupComplete: false });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ' }); }
});

router.post('/security/setup', verifyToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { pin, recoveryEmail, recoveryPhone } = req.body;
    const hashedPin = await bcrypt.hash(pin, 10);
    await pool.query(
      'INSERT INTO ManagerSecurity (id, pinHash, recoveryEmail, recoveryPhone, setupComplete) VALUES ("1", ?, ?, ?, 1) ON DUPLICATE KEY UPDATE pinHash=?, recoveryEmail=?, recoveryPhone=?, setupComplete=1',
      [hashedPin, recoveryEmail, recoveryPhone, hashedPin, recoveryEmail, recoveryPhone]
    );
    res.json({ message: 'تم إعداد الأمان بنجاح' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ' }); }
});

router.post('/security/reset-pin', verifyToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { oldPin, newPin } = req.body;
    const [sec] = await pool.query('SELECT pinHash FROM ManagerSecurity WHERE id = "1"');
    if (sec.length === 0) return res.status(401).json({ error: 'لم يتم إعداد الأمان بعد' });
    const isValid = await bcrypt.compare(oldPin, sec[0].pinHash);
    if (!isValid) return res.status(401).json({ error: 'الرمز القديم غير صحيح' });
    const hashedNewPin = await bcrypt.hash(newPin, 10);
    await pool.query('UPDATE ManagerSecurity SET pinHash = ? WHERE id = "1"', [hashedNewPin]);
    res.json({ message: 'تم تغيير الرمز بنجاح' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ' }); }
});

// =================== تقفيل الوردية (تصفير العداد) ===================
router.post('/daily-closing', verifyToken, authorizeRoles('admin', 'pharmacist'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { date, totals, grandTotal, salesCount, closedByName, closedById, pin } = req.body;
    
    const userId = req.user.id;
    const [userDb] = await connection.query('SELECT password FROM User WHERE id = ?', [userId]);
    
    if (userDb.length === 0) return res.status(401).json({ error: 'المستخدم غير موجود' });

    const isValid = await bcrypt.compare(pin, userDb[0].password);
    if (!isValid) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });

    await connection.beginTransaction();

    // 1. تسجيل لقطة الوردية في التقرير
    const sql = `INSERT INTO DailyClosing (id, date, totals, grandTotal, salesCount, closedByName, closedById) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await connection.query(sql, [uuidv4(), date, JSON.stringify(totals), grandTotal, salesCount, closedByName, closedById]);
    
    // 2. تصفير العداد: إغلاق كل الفواتير المفتوحة
    const isCashier = req.user.role === 'cashier';
    const cashierFilter = isCashier ? 'AND cashierId = ?' : '';
    const cashierParams = isCashier ? [req.user.id] : [];
    
    await connection.query(`UPDATE Sale SET isClosed = TRUE WHERE isClosed = FALSE ${cashierFilter}`, cashierParams);

    await connection.commit();
    res.json({ message: 'تم تقفيل الوردية وتصفير العداد بنجاح' });
  } catch (err) { 
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ أثناء تقفيل الوردية' }); 
  } finally {
    connection.release();
  }
});

router.post('/logs', verifyToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { actorId, actorName, action, details, severity } = req.body;
    const sql = `INSERT INTO AuditLog (id, actorId, actorName, action, details, severity) VALUES (?, ?, ?, ?, ?, ?)`;
    await pool.query(sql, [uuidv4(), actorId, actorName, action, details, severity]);
    res.json({ message: 'تم تسجيل الحركة' });
  } catch (err) { res.status(500).json({ error: 'حدث خطأ' }); }
});

router.get('/logs', verifyToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 50);
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM AuditLog');
    const [logs] = await pool.query(
      'SELECT * FROM AuditLog ORDER BY ts DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    res.json({ data: logs, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { res.status(500).json({ error: 'تفاصيل الخطأ: ' + err.message }); }
});

router.get('/backup', verifyToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const tables = ['User', 'Medicine', 'Supplier', 'Sale', 'SaleItem', 'ReturnSale', 'Attendance', 'DailyClosing', 'AuditLog', 'ManagerSecurity'];
    let sqlDump = `-- CarePlus Pharmacy Backup\n-- Date: ${new Date().toLocaleString('en-US')}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

    for (const table of tables) {
      const [schemaRows] = await pool.query(`SHOW CREATE TABLE \`${table}\``);
      if (schemaRows.length > 0) {
        sqlDump += `DROP TABLE IF EXISTS \`${table}\`;\n${schemaRows[0]['Create Table']};\n\n`;
      }
      const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
      if (rows.length > 0) {
        for (const row of rows) {
          const columns = Object.keys(row).map(c => `\`${c}\``).join(', ');
          const values = Object.values(row).map(val => {
            if (val === null) return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
            if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
            return val;
          }).join(', ');
          sqlDump += `INSERT INTO \`${table}\` (${columns}) VALUES (${values});\n`;
        }
        sqlDump += `\n\n`;
      }
    }
    sqlDump += `SET FOREIGN_KEY_CHECKS=1;\n`;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="careplus_backup_${timestamp}.sql"`);
    res.send(sqlDump);
  } catch (err) { res.status(500).json({ error: 'حدث خطأ أثناء إنشاء النسخة الاحتياطية' }); }
});   

router.post('/restore', verifyToken, authorizeRoles('admin'), upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'الرجاء إرفاق ملف النسخة الاحتياطية' });
    const sqlDump = fs.readFileSync(req.file.path, 'utf8');
    await pool.query(sqlDump);
    fs.unlinkSync(req.file.path);
    res.json({ message: 'تم استرجاع قاعدة البيانات بنجاح' });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'حدث خطأ أثناء الاسترجاع. تأكد من أن الملف سليم وصالح.' });
  }
});

module.exports = router;