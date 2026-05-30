const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const nodemailer = require('nodemailer');
const { JWT_SECRET } = require('../middlewares/verifyToken');
const { validateRequest, schemas } = require('../middlewares/validator');

// إعداد خدمة إرسال الإيميلات
// إعداد خدمة إرسال الإيميلات مع إجبار استخدام IPv4
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // استخدام SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false // تخطي مشاكل الشهادات المحلية في بيئة التطوير
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'محاولات دخول كثيرة، يرجى المحاولة بعد 15 دقيقة' }
});

router.post('/login', loginLimiter, validateRequest(schemas.login), async (req, res) => {
  try {
    const { username, password } = req.body;

    const [users] = await pool.query('SELECT * FROM User WHERE username = ? AND active = 1', [username]);
    if (users.length === 0) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

    const isValidPassword = await bcrypt.compare(password, users[0].password);
    if (!isValidPassword) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

    const token = jwt.sign(
      { id: users[0].id, role: users[0].role, username: users[0].username },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    delete users[0].password;
    res.json({ message: 'تم تسجيل الدخول بنجاح', token, user: users[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
  }
});

// ================= 1. طلب إرسال رمز الاستعادة =================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'الرجاء إدخال البريد الإلكتروني' });

    // التأكد إن الإيميل موجود ومفعل
    const [users] = await pool.query('SELECT id, fullName FROM User WHERE email = ? AND active = 1', [email]);
    if (users.length === 0) return res.status(404).json({ error: 'البريد الإلكتروني غير مسجل أو الحساب غير مفعل' });

    // توليد كود من 6 أرقام
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // تحديد وقت انتهاء الصلاحية (15 دقيقة من الآن)
    const expiryDate = new Date(Date.now() + 15 * 60 * 1000);

    // حفظ الكود في الداتا بيز
    await pool.query(
      'UPDATE User SET resetOtp = ?, resetOtpExpiry = ? WHERE email = ?',
      [otp, expiryDate, email]
    );

    // تجهيز الإيميل
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'رمز استعادة كلمة المرور - CarePlus Pharmacy',
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>مرحباً ${users[0].fullName}،</h2>
          <p>لقد طلبت استعادة كلمة المرور الخاصة بك.</p>
          <p>رمز التحقق الخاص بك هو: <strong style="font-size: 24px; color: #2c3e50;">${otp}</strong></p>
          <p style="color: #e74c3c;">هذا الرمز صالح لمدة 15 دقيقة فقط.</p>
          <p>إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.</p>
        </div>
      `
    };

    // إرسال الإيميل
    await transporter.sendMail(mailOptions);

    res.json({ message: 'تم إرسال رمز الاستعادة إلى بريدك الإلكتروني بنجاح' });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال البريد الإلكتروني' });
  }
});

// ================= 2. تغيير الباسوورد باستخدام الرمز =================
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'الرجاء إدخال البريد الإلكتروني، الرمز، وكلمة المرور الجديدة' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    // جلب بيانات المستخدم والكود من الداتا بيز
    const [users] = await pool.query('SELECT id, resetOtp, resetOtpExpiry FROM User WHERE email = ?', [email]);
    if (users.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const user = users[0];

    // التحقق من صحة الكود
    if (!user.resetOtp || user.resetOtp !== otp) {
      return res.status(400).json({ error: 'الرمز الذي أدخلته غير صحيح' });
    }

    // التحقق من وقت الصلاحية
    if (new Date() > new Date(user.resetOtpExpiry)) {
      return res.status(400).json({ error: 'عذراً، هذا الرمز منتهي الصلاحية. يرجى طلب رمز جديد.' });
    }

    // تشفير الباسوورد الجديد
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // تحديث الباسوورد ومسح الكود القديم
    await pool.query(
      'UPDATE User SET password = ?, resetOtp = NULL, resetOtpExpiry = NULL WHERE email = ?',
      [hashedPassword, email]
    );

    res.json({ message: 'تم تغيير كلمة المرور بنجاح، يمكنك الآن تسجيل الدخول' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تغيير كلمة المرور' });
  }
});

router.post('/create-first-admin', async (req, res) => {
  try {
    const [existing] = await pool.query("SELECT id FROM User WHERE role = 'admin' LIMIT 1");
    if (existing.length > 0) {
      return res.status(400).json({ error: 'يوجد أدمن بالفعل، يرجى تسجيل الدخول.' });
    }
    const hashedPassword = await bcrypt.hash('123456', 10);
    const sql = `INSERT INTO User (id, username, fullName, email, phone, role, password, active, dailyHours, expectedDays) VALUES (UUID(), 'admin_user', 'المدير العام', 'admin@careplus.com', '01000000000', 'admin', ?, 1, 8, 24)`;
    await pool.query(sql, [hashedPassword]);
    
    res.json({ message: 'تم إنشاء أول أدمن بنجاح! اليوزر: admin_user | الباسوورد: 123456' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.json({ message: 'الأدمن موجود بالفعل، يرجى تسجيل الدخول!' });
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
  }
});

module.exports = router;