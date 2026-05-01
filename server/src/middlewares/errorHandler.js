const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(`${err.name}: ${err.message}\n${err.stack}`);
  
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    ok: false,
    error: err.message || 'Internal Server Error'
  });
};

module.exports = errorHandler;
