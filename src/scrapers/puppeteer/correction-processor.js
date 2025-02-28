const { createLogger } = require('../../utils/logger/logger');
const OpenAI = require('openai');
const logger = createLogger(__filename);

class CorrectionProcessor {
    constructor() {
        this.db = null;
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    async initialize() {
        if (!this.db) {
            const db = require('../../utils/database/mongo');
            await db.connect();
            this.db = db;

            // Tworzymy indeksy dla kolekcji tender_analysis
            const collection = this.db.db.collection('tender_analysis');
            await collection.createIndexes([
                { key: { tenderId: 1 }, unique: true },
                { key: { save: 1 } },
                { key: { "values.net": 1 } },
                { key: { "values.gross": 1 } },
                { key: { deadline: 1 } },
                { key: { processedAt: 1 } },
                { key: { "source_tender.number": 1 } }
            ]);

            logger.info('CorrectionProcessor database initialized with indexes');
            this.db = db;
        }
    }

    async processDetails() {
        try {
            const collection = this.db.db.collection('tender_details1');
            const newCollection = this.db.db.collection('tender_analysis_regex_test');

            const tenders = await collection.find({}).toArray();
            logger.info(`Found ${tenders.length} tenders to analyze`);

            // const excludeRegex = /^Ogłoszenie o (wykonaniu umowy|wyniku postępowania|zmian|zmianie)/i;
            const excludeRegex = /^Ogłoszenie o\s+(?:wykonaniu umowy|wyniku postępowania|zmian(?:ie)?)/i;


            for (const tender of tenders) {
                try {
                    // Skip if already processed
                    const existing = await newCollection.findOne({ tenderId: tender.tenderId });
                    if (existing) {
                        logger.info(`Tender ${tender.tenderId} already processed, skipping...`);
                        continue;
                    }

                    const title = tender.originalTender?.title || '';
                    if (excludeRegex.test(title)) {
                        logger.info(` 🎅 Skipping tender ${tender.tenderId} due to exclusion regex`);
                        continue;
                    }

                    logger.info(`Processing tender ${tender.tenderId}...`);
                    const analysis = await this.analyzeTender(tender);

                    // Mapujemy wyniki analizy do struktury bazy danych
                    const analysisDoc = {
                        tenderId: tender.tenderId,
                        // originalAnalysis: tender.analysis,
                        processedAt: new Date(),
                        // Nowe pola z nowego prompta
                        save: analysis.save,
                        products: analysis.products || [],
                        license_counts: analysis.license_counts || {},
                        values: {
                            net: analysis.values?.net || null,
                            gross: analysis.values?.gross || null,
                            currency: analysis.values?.currency || 'PLN'
                        },
                        // New fields
                        scoring_criteria: analysis.scoring_criteria || {},
                        partial_offers_allowed: analysis.partial_offers_allowed,
                        deadline: analysis.deadline || null,
                        // Zachowujemy dane źródłowe
                        source_tender: {
                            number: tender.originalTender?.number,
                            title: tender.originalTender?.title,
                            link: tender.originalTender?.link,
                            status: tender.originalTender?.status
                        },
                        // Pełne dane
                        fullContent: tender.fullContent,
                        raw_analysis: analysis,
                        // Metadane
                        processorVersion: "2.0"
                    };

                    await newCollection.insertOne(analysisDoc);

                    logger.info(`✓ Successfully processed tender ${tender.tenderId}`);
                    await new Promise(r => setTimeout(r, 1000)); // Rate limiting
                } catch (error) {
                    logger.error(`Error processing tender ${tender.tenderId}:`, error);
                }
            }
        } catch (error) {
            logger.error('Critical error in processDetails:', error);
            throw error;
        }
    }

    // FIXME FIGHT WITH THE PROMPT
    async analyzeTender(tender) {
        const systemPrompt = `Analyze tender notices specifically for Microsoft licensing and subscription services. Extract detailed information about:

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
            
            3. Price and Scoring Information:
            - Extract price details (net, gross, currency)
            - Extract all scoring criteria related to price (e.g. "Price: 60 points", "Cost efficiency: 20 points")
            - Find any specific formulas used for scoring (e.g. "points = lowest price / offered price * 100")
            
            4. Offer Requirements:
            - Determine if partial offers are allowed (can a supplier bid for only part of the order)
            - Extract any specific conditions about the completeness of offers
            
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
              "scoring_criteria": {
                "price_points": number | null,
                "formula": string | null,
                "other_criteria": array of objects with "name" and "points" properties
              },
              "partial_offers_allowed": boolean | null,
              "duration": string (subscription/license period if specified),
              "deadline": string (submission deadline if specified)
            }
            
            Exclude if:
            - Generic IT/software mentions without Microsoft specifics
            - Hardware/devices is the main objective of the purchase and not licensing
            - Non-licensing Microsoft mentions
            
            Exclude if contains: Microsoft edge/ Edge, surface, xbox, hardware.
            For save=true, tender must clearly relate to Microsoft software/cloud licensing (not just generic IT/software mentions).
            Use null for missing values. Currency should be PLN if not specified otherwise.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: tender.fullContent }
                ],
                temperature: 0.2,
            });

            return this.parseResponse(response);
        } catch (error) {
            logger.error('OpenAI API error:', error);
            return {
                save: false,
                products: [],
                license_counts: {},
                values: { net: null, gross: null, currency: 'PLN' },
                scoring_criteria: { price_points: null, formula: null, other_criteria: [] },
                partial_offers_allowed: null,
                tender_id: null,
                deadline: null,
                error: error.message
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
                scoring_criteria: {
                    price_points: result.scoring_criteria?.price_points || null,
                    formula: result.scoring_criteria?.formula || null,
                    other_criteria: result.scoring_criteria?.other_criteria || []
                },
                partial_offers_allowed: result.partial_offers_allowed || null,
                tender_id: result.tender_id || null,
                deadline: result.deadline || null,
                raw_response: result // preserve original response
            };
        } catch (e) {
            logger.error('Error parsing OpenAI response:', e);
            return {
                save: false,
                products: [],
                license_counts: {},
                values: { net: null, gross: null, currency: 'PLN' },
                scoring_criteria: { price_points: null, formula: null, other_criteria: [] },
                partial_offers_allowed: null,
                tender_id: null,
                deadline: null,
                error: 'Failed to parse response'
            };
        }
    }

    async cleanup() {
        if (this.db) {
            await this.db.disconnect();
            logger.info('Database disconnected');
        }
    }
}

module.exports = new CorrectionProcessor();