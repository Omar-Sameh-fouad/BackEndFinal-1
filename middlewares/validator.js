const Joi = require('joi');

// التعبير النمطي للشروط: 8 أحرف على الأقل، حرف كبير، حرف صغير، رقم، ورمز خاص
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+={}\[\]|\\:;"'<>,.?/-]).{8,}$/;
const passwordMessage = 'كلمة المرور يجب أن لا تقل عن 8 أحرف، وتحتوي على: حرف كبير، حرف صغير، رقم، ورمز خاص.';

const schemas = {
  user: Joi.object({
    username: Joi.string().min(3).required(),
    fullName: Joi.string().required(),
    
    email: Joi.string().email().pattern(/@gmail\.com$/).required().messages({
      'string.empty': 'الرجاء إدخال البريد الإلكتروني',
      'string.email': 'صيغة البريد الإلكتروني غير صحيحة',
      'string.pattern.base': 'البريد الإلكتروني يجب أن يكون @gmail.com فقط',
      'any.required': 'البريد الإلكتروني مطلوب'
    }),

    // التعديل هنا: إجباري + 11 رقم بالضبط
    phone: Joi.string().pattern(/^[0-9]{11}$/).required().messages({
      'string.empty': 'الرجاء إدخال رقم الهاتف',
      'string.pattern.base': 'رقم الهاتف يجب أن يتكون من 11 رقم بالضبط',
      'any.required': 'رقم الهاتف مطلوب'
    }),

    role: Joi.string().valid('admin', 'pharmacist', 'delivery', 'cashier').required(),
    password: Joi.string().pattern(passwordRegex).required().messages({
      'string.pattern.base': passwordMessage,
      'any.required': 'الرجاء إدخال كلمة المرور'
    }),
    expectedDays: Joi.number().integer().min(1).max(31).optional(),
    dailyHours: Joi.number().integer().min(1).max(24).optional()
  }),

  updateUser: Joi.object({
    username: Joi.string().min(3).required(),
    fullName: Joi.string().required(),
    
    email: Joi.string().email().pattern(/@gmail\.com$/).required().messages({
      'string.empty': 'الرجاء إدخال البريد الإلكتروني',
      'string.email': 'صيغة البريد الإلكتروني غير صحيحة',
      'string.pattern.base': 'البريد الإلكتروني يجب أن يكون @gmail.com فقط',
      'any.required': 'البريد الإلكتروني مطلوب'
    }),

    // التعديل هنا أيضاً في حالة التحديث
    phone: Joi.string().pattern(/^[0-9]{11}$/).required().messages({
      'string.empty': 'الرجاء إدخال رقم الهاتف',
      'string.pattern.base': 'رقم الهاتف يجب أن يتكون من 11 رقم بالضبط',
      'any.required': 'رقم الهاتف مطلوب'
    }),

    role: Joi.string().valid('admin', 'pharmacist', 'delivery', 'cashier').required(),
    password: Joi.string().pattern(passwordRegex).optional().allow('', null).messages({
      'string.pattern.base': passwordMessage
    }),
    expectedDays: Joi.number().integer().min(1).max(31).optional(),
    dailyHours: Joi.number().integer().min(1).max(24).optional(),
    active: Joi.number().valid(0, 1).optional()
  }),

  medicine: Joi.object({
    name: Joi.string().required(),
    barcode: Joi.string().required(),
    expiryDate: Joi.date().iso().required(),
    quantity: Joi.number().min(0).required(),
    purchasePrice: Joi.number().min(0).required(),
    sellingPrice: Joi.number().min(0).required(),
    requiresPrescription: Joi.boolean().optional(),
    supplierId: Joi.string().optional().allow('', null),
    pillCount: Joi.number().integer().min(0).optional().allow(null),
    stripCount: Joi.number().integer().min(0).optional().allow(null),
    manufacturer: Joi.string().optional().allow('', null),
    genericName: Joi.string().optional().allow('', null),
    medicineForm: Joi.string().optional().allow('', null)
  }),

  login: Joi.object({
    username: Joi.string().required().messages({
      'string.empty': 'الرجاء إدخال اسم المستخدم',
      'any.required': 'الرجاء إدخال اسم المستخدم'
    }),
    password: Joi.string().required().messages({
      'string.empty': 'الرجاء إدخال كلمة المرور',
      'any.required': 'الرجاء إدخال كلمة المرور'
    })
  }),

  supplier: Joi.object({
    name: Joi.string().required(),
    phones: Joi.array().items(Joi.string()).optional(),
    address: Joi.string().optional().allow('', null)
  }),

  sale: Joi.object({
    paymentMethod: Joi.string()
      .valid('cash', 'card', 'wallet', 'insurance')
      .required(),

    forceInteraction: Joi.boolean()
      .optional()
      .default(false),

    items: Joi.array()
      .items(
        Joi.object({
          medicineId: Joi.string().required(),
          qty: Joi.number().positive().required(),
          quantityType: Joi.string()
            .valid('box', 'strip', 'pill')
            .required(),

          stripCount: Joi.number()
            .integer()
            .min(0)
            .optional()
            .allow(null),

          pillCount: Joi.number()
            .integer()
            .min(0)
            .optional()
            .allow(null)
        })
      )
      .min(1)
      .required()
  }),

  returnSale: Joi.object({
    saleId: Joi.string().required(),
    returnedItems: Joi.array().items(
      Joi.object({
        saleItemId: Joi.string().required(),
        qtyToReturn: Joi.number().positive().required()
      })
    ).min(1).required()
  })
};

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);

    if (error) {
      return res.status(400).json({
        error: error.details[0].message
      });
    }

    next();
  };
};

module.exports = { schemas, validateRequest };