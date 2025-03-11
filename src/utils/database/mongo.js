const {MongoClient} = require('mongodb');
const {createLogger} = require('../../utils/logger/logger');

const logger = createLogger(__filename);
require('dotenv').config();

class MongoDB {
    constructor() {
        this.client = new MongoClient(process.env.MONGO_URL);
        this.db = null;
    }

    async connect() {
        try {
            await this.client.connect();
            this.db = this.client.db(process.env.MONGO_DB);
            logger.info('MongoDB connected');
        } catch (error) {
            logger.error('MongoDB connection error:', error);
        }
    }

    async saveListings(listings, scraperType) {
        const collectionName = `tender_listings_test4_${scraperType.toLowerCase()}`;
        const collection = this.db.collection(collectionName);

        // Filtrujemy duplikaty
        const uniqueListings = [];
        for (const listing of listings) {
            try {
                // Sprawdzamy czy istnieje po numerze lub tytule
                const exists = await collection.findOne({
                    $and: [
                        {number: listing.number},
                        {title: listing.title},
                        {status: listing.status},
                        {link: listing.link}
                    ]
                });

                if (!exists) {
                    uniqueListings.push({
                        ...listing,
                        scraperType,
                        scrapedAt: new Date(),
                        processed: false,
                        source: 'ezamowienia'
                    });
                } else {
                    logger.info(`Skipping duplicate tender: ${listing.number} - ${listing.title?.substring(0, 30)}...`);
                }
            } catch (error) {
                logger.error(`Error checking duplicate for tender ${listing.number}:`, error);
            }
        }

        if (uniqueListings.length > 0) {
            logger.info(`Inserting ${uniqueListings.length} unique listings to ${collectionName}`);
            return await collection.insertMany(uniqueListings);
        } else {
            logger.info('No new unique listings to save');
            return {insertedCount: 0};
        }
    }

    async saveTenderDetails(details, scraperId) {
        const collection = this.db.collection('tender_details1');
        logger.info(`Inserting details for tender ${details.tenderId}`);
        return await collection.insertOne({
            ...details,
            scraperId,
            scrapedAt: new Date()
        });
    }

    async findUnprocessedListings() {
        const collection = this.db.collection('tender_listings_test4_puppeteer');
        logger.info('Finding unprocessed listings');
        return await collection.find({processed: false}).toArray();
    }

    async markListingAsProcessed(listingId) {
        const collection = this.db.collection('tender_listings_test4_puppeteer');
        logger.info(`Marking listing ${listingId} as processed`);
        return await collection.updateOne(
            {_id: listingId},
            {$set: {processed: true}}
        );
    }

    async disconnect() {
        await this.client.close();
        logger.info('MongoDB disconnected');
    }
}

module.exports = new MongoDB();