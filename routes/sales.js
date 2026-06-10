const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, authorizeRoles } = require('../middlewares/verifyToken');
const { validateRequest, schemas } = require('../middlewares/validator');

// =================  حساب الكمية الفعلية =================
function calculateFractionalQty(qty, quantityType, stripCount, pillCount) {
  if (quantityType === 'box') return qty;
  if (quantityType === 'strip') return stripCount ? qty / stripCount : qty;
  if (quantityType === 'pill') return pillCount ? qty / pillCount : qty;
  return qty;
}

// ================= فحص التعارضات =================
async function checkInteractions(items) {
  const genericNames = [...new Set(
    items
      .filter(item => item.genericName && item.genericName.trim() !== '')
      .map(item => {
        return item.genericName
          .toLowerCase()
          .replace(/[0-9]+\s*(mg|ml|mcg|g|iu|%)/gi, '')
          .trim()
          .split(/[\s+\/]+/)[0]; 
      })
      .filter(name => name.length > 0)
  )];

  if (genericNames.length < 2) {
    return { hasInteraction: false, details: [] };
  }

  const mockDatabase = {
    'aspirin-warfarin': { severity: 'high', description: 'تحذير: الأسبرين مع الوارفارين يزيد خطر النزيف' },
    'ibuprofen-aspirin': { severity: 'moderate', description: 'الإيبوبروفين يقلل فاعلية الأسبرين' }
  };

  const interactions = [];
  for (let i = 0; i < genericNames.length; i++) {
    for (let j = i + 1; j < genericNames.length; j++) {
      const key1 = `${genericNames[i]}-${genericNames[j]}`;
      const key2 = `${genericNames[j]}-${genericNames[i]}`;
      if (mockDatabase[key1]) interactions.push(mockDatabase[key1]);
      else if (mockDatabase[key2]) interactions.push(mockDatabase[key2]);
    }
  }

  return { hasInteraction: interactions.length > 0, details: interactions };
}

// =================  عملية البيع =================
router.post('/', verifyToken, authorizeRoles('admin', 'pharmacist', 'cashier'), validateRequest(schemas.sale), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { paymentMethod, items, forceInteraction } = req.body;

    const medicineIds = items.map(item => item.medicineId);
    const placeholders = medicineIds.map(() => '?').join(',');
    const [medicines] = await connection.query(
      `SELECT id, name, genericName, sellingPrice, purchasePrice, quantity, stripCount, pillCount 
       FROM Medicine WHERE id IN (${placeholders})`,
      medicineIds
    );

    const itemsWithDetails = items.map(item => {
      const medicine = medicines.find(m => m.id === item.medicineId);
      if (!medicine) throw new Error(`الدواء غير موجود: ${item.medicineId}`);
      return { ...item, ...medicine };
    });

    const interactions = await checkInteractions(itemsWithDetails);

    if (interactions.hasInteraction && !forceInteraction) {
      await connection.rollback();
      return res.status(409).json({
        error: 'يوجد تعارض دوائي',
        interactions: interactions.details,
        requiresConfirmation: true,
        message: 'هل تريد الاستمرار في البيع رغم التحذير؟'
      });
    }

    if (interactions.hasInteraction && forceInteraction) {
      await connection.query(
        `INSERT INTO AuditLog (id, actorId, actorName, action, details, severity) 
         VALUES (UUID(), ?, ?, 'SALE_WITH_INTERACTION', ?, 'warning')`,
        [req.user.id, req.user.username,
          `تم بيع فاتورة تحتوي تعارضات: ${JSON.stringify(interactions.details)}`]
      );
    }

    const cashierId = req.user.id;
    const cashierName = req.user.username;
    const saleId = uuidv4();

    let grandTotal = 0;
    let totalCost = 0;
    let totalProfit = 0;

    await connection.query(
      `INSERT INTO Sale (id, total, cost, profit, paymentMethod, cashierName, cashierId) 
       VALUES (?, 0, 0, 0, ?, ?, ?)`,
      [saleId, paymentMethod, cashierName, cashierId]
    );

    for (let item of itemsWithDetails) {
      const deductionQty = calculateFractionalQty(item.qty, item.quantityType, item.stripCount, item.pillCount);

      if (item.quantity < deductionQty) {
        throw new Error(`الكمية غير كافية لدواء: ${item.name}`);
      }

      const itemTotalPrice = item.sellingPrice * deductionQty;
      const itemTotalCost = item.purchasePrice * deductionQty;
      const itemProfit = itemTotalPrice - itemTotalCost;

      grandTotal += itemTotalPrice;
      totalCost += itemTotalCost;
      totalProfit += itemProfit;

      await connection.query(`UPDATE Medicine SET quantity = quantity - ? WHERE id = ?`, [deductionQty, item.medicineId]);

            const [[{ newQty }]] = await connection.query(
        `SELECT quantity AS newQty FROM Medicine WHERE id = ?`,
        [item.medicineId]
      );
      if (parseFloat(newQty) <= 0) {
        await connection.query(
          `INSERT INTO AuditLog (id, actorId, actorName, action, details, severity)
           VALUES (UUID(), ?, ?, 'OUT_OF_STOCK', ?, 'warning')`,
          [
            req.user.id,
            req.user.username,
            `نفدت كمية الدواء "${item.name}" من المخزون بعد عملية البيع.`
          ]
        );
      }

      await connection.query(
        `INSERT INTO SaleItem (id, qty, unitPrice, unitCost, medicineName, saleId, medicineId, quantityType, stripCount, pillCount) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), item.qty, (itemTotalPrice / item.qty), (itemTotalCost / item.qty),
          item.name, saleId, item.medicineId, item.quantityType, item.stripCount, item.pillCount]
      );
    }

    await connection.query(`UPDATE Sale SET total = ?, cost = ?, profit = ? WHERE id = ?`,
      [grandTotal, totalCost, totalProfit, saleId]);

    await connection.commit();

    res.json({
      message: 'تم البيع بنجاح',
      saleId,
      total: grandTotal,
      interactionsWarning: interactions.hasInteraction ? 'تم البيع رغم وجود تعارضات' : null
    });

  } catch (err) {
    await connection.rollback();
    console.error("Sale Error:", err.message);
    res.status(400).json({ error: err.message || 'فشل إتمام عملية البيع' });
  } finally {
    connection.release();
  }
});

router.get('/', verifyToken, authorizeRoles('admin', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 50);
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const offset = (page - 1) * limit;
    
    const { date, startDate, endDate } = req.query;

    const isAdmin = req.user.role === 'admin';
    const conditions = isAdmin ? [] : ['cashierId = ?'];
    const queryParams = isAdmin ? [] : [req.user.id];

    if (startDate && endDate) {
      conditions.push('DATE(ts) BETWEEN ? AND ?');
      queryParams.push(startDate, endDate);
    } else if (startDate) {
      conditions.push('DATE(ts) >= ?');
      queryParams.push(startDate);
    } else if (endDate) {
      conditions.push('DATE(ts) <= ?');
      queryParams.push(endDate);
    } else if (date) {
  
      conditions.push('DATE(ts) = ?');
      queryParams.push(date);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countQuery = `SELECT COUNT(*) AS total FROM Sale ${whereClause}`;
    const dataQuery  = `SELECT id, total, cost, profit, paymentMethod, cashierName, ts 
                        FROM Sale ${whereClause} 
                        ORDER BY ts DESC LIMIT ? OFFSET ?`;

    const [[{ total }]] = await pool.query(countQuery, queryParams);
    const [sales]        = await pool.query(dataQuery,  [...queryParams, limit, offset]);

    res.json({
      data: sales,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error("History Error:", err.message);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب سجل المبيعات' });
  }
});

router.get('/:id', verifyToken, authorizeRoles('admin', 'pharmacist', 'cashier'), async (req, res) => {
  try {
    const saleId = req.params.id;

    const [sale] = await pool.query('SELECT * FROM Sale WHERE id = ?', [saleId]);
    if (sale.length === 0) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    const [items] = await pool.query('SELECT * FROM SaleItem WHERE saleId = ?', [saleId]);

    res.json({
      ...sale[0],
      items
    });
  } catch (err) {
    console.error("Invoice Error:", err.message);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب الفاتورة' });
  }
});

module.exports = router;