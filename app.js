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
    console.log("Начинаем загрузку страницы...");
    await page.goto('https://chatgpt.com/chat', { waitUntil: 'domcontentloaded' });
    console.log("Страница загружена.");

    // ✅ Попытка кликнуть по ссылке "Stay logged out" или "Rester déconnecté"
    try {
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('a')].some(el => {
          const text = el.innerText.trim().toLowerCase();
          return text === 'stay logged out' || text === 'rester déconnecté';
        });
      }, { timeout: 3333 }); // Увеличим тайм-аут до 5 секунд

      await page.$$eval('a', links => {
        const target = links.find(link => {
          const text = link.innerText.trim().toLowerCase();
          return text === 'stay logged out' || text === 'rester déconnecté';
        });
        if (target) target.click();
      });

      console.log("Pop-up détecté. Lien 'Stay logged out' cliqué.");
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.log("Aucun lien 'Stay logged out' / 'Rester déconnecté' détecté dans le délai imparti.");
    }

    // 📝 Ожидание поля ввода и ввод запроса
    try {
      console.log("Ожидание элемента #prompt-textarea...");
      await page.waitForSelector('#prompt-textarea', { timeout: 3333 }); // Увеличим тайм-аут до 5 секунд
      console.log("Champ de texte trouvé.");
    } catch (err) {
      console.error("Échec de la recherche du champ de texte:", err.message);
      const pageContent = await page.content();
      console.log("HTML de la page au moment de l'erreur :");
      console.log(pageContent); // Выводим код страницы при ошибке
      return res.status(500).json({ error: 'Failed to find #prompt-textarea', details: err.message });
    }

    // Выводим код страницы
    const pageContent = await page.content();
    console.log("HTML страницы получен:");
    console.log(pageContent);

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
    console.log(content); // Выводим код страницы при ошибке
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
