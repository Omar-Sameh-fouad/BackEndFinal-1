const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { verifyToken, authorizeRoles } = require('../middlewares/verifyToken');
const { validateRequest, schemas } = require('../middlewares/validator');
const axios = require('axios');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- إعدادات مكتبات الذكاء الاصطناعي والرفع لبيئة Railway ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// 1. جلب قائمة الأدوية
// ==========================================
router.get('/', verifyToken, authorizeRoles('admin', 'pharmacist'), async (req, res) => {
  try {
    const limit  = Math.max(1, parseInt(req.query.limit, 10) || 50);
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM Medicine WHERE isActive = 1 AND quantity > 0');
    const [medicines]   = await pool.query(
      'SELECT * FROM Medicine WHERE isActive = 1 AND quantity > 0 ORDER BY name ASC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    const cleanedMedicines = medicines.map(med => ({
      ...med,
      quantity: parseFloat(med.quantity),
      sellingPrice: parseFloat(med.sellingPrice),
      purchasePrice: parseFloat(med.purchasePrice)
    }));

    res.json({
      data: cleanedMedicines,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// ==========================================
// 2. البحث بالباركود
// ==========================================
router.get('/search/:barcode', verifyToken, authorizeRoles('admin', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const [medicine] = await pool.query('SELECT * FROM Medicine WHERE barcode = ? AND isActive = 1 AND quantity > 0', [req.params.barcode]);
    if (medicine.length === 0) return res.status(404).json({ error: 'الدواء غير موجود أو نفد من المخزون' });
    medicine[0].quantity = parseFloat(medicine[0].quantity);
    medicine[0].sellingPrice = parseFloat(medicine[0].sellingPrice);
    medicine[0].purchasePrice = parseFloat(medicine[0].purchasePrice);
    res.json(medicine[0]);
  } catch (err) { res.status(500).json({ error: 'حدث خطأ في البحث' }); }
});

// ==========================================
// 3. البحث بالاسم
// ==========================================
router.get('/search-by-name', verifyToken, authorizeRoles('admin', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);

    const searchTerm = `%${q.trim()}%`;
    const [medicines] = await pool.query(
      `SELECT id, name, genericName, sellingPrice, quantity, stripCount, pillCount
       FROM Medicine 
       WHERE (name LIKE ? OR genericName LIKE ?) AND isActive = 1 AND quantity > 0
       ORDER BY name ASC
       LIMIT 15`,
      [searchTerm, searchTerm]
    );

    const results = medicines.map(med => ({
      ...med,
      quantity: parseFloat(med.quantity),
      sellingPrice: parseFloat(med.sellingPrice),
    }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في البحث' });
  }
});

// ==========================================
// 4. إضافة دواء جديد
// ==========================================
router.post('/', verifyToken, authorizeRoles('admin', 'pharmacist'), validateRequest(schemas.medicine), async (req, res) => {
  try {
    const {
      name, barcode, expiryDate, quantity, purchasePrice, sellingPrice,
      requiresPrescription, supplierId,
      pillCount, stripCount, manufacturer, genericName, medicineForm
    } = req.body;

    const sql = `INSERT INTO Medicine 
      (id, name, barcode, expiryDate, quantity, purchasePrice, sellingPrice, requiresPrescription, supplierId, pillCount, stripCount, manufacturer, genericName, medicineForm) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await pool.query(sql, [
      uuidv4(), name, barcode, expiryDate, quantity, purchasePrice, sellingPrice,
      requiresPrescription || false, supplierId || null,
      pillCount || 0, stripCount || 0, manufacturer || null, genericName || null, medicineForm || null
    ]);

    res.json({ message: 'تم إضافة الدواء بنجاح' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'الباركود مسجل مسبقاً' });
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. تعديل دواء موجود
// ==========================================
router.put('/:id', verifyToken, authorizeRoles('admin', 'pharmacist'), async (req, res) => {
  try {
    const {
      name, barcode, expiryDate, quantity, purchasePrice, sellingPrice,
      requiresPrescription, supplierId, pillCount, stripCount, manufacturer,
      genericName, medicineForm
    } = req.body;

    const fieldsToUpdate = {
      name, barcode, expiryDate, quantity, purchasePrice, sellingPrice,
      requiresPrescription, supplierId, pillCount, stripCount, manufacturer,
      genericName, medicineForm
    };

    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fieldsToUpdate)) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'لم يتم إرسال أي بيانات للتحديث' });
    }

    values.push(req.params.id);

    const sql = `UPDATE Medicine SET ${updates.join(', ')} WHERE id = ?`;
    
    const [result] = await pool.query(sql, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'الدواء غير موجود في النظام' });
    }

    res.json({ message: 'تم تعديل بيانات الدواء بنجاح' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'الباركود الجديد مسجل مسبقاً لدواء آخر' });
    }
    console.error('Update Error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء التعديل' });
  }
});

// ==========================================
// 6. مسح دواء
// ==========================================
router.delete('/:id', verifyToken, authorizeRoles('admin', 'pharmacist'), async (req, res) => {
  try {
  
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) as count FROM SaleItem WHERE medicineId = ?',
      [req.params.id]
    );

    if (count > 0) {
      
      const [result] = await pool.query(
        'UPDATE Medicine SET isActive = 0 WHERE id = ?',
        [req.params.id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'الدواء غير موجود' });
      return res.json({ message: 'تم إيقاف الدواء بنجاح' });
    }

   
    const [result] = await pool.query('DELETE FROM Medicine WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'الدواء غير موجود' });
    res.json({ message: 'تم مسح الدواء بنجاح' });

  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// ==========================================
// 7. اقتراحات الأسماء العلمية
// ==========================================
router.get('/generic-suggestions', verifyToken, authorizeRoles('admin', 'pharmacist'), async (req, res) => {
  try {
    const { term } = req.query;
    if (!term || term.length < 2) return res.json([]);

    const response = await axios.get(
      `https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=${term}`,
      { timeout: 5000 }
    );

    const suggestions = response.data[1] || [];
    res.json(suggestions);
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      console.warn('RxNav Timeout:', err.message);
      return res.status(504).json({ error: 'الخدمة الطبية الخارجية بطيئة حالياً، يرجى المحاولة مرة أخرى' });
    }
    console.error('RxNav Search Error:', err.message);
    res.status(500).json({ error: 'فشل في الاتصال بقاعدة البيانات الطبية' });
  }
});


// 8. التعرف على الدواء بالذكاء الاصطناعي 
// ==========================================
router.post('/analyze-image', verifyToken, authorizeRoles('admin', 'pharmacist'), upload.single('medicineImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'الرجاء إرفاق صورة الدواء' });
    }

    
    const imageBase64 = {
      inlineData: {
        data: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype
      },
    };

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

   
    const prompt = `
      You are an expert pharmacist AI. Analyze this medicine image and extract the following details strictly as a JSON object.
      Do not include any markdown formatting like \`\`\`json. Return ONLY the raw JSON.

      Keys to extract:
      - "name": Medicine name in English or Arabic (string).
      - "barcode": Any numerical barcode visible on the box (string, default to empty string).
      - "genericName": The active ingredient / scientific name (string, default to empty string).
      - "manufacturer": The company that produced it (string, default to empty string).
      - "medicineForm": The form of medicine in Arabic (e.g., "أقراص", "كبسول", "شراب", "حقن", "مرهم") (string, default to empty string).
      - "expiryDate": The expiration date formatted EXACTLY as YYYY-MM-DD. If only MM/YY is visible, use the last day of that month (string, default to empty string).
      - "stripCount": The number of strips inside the box if indicated (number, default to 0).
      - "pillCount": The total number of pills in the box if indicated (number, default to 0).
    `;

    const result = await model.generateContent([prompt, imageBase64]);
    let responseText = result.response.text();
    
   
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const extractedData = JSON.parse(responseText);

    res.json(extractedData);

  } catch (err) {
    console.error('AI Analysis Error:', err);
    res.status(500).json({ error: 'فشل في تحليل الصورة. تأكد من وضوح الصورة والمحاولة مرة أخرى.' });
  }
});

// ==========================================
// 8. التعرف على الدواء بالذكاء الاصطناعي 
// ==========================================
router.post(
  '/analyze-image',
  verifyToken,
  authorizeRoles('admin', 'pharmacist'),
  upload.array('medicineImages', 5),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          error: 'الرجاء إرفاق صورة واحدة على الأقل'
        });
      }

      const imageParts = req.files.map(file => ({
        inlineData: {
          data: file.buffer.toString('base64'),
          mimeType: file.mimetype
        }
      }));

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash'
      });

      const prompt = `
        You are an expert pharmacist AI.

        Analyze ALL provided medicine images together as a single medicine package.

        Some images may contain:
        - Front side
        - Back side
        - Barcode
        - Expiry date
        - Manufacturer details
        - Side labels

        Combine information from all images and return ONLY one JSON object.

        Do not include markdown formatting like \`\`\`json.

        Keys to extract:
        - "name": Medicine name in English or Arabic (string).
        - "barcode": Any numerical barcode visible on the box (string, default to empty string).
        - "genericName": The active ingredient / scientific name (string, default to empty string).
        - "manufacturer": The company that produced it (string, default to empty string).
        - "medicineForm": The form of medicine in Arabic (e.g., "أقراص", "كبسول", "شراب", "حقن", "مرهم") (string, default to empty string).
        - "expiryDate": The expiration date formatted EXACTLY as YYYY-MM-DD. If only MM/YY is visible, use the last day of that month (string, default to empty string).
        - "stripCount": The number of strips inside the box if indicated (number, default to 0).
        - "pillCount": The total number of pills in the box if indicated (number, default to 0).
      `;

      const result = await model.generateContent([
        prompt,
        ...imageParts
      ]);

      let responseText = result.response.text();

      responseText = responseText
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      const extractedData = JSON.parse(responseText);

      res.json(extractedData);

    } catch (err) {
      console.error('AI Analysis Error:', err);

      res.status(500).json({
        error: 'فشل في تحليل الصورة. تأكد من وضوح الصور والمحاولة مرة أخرى.'
      });
    }
  }
);

module.exports = router;