const BaseScraper = require('../base/base-scraper');
const SCRAPER_TYPES = require('../base/scraper-types');
const { createLogger } = require('../../utils/logger/logger');
const { getRandomUserAgent } = require('../../utils/helpers/browser-helpers');

const logger = createLogger(__filename);

class ApiListingsScraper extends BaseScraper {
    constructor() {
        super(SCRAPER_TYPES.API);
        this.baseUrl = 'https://ezamowienia.gov.pl/mo-board/api/v1/Board';
    }

    async getNoticesList(pageNumber = 1, pageSize = 10) {
        const headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
            'user-agent': getRandomUserAgent()
        };

        const searchParams = new URLSearchParams({
            'publicationDateFrom': '2024-01-01T00:00:00.000Z',
            'SortingColumnName': 'PublicationDate',
            'SortingDirection': 'DESC',
            'PageNumber': pageNumber.toString(),
            'PageSize': pageSize.toString()
        });

        const url = `${this.baseUrl}/Search?${searchParams.toString()}`;
        logger.debug(`Fetching notices list page ${pageNumber}:`, url);

        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            mode: 'cors',
            credentials: 'omit'
        });

        if (!response.ok) {
            const text = await response.text();
            logger.error('Error response:', text);
            throw new Error(`Failed to fetch notices list: ${response.status}`);
        }

        const data = await response.json();
        logger.info(`Received ${data.length} notices for page ${pageNumber}`);
        return data;
    }

    async getNoticeDetails(noticeNumber) {
        const headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
            'user-agent': getRandomUserAgent()
        };

        const queryUrl = `${this.baseUrl}/GetNoticeQuery?noticeNumber=${encodeURIComponent(noticeNumber)}`;
        const detailsUrl = `${this.baseUrl}/GetNoticeDetails?noticeNumber=${encodeURIComponent(noticeNumber)}`;

        try {
            const [queryResponse, detailsResponse] = await Promise.all([
                fetch(queryUrl, {
                    method: 'GET',
                    headers: headers,
                    credentials: 'include',
                    mode: 'cors'
                }),
                fetch(detailsUrl, {
                    method: 'GET',
                    headers: headers,
                    credentials: 'include',
                    mode: 'cors'
                })
            ]);

            if (!queryResponse.ok || !detailsResponse.ok) {
                throw new Error(`Failed to fetch notice details: ${queryResponse.status}, ${detailsResponse.status}`);
            }

            const [basicInfo, details] = await Promise.all([
                queryResponse.json(),
                detailsResponse.text()
            ]);

            return { basicInfo, details };
        } catch (error) {
            logger.error(`Error fetching details for notice ${noticeNumber}:`, error);
            return null;
        }
    }

    async scrape(keyword = '') {
        await this.initialize();

        try {
            let pageNumber = 1;
            let allNotices = [];
            let hasMorePages = true;
            const pageSize = 10; // Server seems to limit to 10 regardless of what we request

            logger.info('Starting to fetch all notices...');

            // Fetch all notices
            while (hasMorePages && pageNumber <= 1000) { // Added safety limit
                logger.info(`Fetching page ${pageNumber}...`);
                const noticesList = await this.getNoticesList(pageNumber, pageSize);

                if (noticesList.length === 0) {
                    hasMorePages = false;
                    logger.info('No more notices found');
                } else {
                    const processedNotices = noticesList.map(notice => ({
                        id: notice.id || null,
                        title: notice.orderObject || '',
                        number: notice.bzpNumber || notice.noticeNumber || '',
                        status: notice.noticeType || '',
                        publicationDate: notice.publicationDate ? new Date(notice.publicationDate) : null,
                        rawData: notice // Save complete raw data
                    }));

                    // Save each page as we get it
                    if (processedNotices.length > 0) {
                        logger.info(`Saving ${processedNotices.length} notices from page ${pageNumber}`);
                        await this.saveListings(processedNotices);
                        allNotices = allNotices.concat(processedNotices);
                    }

                    pageNumber++;
                    // Add a small delay between pages
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            logger.info(`Total notices processed: ${allNotices.length}`);

            // Optional: Get details for each notice
            // const batchSize = 5;
            // for (let i = 0; i < allNotices.length; i += batchSize) {
            //     const batch = allNotices.slice(i, i + batchSize);
            //     logger.info(`Processing details for batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(allNotices.length/batchSize)}`);
            //
            //     const batchPromises = batch.map(async notice => {
            //         if (!notice.number) return null;
            //         return await this.getNoticeDetails(notice.number);
            //     });
            //
            //     const details = await Promise.all(batchPromises);
            //     const validDetails = details.filter(Boolean);
            //
            //     if (validDetails.length > 0) {
            //         // Save details to a different collection
            //         // await this.saveTenderDetails(validDetails);
            //         logger.info(`Saved details for ${validDetails.length} notices`);
            //     }
            //
            //     await new Promise(resolve => setTimeout(resolve, 2000));
            // }

            return allNotices;

        } catch (error) {
            logger.error('API scraping failed:', error.message);
            logger.error('Stack trace:', error.stack);
            return [];
        } finally {
            await this.db.disconnect();
        }
    }
}

module.exports = new ApiListingsScraper();