const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { verifyToken, authorizeRoles } = require('../middlewares/verifyToken');

// ================= CHECK-IN =================
router.post('/check-in', verifyToken, authorizeRoles('admin', 'delivery', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const [existing] = await pool.query(
      `SELECT id FROM Attendance WHERE userId = ? AND actionType = 'check-in' AND DATE(timestamp) = CURDATE()`,
      [req.user.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'تم تسجيل حضورك مسبقاً لهذا اليوم' });
    }

    await pool.query(
      `INSERT INTO Attendance (id, userId, userName, actionType) VALUES (?, ?, ?, 'check-in')`,
      [uuidv4(), req.user.id, req.user.username]
    );

    res.json({ 
      message: 'تم تسجيل الحضور بنجاح',
      data: {
        userId: req.user.id,
        username: req.user.username,
        action: 'check-in',
        time: new Date()
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تسجيل الحضور' });
  }
});

// ================= CHECK-OUT =================
router.post('/check-out', verifyToken, authorizeRoles('admin', 'delivery', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const [existingOut] = await pool.query(
      `SELECT id FROM Attendance WHERE userId = ? AND actionType = 'check-out' AND DATE(timestamp) = CURDATE()`,
      [req.user.id]
    );
    if (existingOut.length > 0) {
      return res.status(400).json({ error: 'تم تسجيل انصرافك مسبقاً لهذا اليوم' });
    }

    const [checkIn] = await pool.query(
      `SELECT id FROM Attendance WHERE userId = ? AND actionType = 'check-in' AND DATE(timestamp) = CURDATE()`,
      [req.user.id]
    );
    if (checkIn.length === 0) {
      return res.status(400).json({ error: 'لم يتم تسجيل حضورك لهذا اليوم بعد' });
    }

    await pool.query(
      `INSERT INTO Attendance (id, userId, userName, actionType) VALUES (?, ?, ?, 'check-out')`,
      [uuidv4(), req.user.id, req.user.username]
    );

    res.json({ 
      message: 'تم تسجيل الانصراف بنجاح',
      data: {
        userId: req.user.id,
        username: req.user.username,
        action: 'check-out',
        time: new Date()
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تسجيل الانصراف' });
  }
});

// ================= REPORT =================
router.get('/report/:userId', verifyToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const sql = `
      SELECT u.username, u.fullName, u.expectedDays, u.dailyHours,
        COUNT(DISTINCT DATE(a.timestamp)) as daysWorked
      FROM User u
      LEFT JOIN Attendance a ON u.id = a.userId 
        AND a.actionType = 'check-in'
        AND MONTH(a.timestamp) = MONTH(CURRENT_DATE())
        AND YEAR(a.timestamp) = YEAR(CURRENT_DATE())
      WHERE u.id = ? GROUP BY u.id`;

    const [rows] = await pool.query(sql, [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const user = rows[0];
    const expected = user.expectedDays || 24;
    const worked = user.daysWorked || 0;

    res.json({
      userName: user.username,
      fullName: user.fullName,
      dailyHours: user.dailyHours,
      expectedDays: expected,
      actualDaysWorked: worked,
      attendanceRate: `${((worked / expected) * 100).toFixed(2)}%`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في التقرير' });
  }
});

module.exports = router;