// const BaseScraper = require('../base/base-scraper');
// const SCRAPER_TYPES = require('../base/scraper-types');
// const { createLogger } = require('../../utils/logger/logger');
// const { getRandomUserAgent } = require('../../utils/helpers/browser-helpers');
//
// const logger = createLogger(__filename);
//
// class ApiListingsScraper extends BaseScraper {
//     constructor() {
//         super(SCRAPER_TYPES.API);
//         this.baseUrl = 'https://ezamowienia.gov.pl/mo-board/api/v1/Board';
//     }
//
//     async scrape(keyword = '') {
//         await this.initialize();
//
//         try {
//             logger.info('Starting API scrape with keyword:', keyword);
//
//             const headers = {
//                 'Accept': 'application/json',
//                 'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
//                 'User-Agent': getRandomUserAgent(),
//                 'Referer': 'https://ezamowienia.gov.pl/mo-client-board/bzp/list'
//             };
//
//             // Using the exact search parameters from the working endpoint
//             const searchParams = new URLSearchParams({
//                 'publicationDateFrom': '2024-12-25T20:14:37.827Z',
//                 'SortingColumnName': 'PublicationDate',
//                 'SortingDirection': 'DESC',
//                 'PageNumber': '1',
//                 'PageSize': '10'
//             });
//
//             if (keyword) {
//                 searchParams.append('SearchPhrase', keyword);
//             }
//
//             const url = `${this.baseUrl}/Search?${searchParams.toString()}`;
//             logger.debug('Making API request to:', url);
//
//             const response = await fetch(url, {
//                 method: 'GET',
//                 headers: headers
//             });
//
//             logger.debug('Response status:', response.status);
//             logger.debug('Response headers:', JSON.stringify(Object.fromEntries([...response.headers]), null, 2));
//
//             if (!response.ok) {
//                 const text = await response.text();
//                 logger.error('Error response content:', text);
//                 throw new Error(`Request failed with status ${response.status}`);
//             }
//
//             const data = await response.json();
//             logger.debug('Response data structure:', JSON.stringify(data, null, 2).substring(0, 500));
//
//             // Process the response based on the structure we saw
//             const processedItems = data.map(item => ({
//                 title: item.orderObject || '',
//                 number: item.bzpNumber || '',
//                 status: item.noticeType || '',
//                 publicationDate: item.publicationDate ? new Date(item.publicationDate) : null,
//                 link: `https://ezamowienia.gov.pl/mo-client-board/bzp/notice/${item.tenderId}`
//             }));
//
//             if (processedItems.length > 0) {
//                 logger.info(`Processing ${processedItems.length} items for saving`);
//                 await this.saveListings(processedItems);
//                 return processedItems;
//             }
//
//             logger.info('No items found in the response');
//             return [];
//
//         } catch (error) {
//             logger.error('API scraping failed:', error.message);
//             return [];
//         } finally {
//             await this.db.disconnect();
//         }
//     }
// }
//
// module.exports = new ApiListingsScraper();

// const BaseScraper = require('../base/base-scraper');
// const SCRAPER_TYPES = require('../base/scraper-types');
// const { createLogger } = require('../../utils/logger/logger');
// const { getRandomUserAgent } = require('../../utils/helpers/browser-helpers');
//
// const logger = createLogger(__filename);
//
// class ApiListingsScraper extends BaseScraper {
//     constructor() {
//         super(SCRAPER_TYPES.API);
//         this.baseUrl = 'https://ezamowienia.gov.pl/mo-board/api/v1/Board';
//         this.detailsUrl = 'https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details';
//     }
//
//     async getAllListings(keyword = '') {
//         const headers = {
//             'Accept': 'application/json',
//             'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
//             'User-Agent': getRandomUserAgent(),
//             'Referer': 'https://ezamowienia.gov.pl/mo-client-board/bzp/list'
//         };
//
//         // Using a very old date to get all possible listings
//         const searchParams = new URLSearchParams({
//             'publicationDateFrom': '2020-01-01T00:00:00.000Z',
//             'SortingColumnName': 'PublicationDate',
//             'SortingDirection': 'DESC',
//             'PageNumber': '1',
//             'PageSize': '100000' // Requesting a large number of results
//         });
//
//         if (keyword) {
//             searchParams.append('SearchPhrase', keyword);
//         }
//
//         const url = `${this.baseUrl}/Search?${searchParams.toString()}`;
//         logger.debug('Making API request to:', url);
//
//         const response = await fetch(url, { headers });
//
//         if (!response.ok) {
//             const text = await response.text();
//             logger.error('Error response content:', text);
//             throw new Error(`Listings request failed with status ${response.status}`);
//         }
//
//         const data = await response.json();
//         logger.info(`Received ${data.length} listings from API`);
//         return data;
//     }
//
//     async getNoticeDetails(noticeId) {
//         const headers = {
//             'Accept': 'application/json',
//             'User-Agent': getRandomUserAgent()
//         };
//
//         const url = `${this.detailsUrl}/id/${noticeId}`;
//         logger.debug('Fetching details for notice:', noticeId);
//
//         try {
//             const response = await fetch(url, { headers });
//
//             if (!response.ok) {
//                 logger.error(`Failed to fetch details for notice ${noticeId}: ${response.status}`);
//                 return null;
//             }
//
//             const details = await response.json();
//             return details;
//         } catch (error) {
//             logger.error(`Error fetching details for notice ${noticeId}:`, error);
//             return null;
//         }
//     }
//
//     async scrape(keyword = '') {
//         await this.initialize();
//
//         try {
//             // Step 1: Get all listings
//             const listings = await this.getAllListings(keyword);
//
//             // Process listings into our format
//             const processedListings = listings.map(item => ({
//                 id: item.tenderId || '',
//                 title: item.orderObject || '',
//                 number: item.bzpNumber || '',
//                 status: item.noticeType || '',
//                 publicationDate: item.publicationDate ? new Date(item.publicationDate) : null,
//                 link: `${this.detailsUrl}/id/${item.tenderId}`
//             }));
//
//             // Save base listings first
//             if (processedListings.length > 0) {
//                 logger.info(`Saving ${processedListings.length} base listings`);
//                 await this.saveListings(processedListings);
//             }
//
//             // Step 2: Get details for each listing (you can uncomment this when ready)
//             // for (const listing of processedListings) {
//             //     const details = await this.getNoticeDetails(listing.id);
//             //     if (details) {
//             //         await this.saveTenderDetails(details, listing.id);
//             //     }
//             //     // Add a small delay to avoid overwhelming the server
//             //     await new Promise(resolve => setTimeout(resolve, 1000));
//             // }
//
//             return processedListings;
//
//         } catch (error) {
//             logger.error('API scraping failed:', error.message);
//             return [];
//         } finally {
//             await this.db.disconnect();
//         }
//     }
// }
//
// module.exports = new ApiListingsScraper();
//
// const BaseScraper = require('../base/base-scraper');
// const SCRAPER_TYPES = require('../base/scraper-types');
// const { createLogger } = require('../../utils/logger/logger');
// const { getRandomUserAgent } = require('../../utils/helpers/browser-helpers');
//
// const logger = createLogger(__filename);
//
// class ApiListingsScraper extends BaseScraper {
//     constructor() {
//         super(SCRAPER_TYPES.API);
//         this.baseUrl = 'https://ezamowienia.gov.pl/mo-board/api/v1/Board';
//     }
//
//     async getNoticesList(pageNumber = 1, pageSize = 100) {
//         const headers = {
//             'accept': 'application/json, text/plain, */*',
//             'accept-language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
//             'user-agent': getRandomUserAgent(),
//             'sec-fetch-dest': 'empty',
//             'sec-fetch-mode': 'cors',
//             'sec-fetch-site': 'same-origin'
//         };
//
//         // Use a date from the past to get all notices
//         const searchParams = new URLSearchParams({
//             'publicationDateFrom': '2024-01-01T00:00:00.000Z', // Start from recent date for testing
//             'SortingColumnName': 'PublicationDate',
//             'SortingDirection': 'DESC',
//             'PageNumber': pageNumber.toString(),
//             'PageSize': pageSize.toString()
//         });
//
//         const url = `${this.baseUrl}/Search?${searchParams.toString()}`;
//         logger.debug(`Fetching notices list page ${pageNumber}:`, url);
//
//         const response = await fetch(url, {
//             method: 'GET',
//             headers: headers,
//             mode: 'cors',
//             credentials: 'omit',
//             referrer: 'https://ezamowienia.gov.pl/mo-client-board/bzp/list',
//             referrerPolicy: 'strict-origin-when-cross-origin'
//         });
//
//         if (!response.ok) {
//             const text = await response.text();
//             logger.error('Error response:', text);
//             throw new Error(`Failed to fetch notices list: ${response.status}`);
//         }
//
//         return await response.json();
//     }
//
//     async getNoticeDetails(noticeNumber) {
//         const headers = {
//             'accept': 'application/json, text/plain, */*',
//             'accept-language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
//             'user-agent': getRandomUserAgent(),
//             'sec-fetch-dest': 'empty',
//             'sec-fetch-mode': 'cors',
//             'sec-fetch-site': 'same-origin'
//         };
//
//         // Get basic info
//         const queryUrl = `${this.baseUrl}/GetNoticeQuery?noticeNumber=${encodeURIComponent(noticeNumber)}`;
//         const detailsUrl = `${this.baseUrl}/GetNoticeDetails?noticeNumber=${encodeURIComponent(noticeNumber)}`;
//
//         try {
//             const [queryResponse, detailsResponse] = await Promise.all([
//                 fetch(queryUrl, {
//                     method: 'GET',
//                     headers: headers,
//                     credentials: 'include',
//                     mode: 'cors'
//                 }),
//                 fetch(detailsUrl, {
//                     method: 'GET',
//                     headers: headers,
//                     credentials: 'include',
//                     mode: 'cors'
//                 })
//             ]);
//
//             if (!queryResponse.ok || !detailsResponse.ok) {
//                 throw new Error(`Failed to fetch notice details: ${queryResponse.status}, ${detailsResponse.status}`);
//             }
//
//             const [basicInfo, details] = await Promise.all([
//                 queryResponse.json(),
//                 detailsResponse.text()
//             ]);
//
//             return { basicInfo, details };
//         } catch (error) {
//             logger.error(`Error fetching details for notice ${noticeNumber}:`, error);
//             return null;
//         }
//     }
//
//     async scrape(keyword = '') {
//         await this.initialize();
//
//         try {
//             const pageSize = 100; // Fetch 100 notices at a time
//             let pageNumber = 1;
//             let allNotices = [];
//             let hasMorePages = true;
//
//             logger.info('Starting to fetch all notices...');
//
//             // Fetch all notices
//             while (hasMorePages) {
//                 const noticesList = await this.getNoticesList(pageNumber, pageSize);
//                 logger.info(`Fetched page ${pageNumber} with ${noticesList.length} notices`);
//
//                 if (noticesList.length === 0) {
//                     hasMorePages = false;
//                 } else {
//                     allNotices = allNotices.concat(noticesList);
//                     pageNumber++;
//
//                     // Add a small delay between pages
//                     await new Promise(resolve => setTimeout(resolve, 1000));
//                 }
//             }
//
//             logger.info(`Total notices found: ${allNotices.length}`);
//
//             // Process notices in batches
//             const batchSize = 10;
//             const processedNotices = [];
//
//             for (let i = 0; i < allNotices.length; i += batchSize) {
//                 const batch = allNotices.slice(i, i + batchSize);
//                 logger.info(`Processing batch ${i / batchSize + 1} of ${Math.ceil(allNotices.length / batchSize)}`);
//
//                 const batchPromises = batch.map(async notice => {
//                     if (!notice.noticeNumber) {
//                         logger.warn('Notice missing number:', notice);
//                         return null;
//                     }
//
//                     const details = await this.getNoticeDetails(notice.noticeNumber);
//                     if (!details) return null;
//
//                     return {
//                         id: details.basicInfo.id,
//                         title: details.basicInfo.noticeTypeDisplayName,
//                         number: details.basicInfo.noticeNumber,
//                         status: details.basicInfo.noticeType,
//                         publicationDate: details.basicInfo.publicationDate ? new Date(details.basicInfo.publicationDate) : null,
//                         moIdentifier: details.basicInfo.moIdentifier,
//                         details: details.details
//                     };
//                 });
//
//                 const batchResults = await Promise.all(batchPromises);
//                 const validResults = batchResults.filter(Boolean);
//
//                 if (validResults.length > 0) {
//                     await this.saveListings(validResults);
//                     processedNotices.push(...validResults);
//                     logger.info(`Saved ${validResults.length} notices from batch`);
//                 } else {
//                     logger.warn('No valid results in batch');
//                 }
//
//                 // Add a delay between batches
//                 await new Promise(resolve => setTimeout(resolve, 2000));
//             }
//
//             logger.info(`Successfully processed ${processedNotices.length} notices`);
//             return processedNotices;
//
//         } catch (error) {
//             logger.error('API scraping failed:', error.message);
//             return [];
//         } finally {
//             await this.db.disconnect();
//         }
//     }
// }
//
// module.exports = new ApiListingsScraper();

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