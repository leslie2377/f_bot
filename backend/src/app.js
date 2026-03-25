require('dotenv').config();
const express = require('express');
const cors = require('cors');

const path = require('path');
const chatRouter = require('./routes/chat');
const productsRouter = require('./routes/products');
const faqRouter = require('./routes/faq');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/chat', chatRouter);
app.use('/api/products', productsRouter);
app.use('/api/faq', faqRouter);
app.use('/api/admin', adminRouter);

// 관리자 페이지 정적 파일 서빙
app.use('/admin', express.static(path.join(__dirname, '../../admin/dist')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'f_bot API' });
});

app.listen(PORT, () => {
  console.log(`f_bot API 서버 실행 중: http://localhost:${PORT}`);
});
