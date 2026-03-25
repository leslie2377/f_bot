const express = require('express');
const router = express.Router();
const { getFaqs } = require('../services/dataService');

router.get('/', (req, res) => {
  const { category } = req.query;
  const faqs = getFaqs(category);
  res.json({ faqs, total: faqs.length });
});

module.exports = router;
