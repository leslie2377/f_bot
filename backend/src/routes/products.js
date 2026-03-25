const express = require('express');
const router = express.Router();
const { getProducts } = require('../services/dataService');

router.get('/', (req, res) => {
  const { network, sort } = req.query;
  const products = getProducts(network, sort);
  res.json({ products, total: products.length });
});

module.exports = router;
