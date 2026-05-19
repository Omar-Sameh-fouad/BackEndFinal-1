const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '123456', 
  database: process.env.DB_NAME || 'careplus_db',
  waitForConnections: true,
  multipleStatements: true // <-- هذا السطر ضروري جداً
  connectionLimit: 10
};

const pool = mysql.createPool(dbConfig);

module.exports = pool;

