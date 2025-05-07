const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const port = 3000;

// Эндпоинт, который принимает URL
app.get('/get-title', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Получаем HTML контент страницы
    const response = await axios.get(url);
    const html = response.data;

    // Используем cheerio для парсинга HTML
    const $ = cheerio.load(html);
    const title = $('title').text();

    // Отправляем найденный title
    if (title) {
      res.json({ title });
    } else {
      res.status(404).json({ error: 'Title not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch the URL' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
