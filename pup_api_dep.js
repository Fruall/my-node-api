const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const port = 3000;

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
    console.log("⏳ Открытие ChatGPT...");
    await page.goto('https://chatgpt.com/chat', { waitUntil: 'networkidle2' });

    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.screenshot({ path: 'initial_page.png' });

    console.log("🔍 Looking for 'Stay logged out' link in the modal popup...");
    await page.screenshot({ path: 'login_modal.png' });

    const pageContent = await page.content();
    if (pageContent.includes('Thanks for trying ChatGPT')) {
      console.log("✅ Found the ChatGPT login modal popup (based on text)");
    }

    try {
      await page.waitForSelector('[role="dialog"]', { timeout: 1000 });
      console.log("✅ Modal detected (based on [role='dialog'])");

      const clickResult = await page.evaluate(() => {
        const elementsToTry = [
          ...Array.from(document.querySelectorAll('a, button')).filter(el =>
            el.textContent.trim().toLowerCase().includes('stay logged out') ||
            el.textContent.trim().toLowerCase().includes('rester déconnecté')
          ),
          document.querySelector('a.text-token-text-secondary.mt-5'),
          document.querySelector('[data-testid="modal-no-auth-rate-limit"] a.underline')
        ];

        for (let i = 0; i < elementsToTry.length; i++) {
          const element = elementsToTry[i];
          if (element) {
            console.log(`Found "Stay logged out" link/button with attempt ${i + 1}`);
            element.click();
            return { clicked: true, method: `attempt ${i + 1}` };
          }
        }
        return { clicked: false };
      });

      if (clickResult.clicked) {
        console.log(`✅ Clicked 'Stay logged out' link using ${clickResult.method}`);
      } else {
        console.log("❌ Could not find 'Stay logged out' link via JavaScript evaluate attempts.");
      }
    } catch (modalErr) {
      console.log("Modal not found or other error during modal handling:", modalErr.message);
      console.log("Continuing without explicit modal dismissal.");
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.screenshot({ path: 'after_modal_interaction_attempt.png' });

    const isModalStillThere = await page.evaluate(() => {
        return !!document.querySelector('[data-testid="modal-no-auth-rate-limit"]') ||
               !!document.querySelector('[role="dialog"]');
    });

    if (isModalStillThere) {
        console.warn("⚠️ Modal might still be visible. Check screenshot 'after_modal_interaction_attempt.png'.");
    }

    console.log("⌛ Waiting for input field...");
    let inputFieldFound = false;
    const inputSelectors = [
        '#prompt-textarea',
        'textarea[placeholder*="Message"]',
        'textarea[data-id="root"]',
        'textarea',
        '[contenteditable="true"]'
    ];
    let finalInputSelector = null;

    for (const selector of inputSelectors) {
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 1000 });
            console.log(`✅ Found input field with selector: ${selector}`);
            finalInputSelector = selector;
            inputFieldFound = true;
            break;
        } catch (err) {
            console.log(`❌ Selector "${selector}" not found or not visible.`);
        }
    }

    if (!inputFieldFound) {
        console.error("❌ Could not find any input field after multiple attempts.");
        const pageElements = await page.evaluate(() => ({ // Для отладки
            textareas: document.querySelectorAll('textarea').length,
            inputs: document.querySelectorAll('input').length,
            contentEditables: document.querySelectorAll('[contenteditable="true"]').length,
            buttons: Array.from(document.querySelectorAll('button')).map(b => b.outerHTML.substring(0,150)), // Начало HTML кнопок
            visibleText: Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, span')).slice(0, 10).map(el => el.textContent.trim()).filter(Boolean)
        }));
        console.log("Page analysis for missing input:", JSON.stringify(pageElements, null, 2));
        await page.screenshot({ path: 'input_field_not_found.png' });
        throw new Error("Could not interact with ChatGPT interface - no input field found");
    }

    console.log(`Typing into: ${finalInputSelector}`);
    await page.type(finalInputSelector, query, { delay: 50 });

    // --- НАЧАЛО ИЗМЕНЕННОГО БЛОКА ДЛЯ ОТПРАВКИ ---

    // Шаг 1: Опциональный клик по кнопке "Search"
    let specificSearchButtonClicked = false;
    console.log("🔍 (Опционально) Ищем специфическую кнопку 'Search'...");
    const specificSearchButtonSelectors = [
        'button[data-testid="composer-button-search"]',
        'button[aria-label="Search"]'
    ];

    for (const selector of specificSearchButtonSelectors) {
        try {
            const buttonElement = await page.waitForSelector(selector, { visible: true, timeout: 2000 });
            if (buttonElement) {
                await buttonElement.click();
                console.log(`✅ (Опционально) Кликнули по кнопке 'Search' используя селектор: ${selector}`);
                specificSearchButtonClicked = true;
                await new Promise(resolve => setTimeout(resolve, 500)); // Пауза после клика
                break;
            }
        } catch (err) {
            console.log(`🟡 (Опционально) Кнопка 'Search' с селектором "${selector}" не найдена или не кликабельна.`);
        }
    }

    if (specificSearchButtonClicked) {
        console.log("ℹ️ Кнопка 'Search' была нажата. Теперь ищем основную кнопку отправки.");
    } else {
        console.log("ℹ️ Кнопка 'Search' не была нажата или не найдена. Ищем основную кнопку отправки.");
    }

    // Шаг 2: Обязательный клик по основной кнопке отправки или нажатие Enter
    console.log("🔍 Ищем основную кнопку отправки ('Send prompt')...");
    const mainSendButtonSelectors = [
        'button#composer-submit-button',
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]'
    ];
    let mainSendButtonClicked = false;

    for (const selector of mainSendButtonSelectors) {
        try {
            const buttonElement = await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            if (buttonElement) {
                await buttonElement.click();
                console.log(`✅ Кликнули по основной кнопке отправки используя селектор: ${selector}`);
                mainSendButtonClicked = true;
                break;
            }
        } catch (err) {
            console.log(`🟡 Основная кнопка отправки с селектором "${selector}" не найдена или не кликабельна.`);
        }
    }

    if (!mainSendButtonClicked) {
        console.warn("❌ Не удалось найти или кликнуть основную кнопку отправки. Пробуем нажать Enter.");
        await page.keyboard.press('Enter');
    }
    console.log("📤 Запрос отправлен.");
    // --- КОНЕЦ ИЗМЕНЕННОГО БЛОКА ДЛЯ ОТПРАВКИ ---

    console.log("⏳ Ожидание ответа от ChatGPT...");
    try {
        await page.waitForFunction(() => {
                const stopGeneratingButton = document.querySelector('button[aria-label*="Stop generating"]');
                if (stopGeneratingButton) return false;
                const sendButtonStillActive = document.querySelector('button[data-testid="send-button"]:not(:disabled)'); // Проверяем, не активна ли снова кнопка отправки (старая)
                if (sendButtonStillActive && document.querySelector('#prompt-textarea')?.value === '') return false; // И поле ввода пусто
                // Более надежно: ждать появления нового блока ответа или исчезновения индикатора печати
                const thinkingIndicator = document.querySelector('.result-streaming') || document.querySelector('[class*="typing"]'); // Примерный селектор
                if(thinkingIndicator) return false;
                return true; // Считаем, что ответ получен, если нет явных индикаторов генерации
            },
            { timeout: 90000 } // Увеличенный таймаут
        );
        console.log("✅ Ответ от ChatGPT получен (или генерация остановлена/завершена).");
    } catch (waitErr) {
        console.warn("⚠️ Таймаут ожидания специфических индикаторов ответа. Продолжаем. Скриншот: 'before_collecting_links_timeout.png'");
        await page.screenshot({ path: 'before_collecting_links_timeout.png' });
    }

    await new Promise(resolve => setTimeout(resolve, 20000)); // Доп. время на рендеринг

    console.log("🔗 Сбор ссылок со страницы...");
    const links = await page.evaluate(() => {
        const contentArea = document.querySelector('main') || document.body;
        return Array.from(contentArea.querySelectorAll('a'))
            .map(anchor => ({
                href: anchor.href,
                text: anchor.innerText.trim()
            }))
            .filter(l => l.href && (l.href.startsWith('http://') || l.href.startsWith('https://')) && l.text);
    });

    console.log(`🔗 Найдено ${links.length} ссылок.`);
    await page.screenshot({ path: 'result_with_sources.png' });
    res.json({ query, links });

  } catch (err) {
    console.error("❌ Ошибка в основном блоке try:", err.message, err.stack);
    if (page && !page.isClosed()) {
        try {
            const content = await page.content();
            console.log("🔍 HTML во время ошибки (первые 1000 символов):");
            console.log(content.substring(0, 1000) + "...");
            await page.screenshot({ path: 'error_page.png' });
        } catch (secondaryError) {
            console.error("❌ Ошибка при создании скриншота или получении контента во время обработки ошибки:", secondaryError.message);
        }
    }
    res.status(500).json({ error: 'Failed to fetch links', details: err.message });
  } finally {
    if (browser) {
      await browser.close();
      console.log("Браузер закрыт.");
    }
  }
});

app.listen(port, () => {
  console.log(`✅ Сервер запущен на http://localhost:${port}`);
});
