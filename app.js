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
    headless: true,  // Установите headless в false, чтобы видеть браузер
    userDataDir: './user_data',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=fr-FR'],
    defaultViewport: null
  });

  const page = await browser.newPage();

  try {
    console.log("Начинаем загрузку страницы...");
    await page.goto('https://chatgpt.com/chat', { waitUntil: 'domcontentloaded' });

    // Логируем HTML страницы после загрузки
    const initialContent = await page.content();
    console.log("HTML страницы после загрузки:");
    console.log(initialContent);

    // ✅ Попытка кликнуть по кнопке "Stay logged out" или "Rester déconnecté"
    try {
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('button')].some(el => {
          const text = el.innerText.trim().toLowerCase();
          return text === 'stay logged out' || text === 'rester déconnecté';
        });
      }, { timeout: 5000 }); // Увеличиваем тайм-аут

      await page.$$eval('button', buttons => {
        const target = buttons.find(button => {
          const text = button.innerText.trim().toLowerCase();
          return text === 'stay logged out' || text === 'rester déconnecté';
        });
        if (target) target.click();
      });

      console.log("Pop-up détecté. Bouton 'Stay logged out' ou 'Rester déconnecté' cliqué.");
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.log("Aucun bouton 'Stay logged out' / 'Rester déconnecté' détecté dans le délai imparti.");
    }

    // 📝 Ожидание поля ввода и ввод запроса
    try {
      console.log("Ожидание элемента #prompt-textarea...");
      await page.waitForSelector('#prompt-textarea', { timeout: 5000 });
      console.log("Champ de texte trouvé.");
    } catch (err) {
      console.error("Ошибка при поиске #prompt-textarea:", err.message);
      const pageContent = await page.content();
      console.log("HTML страницы после ошибки:");
      console.log(pageContent); // Выводим код страницы при ошибке
      return res.status(500).json({ error: 'Failed to find #prompt-textarea', details: err.message });
    }

    // Логируем HTML страницы после нахождения поля ввода
    const pageContentAfterInput = await page.content();
    console.log("HTML страницы после нахождения поля ввода:");
    console.log(pageContentAfterInput);

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
    console.log("HTML страницы при ошибке:");
    console.log(content);  // Выводим код страницы при ошибке
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
