const fs = require('fs');
const { firefox } = require('playwright');
const cron = require('node-cron');

const baseUrl = 'https://www.ss.lv/ru/transport/spare-parts/today/';
const pageCount = 1;

// Создаем функцию для сохранения ссылок в файл
function saveLinksToFile(links) {
  fs.writeFileSync('checked_links.txt', links.join('\n'), 'utf8');
}

// Создаем функцию для загрузки ссылок из файла
function loadLinksFromFile() {
  if (fs.existsSync('checked_links.txt')) {
    return fs.readFileSync('checked_links.txt', 'utf8').split('\n');
  }
  return [];
}

async function scrapePage(browser, context, url, checkedLinks) {
  try {
    const page = await context.newPage();
    await page.goto(url);

    const ads = await page.evaluate(() => {
      const adElements = Array.from(document.querySelectorAll('a[id^="dm_"]'));
      const ads = [];

      for (let i = 0; i < adElements.length; i++) {
        const adElement = adElements[i];
        const adId = adElement.getAttribute('id');
        const adUrl = adElement.href;

        ads.push({
          id: adId,
          url: adUrl,
          combinedValue: null,
          phTdValue: null,
          contactsValue: null,
        });
      }

      return ads;
    });

    await page.close();

    return ads.filter(ad => !checkedLinks.includes(ad.url)); // Исключаем уже проверенные ссылки
  } catch (error) {
    console.error('Error scraping page:', error);
    return [];
  }
}

async function scrapeAds() {
  try {
    const browser = await firefox.launch();
    const context = await browser.newContext();

    const allAds = [];
    const checkedLinks = loadLinksFromFile(); // Загружаем проверенные ссылки из файла

    for (let page = 1; page <= pageCount; page++) {
      const pageUrl = page === 1 ? baseUrl : `${baseUrl}page${page}.html`;
      const ads = await scrapePage(browser, context, pageUrl, checkedLinks);
      allAds.push(...ads);
      console.log(`Page ${page} processed. Total ads found: ${ads.length}`);
    }

    const totalAdsCount = allAds.length;
    let processedAdsCount = 0;

    let filteredAds = [];
    if (fs.existsSync('combine.txt')) {
      const combinedValues = fs.readFileSync('combine.txt', 'utf8').split('\n');
      filteredAds = combinedValues.map(combinedValue => ({
        combinedValue,
        phTdValue: null,
        contactsValue: null,
      }));
    }

    for (let i = 0; i < totalAdsCount; i++) {
      const ad = allAds[i];
      const page = await context.newPage();
      await page.goto(ad.url);

      const adViews = await page.$eval('#show_cnt_stat', (viewsElement) => {
        return viewsElement ? parseInt(viewsElement.textContent) : 0;
      });

      processedAdsCount++;
      const progress = Math.floor((processedAdsCount / totalAdsCount) * 100);
      console.log(`Processed ${processedAdsCount}/${totalAdsCount} ads (${progress}%).`);

      const phTdValue = await page.$eval('#ph_td_1', (phTdElement) => {
        return phTdElement ? phTdElement.textContent.trim() : '';
      });

      const contactsValue = await page.evaluate(() => {
        const selector1 = '.contacts_table > tbody:nth-child(1) > tr:nth-child(4) > td:nth-child(2)';
        const selector2 = '.contacts_table > tbody:nth-child(1) > tr:nth-child(5) > td:nth-child(2)';

        const contactsElement1 = document.querySelector(selector1);
        const contactsElement2 = document.querySelector(selector2);

        if (contactsElement1) {
          return contactsElement1.textContent.trim();
        } else if (contactsElement2) {
          return contactsElement2.textContent.trim();
        } else {
          return '';
        }
      });

      const combinedValue = `${phTdValue} - ${contactsValue}`;

      const isUnique = !filteredAds.some((existingAd) => {
        return existingAd.combinedValue === combinedValue;
      });

      const hasInvalidSelectors = await page.evaluate(() => {
        const invalidSelectors = ['#usr_logo', '#phtd > a:nth-child(1)', '#emtd > a:nth-child(1)', '.contacts_table > tbody:nth-child(1) > tr:nth-child(6) > td:nth-child(1)'];
        return invalidSelectors.some(selector => !!document.querySelector(selector));
      });

      const hasInvalidText = await page.evaluate(() => {
        const adDescriptionElement = document.querySelector('.amiddle > div > div > table:nth-child(2) > tbody > tr:nth-child(3) > td:nth-child(2)');
        return adDescriptionElement && adDescriptionElement.textContent.includes('WWW:');
      });

      if (adViews < 10 && !hasInvalidSelectors && !hasInvalidText && isUnique) {
        ad.views = adViews;
        ad.combinedValue = combinedValue;
        ad.phTdValue = phTdValue;
        ad.contactsValue = contactsValue;
        filteredAds.push(ad);
      }

      await page.close();
    }


    await browser.close();


    // Сохраняем проверенные ссылки в файл
    const allLinks = allAds.map(ad => ad.url);
    checkedLinks.push(...allLinks);
    saveLinksToFile(checkedLinks);

    // Сохранение combinedValue в файл combine.txt
    const combinedValuesToSave = filteredAds.map(ad => ad.combinedValue).join('\n');
    fs.writeFileSync('combine.txt', combinedValuesToSave, 'utf8');
    console.log('Combined values saved to combine.txt.');

    // Сохранение URL объявлений в файл ads.txt
    const adsText = filteredAds
      .filter(ad => ad.url && ad.url.trim() !== '') // Проверяем, что URL существует и не является пустой строкой
      .map(ad => `${ad.url}`)
      .join('\n');
    fs.writeFileSync('ads.txt', adsText, { encoding: 'utf8', flag: 'a' });
    console.log('Scraping completed. Ads saved to ads.txt.');
  } catch (error) {
    console.error('Error scraping ads:', error);
  }
}

// Запуск функции scrapeAds каждую минуту
cron.schedule('* * * * *', () => {
  console.log('Starting scraping...');
  scrapeAds();
});

console.log('Cron job started.');
