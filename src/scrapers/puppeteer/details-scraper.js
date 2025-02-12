const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const BaseScraper = require('../base/base-scraper');
const config = require('../../utils/config/config');
const {createLogger} = require('../../utils/logger/logger');
const SCRAPER_TYPES = require('../../scrapers/base/scraper-types');
const OpenAI = require('openai');
const {getRandomUserAgent} = require("../../utils/helpers/browser-helpers");


const logger = createLogger(__filename);

const BrowserMode = {
    LOCAL: 'local',
    SERVER: 'server'
}

class DetailedScraperWorker extends BaseScraper {
    constructor() {
        super(SCRAPER_TYPES.DETAILED);
        this.db = null;
        this.browser = null;
        this.page = null;
        puppeteer.use(StealthPlugin());
    }

    async initialize() {
        if (!this.db) {
            const db = require('../../utils/database/mongo');
            await db.connect();
            this.db = db;
            logger.info('DetailedScraperWorker database initialized');
        }
    }

    async initBrowser() {
        if (this.browser) {
            await this.cleanup();
        }

        this.browser = await puppeteer.launch({
            product: 'chrome',
            executablePath: process.env.CHROME_PATH || undefined,
            headless: config.puppeteer.launch.headless,
            defaultViewport: {
                width: 1920,
                height: 1080
            },
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
            ]
        });

        this.page = await this.browser.newPage();
        // await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        await this.page.setUserAgent(getRandomUserAgent());
        await this.page.setViewport({width: 1920, height: 1080});
    }

    async cleanup() {
        if (this.page && !this.page.isClosed()) {
            await this.page.close().catch(() => {
            });
        }
        if (this.browser) {
            const pages = await this.browser.pages().catch(() => []);
            await Promise.all(pages.map(p => p.close().catch(() => {
            })));
            await this.browser.close().catch(() => {
            });
        }
        this.page = null;
        this.browser = null;
    }

    async injectStyles() {
        await this.page.addStyleTag({
            content: `
                .overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.8);
                    z-index: 999999;
                }
                .analysis-container {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: white;
                    padding: 30px;
                    border-radius: 15px;
                    box-shadow: 0 8px 16px rgba(0,0,0,0.2);
                    z-index: 1000000;
                    width: 70%;
                    max-width: 800px;
                    font-family: Arial, sans-serif;
                }
                .progress-container {
                    background: #f0f0f0;
                    border-radius: 10px;
                    overflow: hidden;
                    margin: 20px 0;
                }
                .progress-bar {
                    height: 25px;
                    background: linear-gradient(90deg, #4CAF50, #45a049);
                    width: 0%;
                    transition: width 0.5s;
                    text-align: center;
                    line-height: 25px;
                    color: white;
                    font-weight: bold;
                }
                .status-text {
                    text-align: center;
                    margin: 15px 0;
                    font-size: 18px;
                    font-weight: bold;
                    color: #333;
                }
                .stats-panel {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                    margin: 15px 0;
                    font-size: 14px;
                }
                .keywords-list {
                    margin-top: 15px;
                    padding: 15px;
                    background: #f5f5f5;
                    border-radius: 8px;
                }
                .keyword-tag {
                    display: inline-block;
                    margin: 5px;
                    padding: 5px 10px;
                    background: #e3f2fd;
                    border-radius: 15px;
                    font-size: 13px;
                }
                .tender-header {
                    margin-bottom: 15px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid #eee;
                }
            `
        });
    }

    async setupAnalysisUI(tender) {
        await this.page.evaluate(({title, number}) => {
            document.body.style.visibility = 'hidden';

            const overlay = document.createElement('div');
            overlay.className = 'overlay';

            const container = document.createElement('div');
            container.className = 'analysis-container';
            container.innerHTML = `
                <div class="tender-header">
                    <h3 style="margin: 0 0 10px 0;">Analyzing Tender</h3>
                    <div style="font-size: 14px; color: #666;">
                        <div>Number: ${number}</div>
                        <div>Title: ${title}</div>
                    </div>
                </div>
                <div class="progress-container">
                    <div class="progress-bar">0%</div>
                </div>
                <div class="status-text">Initializing...</div>
                <div class="stats-panel"></div>
                <div class="keywords-list"></div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(container);
            document.body.style.visibility = 'visible';
        }, {
            title: tender.title,
            number: tender.number
        });
    }

    async analyzeContent(content) {
        const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

        await this.updateProgress(25, 'Preparing content...');

        const inputTokens = Math.ceil(content.length / 4);
        const estimatedCost = (inputTokens * 0.00000015) + (100 * 0.0000006);

        await this.updateProgress(50, 'Analyzing...', {
            input: inputTokens,
            output: 0,
            cost: estimatedCost
        });

        try {
            const systemPrompt = `Analyze tender notices specifically for Microsoft licensing and subscription services. Detect these patterns:

            1. Microsoft Services & Licensing:
            - Exchange Online, Microsoft 365/M365 (including E3/E5/Business variants)
            - Entra ID (formerly Azure AD)
            - Enterprise licensing agreements (EA, CSP, MPSA)
            - Microsoft product subscriptions and licenses
            - Microsoft cloud services (Azure, Exchange Online, Teams)
            
            2. Keywords (case insensitive, including Polish variants):
            - Licensing terms: "licencj", "subskrypcj", "subscription", "MPSA"
            - Product names: "Microsoft", "Exchange Online", "M365", "E3", "E5", "Entra", "Teams"
            - Service types: "cloud", "online", "Microsoft 365", "Azure"
            
            Return JSON:
            {
              "save": boolean (true if clearly Microsoft-specific licensing/services),
              "message": string (reasoning),
              "products": array (specific Microsoft products/services found),
              "agreement_type": string (if specified: EA, CSP, MPSA etc),
              "license_counts": object (product:quantity pairs),
                "values": {
                "net": number | null,
                "gross": number | null,
                "currency": string
            },
              "duration": string (subscription/license period if specified)
            }
            
            Exclude if:
            - Generic IT/software mentions without Microsoft specifics
            - Hardware/devices only
            - Non-licensing Microsoft mentions;
            Exclude if contains: edge, surface, xbox, hardware.
            For save=true, tender must clearly relate to Microsoft software/cloud licensing (not just generic IT/software mentions).
            Use null for missing values. Currency should be PLN if not specified otherwise.`;

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {role: "user", content}
                ],
                temperature: 0.2
            });

            const result = this.parseResponse(response);
            await this.updateProgress(100, 'Analysis complete', {
                input: response.usage.prompt_tokens,
                output: response.usage.completion_tokens,
                cost: (response.usage.prompt_tokens * 0.00000015) + (response.usage.completion_tokens * 0.0000006)
            });

            return result;
        } catch (error) {
            await this.updateProgress(100, 'Analysis failed');
            return {
                save: false,
                message: "API error",
                foundKeywords: [],
                exactMatches: {}
            };
        }
    }

    parseResponse(response) {
        try {
            const text = response.choices[0].message.content;
            const clean = text.replace(/```json\n|\n```/g, '').trim();
            const result = JSON.parse(clean);
            return {
                save: result.save || false,
                products: result.products || [],
                license_counts: result.license_counts || {},
                values: {
                    net: result.values?.net || null,
                    gross: result.values?.gross || null,
                    currency: result.values?.currency || 'PLN'
                },
                tender_id: result.tender_id || null,
                raw_response: result // zachowujemy pełną odpowiedź
            };
        } catch (e) {
            return {
                save: false,
                products: [],
                license_counts: {},
                values: { net: null, gross: null, currency: 'PLN' },
                tender_id: null,
                error: "Failed to parse response"
            };
        }
    }

    async updateProgress(percentage, status, stats = null) {
        await this.page.evaluate(({perc, stat, tokenStats}) => {
            const bar = document.querySelector('.progress-bar');
            const status = document.querySelector('.status-text');
            const statsPanel = document.querySelector('.stats-panel');

            if (bar) {
                bar.style.width = perc + '%';
                bar.innerText = perc + '%';
            }
            if (status) {
                status.innerText = stat;
            }
            if (tokenStats && statsPanel) {
                statsPanel.innerHTML = `
                    <div>Input tokens: ${tokenStats.input}</div>
                    <div>Output tokens: ${tokenStats.output}</div>
                    <div>Total cost: $${tokenStats.cost.toFixed(4)}</div>
                `;
            }
        }, {perc: percentage, stat: status, tokenStats: stats});
    }

    async updateResults(result) {
        await this.page.evaluate((data) => {
            const container = document.querySelector('.analysis-container');
            const keywordsList = document.querySelector('.keywords-list');

            if (container && keywordsList) {
                const productsHtml = data.products
                    .map(product => `<span class="keyword-tag">${product}</span>`)
                    .join('');

                const licensesHtml = Object.entries(data.license_counts)
                    .map(([product, count]) =>
                        `<span class="keyword-tag">${product}: ${count}</span>`
                    ).join('');

                keywordsList.innerHTML = `
                <div style="margin-bottom: 10px;">
                    <strong>Products Found:</strong><br>
                    ${productsHtml || 'None'}
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>License Counts:</strong><br>
                    ${licensesHtml || 'None'}
                </div>
                <div style="margin-bottom: 10px;">
                    <strong>Values:</strong><br>
                    Net: ${data.values.net ? data.values.net + ' ' + data.values.currency : 'Not specified'}<br>
                    Gross: ${data.values.gross ? data.values.gross + ' ' + data.values.currency : 'Not specified'}
                </div>
            `;

                container.style.background = data.save ? '#e8f5e9' : '#ffebee';
            }
        }, result);
    }

    async processTenderDetails(tender) {
        try {
            logger.info(`Processing tender: ${tender.number}`);
            await this.initBrowser();
            await this.page.goto(tender.link, {waitUntil: 'networkidle0'});

            await this.injectStyles();
            await this.setupAnalysisUI(tender);

            const content = await this.page.evaluate(() => document.documentElement.innerText);
            const result = await this.analyzeContent(content);
            await this.updateResults(result);

            if (result.save) {
                await this.db.saveTenderDetails({
                    tenderId: tender.number,
                    products: result.products,
                    license_counts: result.license_counts,
                    values: result.values,
                    originalTender: tender,
                    fullContent: content,
                    raw_analysis: result.raw_response,
                    processedAt: new Date()
                }, SCRAPER_TYPES.DETAILED);
                logger.info(`✓ Saved tender ${tender.number}`);
                return true; // Oznaczamy sukces
            } else {
                logger.info(`✗ Rejected tender ${tender.number}: ${result.message}`);
                await new Promise(r => setTimeout(r, 3000));
                return true; // To też jest prawidłowe zakończenie, tylko tender nie spełnił kryteriów
            }
        } catch (error) {
            logger.error(`Error processing tender ${tender.number}:`, error);

            // Jeśli to TargetCloseError, nie oznaczamy jako przetworzone
            return !(error.name === 'TargetCloseError' || error.message.includes('Requesting main frame too early!') ||
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed'));
        } finally {
            await this.cleanup();
        }
    }

    async startProcessing() {
        try {
            await this.initialize();
            const tenders = await this.db.findUnprocessedListings();
            logger.info(`Found ${tenders.length} unprocessed tenders`);

            for (const tender of tenders) {
                const processed = await this.processTenderDetails(tender);
                if (processed) {
                    await this.db.markListingAsProcessed(tender._id);
                } else {
                    logger.info(`Tender ${tender.number} will be processed again in next run`);
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (error) {
            logger.error('Critical error:', error);
            throw error;
        } finally {
            await this.db.disconnect().catch(() => {
            });
        }
    }
}


module.exports = new DetailedScraperWorker();