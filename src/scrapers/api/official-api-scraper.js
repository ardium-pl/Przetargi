const BaseScraper = require('../base/base-scraper');
const SCRAPER_TYPES = require('../base/scraper-types');
const { createLogger } = require('../../utils/logger/logger');
const { getRandomUserAgent } = require('../../utils/helpers/browser-helpers');

const logger = createLogger(__filename);

class OfficialApiScraper extends BaseScraper {
    constructor() {
        super('OFFICIAL_API');
        this.baseUrl = 'http://ezamowienia.gov.pl/mo-board/api/v1';
    }

    async getNotices(page = 1, pageSize = 100) {
        const headers = {
            'accept': 'application/json',
            'accept-language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
            'content-type': 'application/json',
            'user-agent': getRandomUserAgent()
        };

        // Data od 2024-01-01 do teraz
        const now = new Date();
        const startOfYear = new Date('2024-01-01');

        const dateToStr = now.toISOString().split('T')[0];
        const dateFromStr = startOfYear.toISOString().split('T')[0];

        const params = new URLSearchParams({
            PublicationDateFrom: dateFromStr,
            PublicationDateTo: dateToStr,
            NoticeType: 'ContractNotice',
            page: page.toString(),
            pageSize: pageSize.toString(),
            sort: 'publicationDate,desc'
        });

        const url = `${this.baseUrl}/notice?${params.toString()}`;
        logger.debug(`Fetching BZP notices page ${page}:`, { url });

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                const text = await response.text();
                logger.error('API Error response:', text);
                throw new Error(`API request failed: ${response.status}`);
            }

            const notices = await response.json();

            if (!Array.isArray(notices)) {
                logger.error('Unexpected response format - not an array:', notices);
                return { items: [] };
            }

            // Filtrujemy tylko ogłoszenia BZP
            const bzpNotices = notices.filter(notice =>
                notice.bzpNumber && notice.bzpNumber.startsWith('2024/BZP')
            );

            logger.info(`Received ${bzpNotices.length} BZP notices from page ${page}`);

            // Mapujemy dane do bardziej użytecznego formatu
            const processedNotices = bzpNotices.map(notice => ({
                id: notice.bzpNumber,
                title: notice.orderObject || '',
                number: notice.noticeNumber || '',
                status: notice.noticeType || '',
                publicationDate: notice.publicationDate ? new Date(notice.publicationDate) : null,
                submittingOffersDate: notice.submittingOffersDate ? new Date(notice.submittingOffersDate) : null,
                orderType: notice.orderType || '',
                tenderType: notice.tenderType || '',
                cpvCodes: notice.cpvCode ? notice.cpvCode.split(',').map(code => code.trim()) : [],
                organization: {
                    name: notice.organizationName,
                    city: notice.organizationCity,
                    province: notice.organizationProvince,
                    country: notice.organizationCountry,
                    nationalId: notice.organizationNationalId,
                    id: notice.organizationId
                },
                tenderId: notice.tenderId,
                isBelowEU: notice.isTenderAmountBelowEU,
                htmlContent: notice.htmlBody,
                raw: notice
            }));

            return { items: processedNotices };

        } catch (error) {
            logger.error('Error fetching from official API:', error);
            throw error;
        }
    }

    async scrape(options = {}) {
        await this.initialize();

        try {
            let page = 1;
            let hasMore = true;
            const allNotices = [];
            const pageSize = 100;

            logger.info('Starting BZP notices scraping process...');

            while (hasMore && page <= 1000) { // Limit dla bezpieczeństwa
                logger.info(`Fetching page ${page}...`);
                const response = await this.getNotices(page, pageSize);

                if (!response.items || response.items.length === 0) {
                    hasMore = false;
                    logger.info('No more BZP notices available');
                    break;
                }

                if (response.items.length > 0) {
                    logger.info(`Saving ${response.items.length} BZP notices from page ${page}`);
                    await this.saveListings(response.items);
                    allNotices.push(...response.items);
                }

                // Jeśli dostaliśmy mniej niż pageSize, to znaczy że to ostatnia strona
                if (response.items.length < pageSize) {
                    hasMore = false;
                }

                page++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            logger.info(`Scraping completed. Total BZP notices processed: ${allNotices.length}`);
            return allNotices;

        } catch (error) {
            logger.error('Scraping failed:', error);
            logger.error('Error details:', error.stack);
            return [];
        } finally {
            await this.db.disconnect();
        }
    }
}

module.exports = new OfficialApiScraper();

