const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { verifyToken, authorizeRoles } = require('../middlewares/verifyToken');

// ================= CHECK-IN =================
router.post('/check-in', verifyToken, authorizeRoles('admin','pharmacist', 'cashier'), async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'الرجاء إرسال الـ username' });
    }

    const [user] = await pool.query(
      'SELECT id, username FROM User WHERE username = ? AND active = 1',
      [username]
    );

    if (user.length === 0) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    const [existing] = await pool.query(
      `SELECT id FROM Attendance WHERE userId = ? AND actionType = 'check-in' AND DATE(timestamp) = CURDATE()`,
      [user[0].id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'تم تسجيل حضور هذا الموظف مسبقاً' });
    }

    await pool.query(
      `INSERT INTO Attendance (id, userId, userName, actionType) VALUES (?, ?, ?, 'check-in')`,
      [uuidv4(), user[0].id, user[0].username]
    );

    res.json({ message: `تم تسجيل حضور ${username} بنجاح` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تسجيل الحضور' });
  }
});

// ================= CHECK-OUT =================
router.post('/check-out', verifyToken, authorizeRoles('admin', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'الرجاء إرسال الـ username' });
    }

    const [user] = await pool.query(
      'SELECT id, username, dailyHours FROM User WHERE username = ? AND active = 1',
      [username]
    );

    if (user.length === 0) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    const [existingOut] = await pool.query(
      `SELECT id FROM Attendance WHERE userId = ? AND actionType = 'check-out' AND DATE(timestamp) = CURDATE()`,
      [user[0].id]
    );

    if (existingOut.length > 0) {
      return res.status(400).json({ error: 'تم تسجيل انصراف هذا الموظف مسبقاً' });
    }

    // 2. جلب وقت الحضور (timestamp) لحساب الساعات
    const [checkIn] = await pool.query(
      `SELECT id, timestamp FROM Attendance WHERE userId = ? AND actionType = 'check-in' AND DATE(timestamp) = CURDATE()`,
      [user[0].id]
    );

    if (checkIn.length === 0) {
      return res.status(400).json({ error: 'لم يتم تسجيل حضور هذا الموظف لهذا اليوم بعد' });
    }

    const checkInTime = new Date(checkIn[0].timestamp);
    const currentTime = new Date();
    
    const workedMs = currentTime - checkInTime; // الفرق بالمللي ثانية
    const workedHours = workedMs / (1000 * 60 * 60); // تحويل الفرق لساعات

    const requiredHours = user[0].dailyHours || 8; // عدد الساعات المطلوبة للموظف (8 ساعات كافتراضي لو القيمة مش موجودة)

    if (workedHours < requiredHours) {
      const remainingHours = (requiredHours - workedHours).toFixed(2);
      
      const remainingMinutes = Math.ceil((requiredHours - workedHours) * 60);
      const displayHours = Math.floor(remainingMinutes / 60);
      const displayMins = remainingMinutes % 60;
      
      let timeText = '';
      if (displayHours > 0) timeText += `${displayHours} ساعة و `;
      timeText += `${displayMins} دقيقة`;

      return res.status(400).json({ 
        error: `لا يمكنك الانصراف الآن. يجب إكمال ${requiredHours} ساعات عمل. متبقي لك تقريباً ${timeText}.` 
      });
    }

    await pool.query(
      `INSERT INTO Attendance (id, userId, userName, actionType) VALUES (?, ?, ?, 'check-out')`,
      [uuidv4(), user[0].id, user[0].username]
    );

    res.json({ message: `تم تسجيل انصراف ${username} بنجاح` });
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