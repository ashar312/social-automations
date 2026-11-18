require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'social_automations',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  dialect: 'mysql',
  timezone: '+00:00',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
  dialectOptions: { charset: 'utf8mb4' },
  define: { underscored: true, charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
  logging: false,
};

module.exports = { development: base, production: base, test: base };
