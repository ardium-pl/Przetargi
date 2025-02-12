// RANDOM DATA

// const BaseScraper = require('../base/base-scraper');
// const SCRAPER_TYPES = require('../base/scraper-types');
// const { createLogger } = require('../../utils/logger/logger');
// const { getRandomUserAgent } = require('../../utils/helpers/browser-helpers');
//
// const logger = createLogger(__filename);
//
// class OfficialApiScraper extends BaseScraper {
//     constructor() {
//         super('OFFICIAL_API');
//         this.baseUrl = 'http://ezamowienia.gov.pl/mo-board/api/v1';
//     }
//
//     async getNotices(page = 1, pageSize = 100) {
//         const headers = {
//             'accept': 'application/json',
//             'accept-language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
//             'content-type': 'application/json',
//             'user-agent': getRandomUserAgent()
//         };
//
//         // Ustaw zakres dat (ostatnie 90 dni)
//         const now = new Date();
//         const ninetyDaysAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
//
//         const dateToStr = now.toISOString().split('T')[0];
//         const dateFromStr = ninetyDaysAgo.toISOString().split('T')[0];
//
//         const params = new URLSearchParams({
//             PublicationDateFrom: dateFromStr,
//             PublicationDateTo: dateToStr,
//             NoticeType: 'ContractNotice',
//             page: page.toString(),
//             pageSize: pageSize.toString(),
//             sort: 'publicationDate,desc'
//         });
//
//         const url = `${this.baseUrl}/notice?${params.toString()}`;
//         logger.debug('Fetching notices from official API:', {
//             url,
//             dateFrom: dateFromStr,
//             dateTo: dateToStr,
//             page,
//             pageSize
//         });
//
//         try {
//             const response = await fetch(url, {
//                 method: 'GET',
//                 headers: headers
//             });
//
//             if (!response.ok) {
//                 const text = await response.text();
//                 logger.error('API Error response:', text);
//                 throw new Error(`API request failed: ${response.status} - ${text}`);
//             }
//
//             const notices = await response.json();
//
//             // API zwraca tablicę ogłoszeń
//             if (!Array.isArray(notices)) {
//                 logger.error('Unexpected response format - not an array:', notices);
//                 return { items: [] };
//             }
//
//             logger.info(`Received ${notices.length} notices from official API`);
//
//             if (notices.length > 0) {
//                 logger.debug('First notice:', JSON.stringify(notices[0], null, 2));
//             }
//
//             // Zwracamy w formacie kompatybilnym z resztą kodu
//             return { items: notices };
//
//         } catch (error) {
//             logger.error('Error fetching from official API:', error);
//             throw error;
//         }
//     }
//
//     async scrape(options = {}) {
//         await this.initialize();
//
//         try {
//             let page = 1;
//             let hasMore = true;
//             const allNotices = [];
//             const pageSize = 100;
//
//             logger.info('Starting official API scraping process...');
//
//             while (hasMore && page <= 1000) {
//                 logger.info(`Fetching page ${page}...`);
//                 const response = await this.getNotices(page, pageSize);
//
//                 if (!response.items || response.items.length === 0) {
//                     hasMore = false;
//                     logger.info('No more notices available');
//                     break;
//                 }
//
//                 const processedNotices = response.items.map(notice => ({
//                     id: notice.bzpNumber || notice.noticeNumber,
//                     title: notice.orderObject || '',
//                     number: notice.noticeNumber || notice.bzpNumber || '',
//                     status: notice.noticeType || '',
//                     publicationDate: notice.publicationDate ? new Date(notice.publicationDate) : null,
//                     clientType: notice.clientType,
//                     orderType: notice.orderType,
//                     tenderType: notice.tenderType,
//                     cpvCode: notice.cpvCode,
//                     isBelowEU: notice.isTenderAmountBelowEU,
//                     rawData: notice
//                 }));
//
//                 if (processedNotices.length > 0) {
//                     logger.info(`Saving ${processedNotices.length} notices from page ${page}`);
//                     await this.saveListings(processedNotices);
//                     allNotices.push(...processedNotices);
//                 }
//
//                 page++;
//                 await new Promise(resolve => setTimeout(resolve, 1000));
//             }
//
//             logger.info(`Scraping completed. Total notices processed: ${allNotices.length}`);
//             return allNotices;
//
//         } catch (error) {
//             logger.error('Scraping failed:', error);
//             logger.error('Error details:', error.stack);
//             return [];
//         } finally {
//             await this.db.disconnect();
//         }
//     }
// }
//
// module.exports = new OfficialApiScraper();

// TYPE DETECTORS
// const BaseScraper = require('../base/base-scraper');
// const SCRAPER_TYPES = require('../base/scraper-types');
// const { createLogger } = require('../../utils/logger/logger');
// const { getRandomUserAgent } = require('../../utils/helpers/browser-helpers');
//
// const logger = createLogger(__filename);
//
// class OfficialApiScraper extends BaseScraper {
//     constructor() {
//         super('OFFICIAL_API');
//         this.baseUrl = 'http://ezamowienia.gov.pl/mo-board/api/v1';
//     }
//
//     async getNotices(page = 1, pageSize = 100) {
//         const headers = {
//             'accept': 'application/json',
//             'accept-language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
//             'content-type': 'application/json',
//             'user-agent': getRandomUserAgent()
//         };
//
//         const now = new Date();
//         const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
//
//         const dateToStr = now.toISOString().split('T')[0];
//         const dateFromStr = thirtyDaysAgo.toISOString().split('T')[0];
//
//         const params = new URLSearchParams({
//             PublicationDateFrom: dateFromStr,
//             PublicationDateTo: dateToStr,
//             NoticeType: 'ContractNotice',
//             page: page.toString(),
//             pageSize: pageSize.toString(),
//             sort: 'publicationDate,desc'
//         });
//
//         const url = `${this.baseUrl}/notice?${params.toString()}`;
//         logger.debug('Fetching notices:', {
//             url,
//             dateFrom: dateFromStr,
//             dateTo: dateToStr,
//             page,
//             pageSize
//         });
//
//         try {
//             const response = await fetch(url, {
//                 method: 'GET',
//                 headers: headers
//             });
//
//             if (!response.ok) {
//                 const text = await response.text();
//                 logger.error('API Error response:', text);
//                 throw new Error(`API request failed: ${response.status} - ${text}`);
//             }
//
//             const notices = await response.json();
//
//             if (!Array.isArray(notices)) {
//                 logger.error('Unexpected response format - not an array:', notices);
//                 return { items: [] };
//             }
//
//             // Log szczegółów pierwszych kilku ogłoszeń żeby zobaczyć ich strukturę
//             if (notices.length > 0) {
//                 logger.info('First notice structure:', JSON.stringify(notices[0], null, 2));
//                 logger.info('Notice fields:', Object.keys(notices[0]));
//                 logger.info('Sample values:', {
//                     noticeType: notices[0].noticeType,
//                     noticeNumber: notices[0].noticeNumber,
//                     bzpNumber: notices[0].bzpNumber,
//                     tenderType: notices[0].tenderType,
//                     orderType: notices[0].orderType
//                 });
//
//                 // Log liczby ogłoszeń według różnych kryteriów
//                 const byNoticeType = notices.reduce((acc, n) => {
//                     acc[n.noticeType] = (acc[n.noticeType] || 0) + 1;
//                     return acc;
//                 }, {});
//                 logger.info('Notices by noticeType:', byNoticeType);
//
//                 const byTenderType = notices.reduce((acc, n) => {
//                     acc[n.tenderType] = (acc[n.tenderType] || 0) + 1;
//                     return acc;
//                 }, {});
//                 logger.info('Notices by tenderType:', byTenderType);
//             }
//
//             return { items: notices };
//
//         } catch (error) {
//             logger.error('Error fetching from official API:', error);
//             throw error;
//         }
//     }
//
//     async scrape(options = {}) {
//         await this.initialize();
//
//         try {
//             let page = 1;
//             const pageSize = 100;
//
//             logger.info('Starting notices analysis...');
//             const response = await this.getNotices(page, pageSize);
//
//             if (response.items && response.items.length > 0) {
//                 logger.info(`Retrieved ${response.items.length} notices for analysis`);
//
//                 // Nie zapisujemy do bazy na razie, tylko analizujemy strukturę
//                 return response.items;
//             }
//
//             logger.info('No notices found');
//             return [];
//
//         } catch (error) {
//             logger.error('Scraping failed:', error);
//             logger.error('Error details:', error.stack);
//             return [];
//         } finally {
//             await this.db.disconnect();
//         }
//     }
// }
//
// module.exports = new OfficialApiScraper();

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

