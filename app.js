const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

const app = express();
const port = 3000;

// Эндпоинт, который принимает параметр query
app.get('/get-links', async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: './user_data',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=fr-FR'],
    defaultViewport: null
  });

  const page = await browser.newPage();

  try {
    await page.goto('https://chatgpt.com/chat', { waitUntil: 'domcontentloaded' });

    // ✅ Попытка кликнуть по кнопке "Stay logged out" или "Rester déconnecté"
    try {
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('button')].some(el => {
          const text = el.innerText.trim().toLowerCase();
          return text === 'stay logged out' || text === 'rester déconnecté';
        });
      }, { timeout: 2000 });

      await page.$$eval('button', buttons => {
        const target = buttons.find(btn => {
          const text = btn.innerText.trim().toLowerCase();
          return text === 'stay logged out' || text === 'rester déconnecté';
        });
        if (target) target.click();
      });

      console.log("Pop-up détecté. Bouton 'Stay logged out' cliqué.");
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.log("Aucun bouton 'Stay logged out' / 'Rester déconnecté' détecté dans le délai imparti.");
    }

    // 📝 Ожидание поля ввода и ввод запроса
    await page.waitForSelector('#prompt-textarea', { timeout: 1000 });

    // Вводим запрос из параметра query
    await page.focus('#prompt-textarea');
    await page.keyboard.type(query, { delay: 50 });

    // 📤 Отправка запроса
    const sendButton = await page.$('#composer-submit-button');
    if (sendButton) {
      const isDisabled = await page.$eval('#composer-submit-button', btn => btn.disabled);
      if (!isDisabled) {
        await sendButton.click();
        console.log("Prompt envoyé.");
      } else {
        console.log("Le bouton d'envoi est désactivé.");
      }
    } else {
      console.log("Bouton d'envoi introuvable.");
    }

    // ⏳ Ожидание появления ответа
    await new Promise(r => setTimeout(r, 20000));

    // 🔗 Извлечение всех ссылок
    const links = await page.$$eval('a', anchors =>
      anchors.map(anchor => ({
        href: anchor.href,
        text: anchor.innerText.trim()
      })).filter(l => l.href)
    );

    // Отправляем найденные ссылки в ответ
    res.json({ query, links });

    await page.screenshot({ path: 'result_with_sources.png' });
  } catch (err) {
    console.error("Ошибка:", err.message);
    const content = await page.content();
    console.log("Content HTML page:");
    console.log(content);
    await page.screenshot({ path: 'error_page.png' });

    res.status(500).json({ error: 'Failed to fetch the links', details: err.message });
  } finally {
    await browser.close();
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
