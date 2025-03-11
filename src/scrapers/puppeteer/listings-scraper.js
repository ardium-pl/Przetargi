const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const BaseScraper = require('../base/base-scraper');
const {getRandomUserAgent} = require('../../utils/helpers/browser-helpers');
const config = require('../../utils/config/config');
const {createLogger} = require('../../utils/logger/logger');

const logger = createLogger(__filename);

/**
 * Scraper implementation using Puppeteer for web scraping tenders
 */
class PuppeteerListingsScraper extends BaseScraper {
    constructor() {
        super('PUPPETEER');
        puppeteer.use(StealthPlugin());
        this.browser = null;
    }

    async scrape(keyword = 'microsoft') {
        await this.initialize();
        let browser = null;
        let page = null;

        try {
            logger.info('Launching browser...');
            browser = await puppeteer.launch({
                ...config.puppeteer.launch,
                args: [
                    ...config.puppeteer.launch.args,
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            });
            this.browser = browser;
            page = await browser.newPage();

            // Set up browser configurations
            await this.setupBrowser(page);

            // Navigate and perform search
            await this.navigateAndSearch(page, keyword);

            // Process pagination and scrape data (with retry logic)
            const tenders = await this.processPagination(page);

            logger.info(`Scraping completed. Total tenders found: ${tenders.length}`);
            return tenders;
        } catch (error) {
            logger.error('Error in scrape:', error);
            throw error;
        } finally {
            await this.cleanup(browser, page);
        }
    }

    /**
     * Configure browser settings.
     * @param {Page} page - Puppeteer page instance.
     */
    async setupBrowser(page) {
        page.on('error', err => logger.error('Page error:', JSON.stringify(err, null, 2)));
        await page.setViewport({width: 1920, height: 1080});
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'max-age=0'
        });
        // const userAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        const userAgent = getRandomUserAgent();
        await page.setUserAgent(userAgent);
    }

    /**
     * Navigate to base URL and perform keyword search.
     * @param {Page} page - Puppeteer page instance.
     * @param {string} keyword - Search keyword.
     */
    async navigateAndSearch(page, keyword) {
        const response = await page.goto(config.baseUrl, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        // Allow 304 (Not Modified) responses as acceptable
        if (response.status() !== 304 && !response.ok()) {
            throw new Error(`Page load failed with status: ${response.status()}`);
        }

        if (keyword) {
            const inputElement = await page.waitForSelector(config.selectors.searchInput, {
                timeout: 30000,
                visible: true
            });
            await inputElement.type(keyword, {delay: 100});
            logger.info('Clicking search button...');
            await page.waitForSelector('.app-button.btn.btn-secondary.btn-block', {
                visible: true,
                timeout: 30000
            });
            await page.click('.app-button.btn.btn-secondary.btn-block');

            logger.info('Waiting for search results...');
            await page.waitForSelector('lib-table', {timeout: 30000, visible: true});
            // Extra wait for table update if scanning is enabled
            if (config.scanning) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            await page.waitForSelector('lib-table', {timeout: 30000, visible: true});
        }
    }


    /**
     * Process pagination and scrape tender data.
     * Includes retry logic for TargetCloseError and recreates page if needed.
     * @param {Page} page - Puppeteer page instance.
     * @returns {Promise<Array>} - Array of scraped tenders.
     */
    async processPagination(page) {
        await page.waitForSelector('.pagination-container', {timeout: 30000});

        // Dodajemy style dla wizualizacji skanowania
        if (config.scanning) {
            await page.addStyleTag({
                content: `
                .page-scanning {
                    border: 2px solid #4CAF50 !important;
                    position: relative;
                }
                .page-scanning::before {
                    content: "Scanning...";
                    position: fixed;
                    top: 0;
                    right: 0;
                    background: #4CAF50;
                    color: white;
                    padding: 5px 10px;
                    border-radius: 0 0 0 5px;
                    z-index: 1000;
                }
            `
            });
        }

        const allTenders = [];
        let pageNumber = 1;
        let consecutiveErrors = 0;
        const MAX_CONSECUTIVE_ERRORS = 3;

        while (pageNumber <= 1000) {
            let retryCount = 0;
            const maxRetries = 3;
            let success = false;

            while (retryCount < maxRetries && !success) {
                try {
                    await page.waitForFunction(
                        () => document.querySelectorAll('tbody tr').length > 0,
                        {timeout: 10000}
                    );
                    logger.info(`======= Scanning Page ${pageNumber} =======`);

                    // Dodajemy wizualny znacznik skanowania
                    if (config.scanning) {
                        await page.evaluate(() => {
                            const table = document.querySelector('lib-table');
                            if (table) table.classList.add('page-scanning');
                        });
                    }

                    const pageTenders = await this.scrapeCurrentPage(page);

                    // Usuwamy wizualny znacznik po skanowaniu
                    if (config.scanning) {
                        await page.evaluate(() => {
                            const table = document.querySelector('lib-table');
                            if (table) table.classList.remove('page-scanning');
                        });
                    }

                    if (pageTenders.length > 0) {
                        await this.saveListings(pageTenders);
                        allTenders.push(...pageTenders);
                        logger.info(`✓ Page ${pageNumber} completed - Found ${pageTenders.length} tenders`);
                        logger.info(`Total tenders collected: ${allTenders.length}`);
                    }
                    success = true;
                    consecutiveErrors = 0; // Reset tylko po pełnym sukcesie

                } catch (error) {
                    retryCount++;
                    logger.warn(`Error on page ${pageNumber}. Retry attempt ${retryCount}/${maxRetries}...`);

                    if (error.name === 'TargetCloseError' || error.message.includes('detached')) {
                        try {
                            // Jeśli strona jest zamknięta, tworzymy nową i reinicjalizujemy
                            if (page.isClosed()) {
                                logger.info('Page is closed. Opening a new page...');
                                page = await this.browser.newPage();
                                await this.setupBrowser(page);
                                await page.goto(config.baseUrl, {
                                    waitUntil: 'networkidle2',
                                    timeout: 60000
                                });
                                await this.navigateAndSearch(page, 'microsoft');

                                // Nawigacja do aktualnej strony
                                for (let i = 1; i < pageNumber; i++) {
                                    await page.click('.btn.btn-sm.btn-outline-secondary.append-arrow');
                                    await page.waitForFunction(
                                        () => document.querySelectorAll('tbody tr').length > 0,
                                        {timeout: 10000}
                                    );
                                    await new Promise(r => setTimeout(r, config.scanning ? 1000 : 100));
                                }
                            } else {
                                await page.reload({waitUntil: 'networkidle0'});
                            }
                            await new Promise(r => setTimeout(r, 2000));
                        } catch (reloadError) {
                            logger.error(`Reload failed on retry attempt ${retryCount}:`, reloadError);
                            if (retryCount === maxRetries) {
                                consecutiveErrors++;
                            }
                        }
                    } else {
                        consecutiveErrors++;
                        logger.error(`Error scanning page ${pageNumber}:`, error);
                        break;
                    }
                }
            }

            // Jeśli wszystkie próby nie powiodły się, restartujemy przeglądarkę
            if (!success && consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                logger.info('Maximum consecutive errors reached. Relaunching browser...');

                try {
                    await this.cleanup(this.browser, page);

                    // Dodajemy opóźnienie przed ponownym uruchomieniem
                    await new Promise(r => setTimeout(r, 5000));

                    this.browser = await puppeteer.launch({
                        ...config.puppeteer.launch,
                        args: [
                            ...config.puppeteer.launch.args,
                            '--disable-web-security',
                            '--disable-features=IsolateOrigins,site-per-process'
                        ]
                    });

                    page = await this.browser.newPage();
                    await this.setupBrowser(page);
                    await page.goto(config.baseUrl, {
                        waitUntil: 'networkidle2',
                        timeout: 60000
                    });

                    await this.navigateAndSearch(page, 'microsoft');

                    // // Nawigacja do ostatniej strony
                    // for (let i = 1; i < pageNumber; i++) {
                    //     logger.info(`Recovering pagination - navigating to page ${i}`);
                    //     const nextPageInfo = await this.checkNextPage(page);
                    //     if (!nextPageInfo.exists || nextPageInfo.isDisabled || !nextPageInfo.hasData) {
                    //         logger.info('Reached the end of results or no more data available');
                    //         break;
                    //     }
                    //     await page.click('.btn.btn-sm.btn-outline-secondary.append-arrow');
                    //     await page.waitForFunction(
                    //         () => document.querySelectorAll('tbody tr').length > 0,
                    //         {timeout: 10000}
                    //     );
                    //     await new Promise(r => setTimeout(r, config.scanning ? 1000 : 100));
                    // }
                    // Nawigacja do ostatniej strony
                    try {
                        for (let i = 1; i < pageNumber; i++) {
                            logger.info(`Recovering pagination - navigating to page ${i}`);
                            const nextPageInfo = await this.checkNextPage(page);
                            if (!nextPageInfo.exists || nextPageInfo.isDisabled || !nextPageInfo.hasData) {
                                logger.info('Reached the end of results or no more data available');
                                break;
                            }
                            await page.click('.btn.btn-sm.btn-outline-secondary.append-arrow');
                            await page.waitForFunction(
                                () => document.querySelectorAll('tbody tr').length > 0,
                                {timeout: 10000}
                            );
                            await new Promise(r => setTimeout(r, config.scanning ? 1000 : 100));
                        }
                    } catch (navigationError) {
                        logger.error('Error during pagination recovery:', navigationError);

                        // Zabijamy starą przeglądarkę
                        await this.cleanup(this.browser, page);

                        // Otwieramy nową
                        this.browser = await puppeteer.launch({
                            ...config.puppeteer.launch,
                            args: [
                                ...config.puppeteer.launch.args,
                                '--disable-web-security',
                                '--disable-features=IsolateOrigins,site-per-process'
                            ]
                        });

                        page = await this.browser.newPage();
                        await this.setupBrowser(page);
                        await page.goto(config.baseUrl, {
                            waitUntil: 'networkidle2',
                            timeout: 60000
                        });
                        await this.navigateAndSearch(page, 'microsoft');

                        // Kontynuujemy pętlę
                        continue;
                    }

                    consecutiveErrors = 0;
                    continue;
                } catch (error) {
                    logger.error('Failed to relaunch browser:', error);
                    throw error;
                }
            }

            if (success) {
                const nextPageInfo = await this.checkNextPage(page);
                if (!nextPageInfo.exists || nextPageInfo.isDisabled) break;

                try {
                    const currentPageContent = await page.evaluate(() => document.querySelector('tbody')?.innerHTML || '');
                    await page.click('.btn.btn-sm.btn-outline-secondary.append-arrow');

                    await page.waitForFunction(
                        oldContent => {
                            const newContent = document.querySelector('tbody')?.innerHTML || '';
                            return newContent !== oldContent && document.querySelectorAll('tbody tr').length > 0;
                        },
                        {timeout: 5000},
                        currentPageContent
                    );

                    await new Promise(r => setTimeout(r, config.scanning ? 1000 : 100));
                    pageNumber++;
                } catch (navError) {
                    logger.error(`Navigation error on page ${pageNumber}:`, navError);
                    consecutiveErrors++;
                }
            } else {
                // Jeśli nie osiągnęliśmy sukcesu ale nie przekroczyliśmy limitu błędów
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        return allTenders;
    }

    /**
     * Scrape data from the current page.
     * @param {Page} page - Puppeteer page instance.
     * @returns {Promise<Array>} - Array of tenders from the current page.
     */
    async scrapeCurrentPage(page) {
        await page.waitForSelector('tbody tr', {timeout: 30000, visible: true});
        if (config.scanning) {
            await page.addStyleTag({
                content: `
                    .scanning {
                        background-color: #f0f8ff !important;
                        transition: background-color 0.3s ease-in-out;
                        box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    }
                `
            });
        }
        const tenders = [];
        const rows = await page.$$('tbody tr');

        // Use a delay value based on scanning mode
        const delay = config.scanning ? 300 : 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            // Highlight current row for visual effect if scanning is enabled
            if (config.scanning) {
                await page.evaluate((row) => {
                    row.classList.add('scanning');
                    row.scrollIntoView({behavior: 'smooth', block: 'center'});
                }, row);
            }

            // Extract data from the row
            const tender = await page.evaluate(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                return {
                    title: cells[0]?.textContent?.trim(),
                    number: cells[1]?.textContent?.trim(),
                    status: cells[2]?.textContent?.trim(),
                    publicationDate: cells[3]?.textContent?.trim(),
                    link: row.querySelector('a')?.href
                };
            }, row);

            tenders.push(tender);
            logger.info(`Scanning tender: ${tender.title.substring(0, 50)}...`);

            // Delay for visual effect (if scanning is on)
            if (delay) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            // Remove highlight if scanning is enabled
            if (config.scanning) {
                await page.evaluate((row) => {
                    row.classList.remove('scanning');
                }, row);
            }
        }

        return tenders;
    }

    /**
     * Check the status of the "next page" button.
     * @param {Page} page - Puppeteer page instance.
     * @returns {Promise<Object>} - Object with exists and isDisabled properties.
     */
    // async checkNextPage(page) {
    //     const selector = '.btn.btn-sm.btn-outline-secondary.append-arrow';
    //     const nextButton = await page.$(selector);
    //     if (!nextButton) return {exists: false};
    //     const buttonText = await page.evaluate(btn => btn.textContent.trim(), nextButton);
    //     const isDisabled = await page.evaluate(btn =>
    //             btn.classList.contains('disabled') || btn.hasAttribute('disabled'),
    //         nextButton
    //     );
    //     return {
    //         exists: buttonText.includes('Następna'),
    //         isDisabled
    //     };
    // }
    async checkNextPage(page) {
        const selector = '.btn.btn-sm.btn-outline-secondary.append-arrow';
        const nextButton = await page.$(selector);

        // Dodajemy sprawdzenie całkowitej liczby ogłoszeń
        const totalResultsText = await page.evaluate(() => {
            const element = document.querySelector('.mat-mdc-paginator-range-label');
            return element ? element.textContent.trim() : '';
        });

        logger.info(`Pagination info: ${totalResultsText}`);

        if (!nextButton) return { exists: false };

        const buttonText = await page.evaluate(btn => btn.textContent.trim(), nextButton);
        const isDisabled = await page.evaluate(btn =>
                btn.classList.contains('disabled') || btn.hasAttribute('disabled'),
            nextButton
        );

        const currentPageHasData = await page.evaluate(() => {
            const rows = document.querySelectorAll('tbody tr');
            return rows.length > 0;
        });

        return {
            exists: buttonText.includes('Następna'),
            isDisabled,
            hasData: currentPageHasData
        };
    }


    /**
     * Cleanup resources.
     * @param {Browser} browser - Puppeteer browser instance.
     * @param {Page} page - Puppeteer page instance.
     */
    async cleanup(browser, page) {
        if (page && !page.isClosed()) {
            try {
                await page.close();
            } catch (error) {
                logger.error('Error closing page:', error);
                console.log('Error closing page:', error);
            }
        }
        if (browser) {
            try {
                await browser.close();
            } catch (error) {
                logger.error('Error closing browser:', error);
                console.log('Error closing browser:', error);
            }
        }
    }
}

module.exports = new PuppeteerListingsScraper();
