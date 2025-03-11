const listingSchema = {
    title: String,
    number: String,
    link: String,
    status: String,
    publicationDate: Date,
    scraperType: String,
    scrapedAt: Date,
    processed: Boolean
};

const detailsSchema = {
    tenderId: String,
    fullDescription: String,
    documents: [{
        name: String,
        url: String,
        type: String
    }],
    keywords: [String],
    scraperType: String,
    scrapedAt: Date
};