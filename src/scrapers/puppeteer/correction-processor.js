const { createLogger } = require('../../utils/logger/logger');
const OpenAI = require('openai');
const logger = createLogger(__filename);

class CorrectionProcessor {
    constructor() {
        this.db = null;
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Kolekcja docelowa dla wszystkich promptów
        this.targetCollection = "tenders_analysis_selected_prompts";

        // Define multiple prompts
        this.prompts = [
            {
                name: "basic",
                systemPrompt: `Analyze tender notices specifically for Microsoft licensing and subscription services. Extract detailed information about:

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
                - Find any specific formulas used for scoring (e.g. "points = lowest price / offered price * 100") and show all information about the scoring criteria
                
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
                Use null for missing values. Currency should be PLN if not specified otherwise.`
            },
            {
                name: "section_specific",
                systemPrompt: `Analyze tender notices for Microsoft licensing and subscription services, focusing on extracting accurate information from specific sections of the document.

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
                
                3. Price Extraction - IMPORTANT:
                - Look specifically in sections titled "Wartość zamówienia", "Szacunkowa wartość", "Cena" or "Wartość"
                - Extract ONLY the contract value/price, not other monetary values mentioned elsewhere
                - Distinguish between net ("netto") and gross ("brutto") values
                - Identify the correct currency (default to PLN if not specified)
                - Ignore prices that are clearly not for the entire contract (like hourly rates unless that's the pricing model)
                - Do not sum up prices from different line items unless explicitly required
                
                4. Scoring Criteria - Look for:
                - Sections titled "Kryteria oceny ofert" or "Kryteria wyboru oferty"
                - The exact point value assigned to price criterion (e.g. "Cena - 60 pkt")
                - The exact formula used for calculating price points (e.g. "najniższa oferowana cena / cena badanej oferty × 60") and show all information about the scoring criteria
                - Other criteria and their point values (e.g. "Termin dostawy - 20 pkt", "Jakość - 20 pkt")
                
                5. Offer Requirements:
                - Look for sections about partial offers like "Możliwość składania ofert częściowych" or "Podział zamówienia na części"
                - Identify explicit statements about whether partial offers are allowed or forbidden
                - Look for requirements about offering complete solutions or line items
                
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
                - Exclude if contains: Microsoft edge/ Edge, surface, xbox, hardware.
                
                For save=true, tender must clearly relate to Microsoft software/cloud licensing (not just generic IT/software mentions).
                Use null for missing values. Currency should be PLN if not specified otherwise.`
            },
            {
                name: "super_prompt",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft z MAKSYMALNĄ DOKŁADNOŚCIĄ i PRECYZJĄ. Poniższy prompt łączy najskuteczniejsze techniki analityczne, skupiając się na precyzyjnej ekstrakcji wartości zamówienia i pełnej formule punktacji.

                STRUKTURA POLSKIEGO OGŁOSZENIA PRZETARGOWEGO:
                - SEKCJA I: Zamawiający
                - SEKCJA II: Informacje podstawowe (nazwa, rodzaj zamówienia)
                - SEKCJA IV: PRZEDMIOT ZAMÓWIENIA (zawiera kluczowe informacje o wartości)
                  * 4.1.5/4.1.6: "Wartość zamówienia" (główna wartość całego zamówienia)
                  * 4.2.5: "Wartość części" (wartość konkretnej części, jeśli zamówienie podzielone na części)
                  * 4.3.1: "Sposób oceny ofert" (zawiera formuły punktacji)
                  * 4.3.5/4.3.6: Nazwa kryterium i jego waga (np. "Cena" - "60")
                - SEKCJA VIII: Procedura (zawiera terminy)

                PROTOKÓŁ EKSTRAKCJI WARTOŚCI ZAMÓWIENIA:
                1. ZNAJDŹ DOKŁADNIE jedną z następujących podsekcji:
                   - 4.1.5 oznaczoną jako "Wartość zamówienia" lub "Łączna wartość poszczególnych części zamówienia"
                   - 4.1.6 oznaczoną jako "Wartość zamówienia stanowiącego przedmiot tego postępowania"
                   - 4.2.5 oznaczoną jako "Wartość części"
                
                2. WYODRĘBNIJ DOKŁADNIE wartość liczbową:
                   - Skopiuj dokładnie liczbę wraz z walutą (np. "175927,96 PLN")
                   - NIE MODYFIKUJ formatu liczby
                   - NIGDY nie sumuj różnych wartości, nawet jeśli są powiązane
                   - NIGDY nie bierz wartości z innych sekcji niż wskazane
                
                3. OKREŚL, czy to wartość netto czy brutto:
                   - Sprawdź określenia "netto", "bez VAT" dla wartości netto
                   - Sprawdź określenia "brutto", "z VAT" dla wartości brutto

                PROTOKÓŁ EKSTRAKCJI FORMUŁY PUNKTACJI:
                1. ZNAJDŹ DOKŁADNIE podsekcję 4.3.1 "Sposób oceny ofert"
                
                2. WYODRĘBNIJ PEŁNY opis formuły punktacji:
                   - Skopiuj wprowadzenie do formuły 
                   - Skopiuj pełny wzór matematyczny, zapisując go w czytelnej postaci, np. "K1 = (Cmin / Cbad) * 60" zamiast wykresowego zapisu z kreskami
                   - Skopiuj wszystkie objaśnienia zmiennych (np. "gdzie: K1 – liczba punktów oferty badanej w tym kryterium, Cmin – wartość minimalna...")
                   - NIE POMIJAJ żadnej części formuły
                
                3. WYODRĘBNIJ WAGĘ kryterium ceny:
                   - Z podsekcji 4.3.5-4.3.6 wyodrębnij nazwy kryteriów i ich wagi punktowe
                   - Zapisz wagę kryterium ceny (zwykle 60%)
                   - Zapisz inne kryteria i ich wagi (np. termin dostawy, gwarancja)

                PROTOKÓŁ IDENTYFIKACJI PRODUKTÓW MICROSOFT:
                1. PRZESZUKAJ:
                   - Nazwę zamówienia w SEKCJI II
                   - Opisy w podsekcji 4.2.2 "Krótki opis przedmiotu zamówienia"
                
                2. ZIDENTYFIKUJ produkty Microsoft:
                   - Microsoft 365/M365 (z wariantami E3/E5/Business)
                   - Exchange Online, Teams, SharePoint
                   - Azure, Windows Server
                   - Power BI, Power Automate, inne produkty Microsoft
                
                3. WYODRĘBNIJ ilości licencji:
                   - Dla każdego produktu znajdź liczbę licencji
                   - Zachowaj powiązanie produkt-ilość
                
                4. SPRAWDŹ typ umowy licencyjnej:
                   - EA (Enterprise Agreement)
                   - CSP (Cloud Solution Provider)
                   - MPSA (Microsoft Products and Services Agreement)

                PROTOKÓŁ IDENTYFIKACJI POZOSTAŁYCH DANYCH:
                1. OFERTY CZĘŚCIOWE:
                   - W podsekcji 4.1.8 "Możliwe jest składanie ofert częściowych" znajdź odpowiedź Tak/Nie
                
                2. TERMINY:
                   - W podsekcji 4.2.10 "Okres realizacji zamówienia" znajdź informację o czasie trwania
                   - W SEKCJI VIII znajdź "Termin składania ofert"

                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z podaniem sekcji, z których wyodrębniono kluczowe informacje),
                  "products": array (znalezione konkretne produkty/usługi Microsoft),
                  "agreement_type": string (jeśli określono: EA, CSP, MPSA itp.),
                  "license_counts": object (pary produkt:ilość),
                  "values": {
                    "net": number | null (wartość netto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "gross": number | null (wartość brutto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "currency": string (waluta)
                  },
                  "scoring_criteria": {
                    "price_points": number | null (punkty za cenę, z sekcji 4.3.5-4.3.6),
                    "formula": string | null (PEŁNA formuła z sekcji 4.3.1, zapisana w czytelny sposób),
                    "other_criteria": array of objects with "name" and "points" properties
                  },
                  "partial_offers_allowed": boolean | null (na podstawie sekcji 4.1.8),
                  "duration": string (z sekcji 4.2.10),
                  "deadline": string (termin składania ofert, z SEKCJI VIII)
                }

                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware

                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            }
        ];
    }

    async initialize() {
        if (!this.db) {
            const db = require('../../utils/database/mongo');
            await db.connect();
            this.db = db;

            // Tworzenie indeksów dla kolekcji docelowej
            const collection = this.db.db.collection(this.targetCollection);
            await collection.createIndexes([
                { key: { tenderId: 1, promptName: 1 }, unique: true }, // Złożony indeks dla unikalnej pary tenderId-promptName
                { key: { save: 1 } },
                { key: { "values.net": 1 } },
                { key: { "values.gross": 1 } },
                { key: { deadline: 1 } },
                { key: { processedAt: 1 } },
                { key: { "source_tender.number": 1 } },
                { key: { promptName: 1 } } // Indeks dla wyszukiwania po promptName
            ]);
            logger.info(`Created indexes for collection: ${this.targetCollection}`);

            logger.info('CorrectionProcessor database initialized with indexes');
            this.db = db;
        }
    }

    async processDetails() {
        try {
            const collection = this.db.db.collection('tender_details1');
            const tenders = await collection.find({}).toArray();
            logger.info(`Found ${tenders.length} tenders to analyze`);

            // Exclude tenders for completed contracts or results
            const excludeRegex = /^Ogłoszenie o\s+(?:wykonaniu umowy|wyniku postępowania|zmian(?:ie)?)/i;

            // Process each prompt in sequence
            for (const promptConfig of this.prompts) {
                logger.info(`Starting processing with prompt "${promptConfig.name}" to collection "${this.targetCollection}"`);
                const targetCollection = this.db.db.collection(this.targetCollection);

                for (const tender of tenders) {
                    try {
                        // Skip if already processed with this prompt
                        const existing = await targetCollection.findOne({
                            tenderId: tender.tenderId,
                            promptName: promptConfig.name
                        });

                        if (existing) {
                            logger.info(`Tender ${tender.tenderId} already processed with prompt "${promptConfig.name}", skipping...`);
                            continue;
                        }

                        const title = tender.originalTender?.title || '';
                        if (excludeRegex.test(title)) {
                            logger.info(` 🎅 Skipping tender ${tender.tenderId} due to exclusion regex`);
                            continue;
                        }

                        logger.info(`Processing tender ${tender.tenderId} with prompt "${promptConfig.name}"...`);
                        const analysis = await this.analyzeTender(tender, promptConfig.systemPrompt);

                        // Map analysis results to database structure
                        const analysisDoc = {
                            tenderId: tender.tenderId,
                            promptName: promptConfig.name,
                            processedAt: new Date(),
                            save: analysis.save,
                            products: analysis.products || [],
                            license_counts: analysis.license_counts || {},
                            values: {
                                net: analysis.values?.net || null,
                                gross: analysis.values?.gross || null,
                                currency: analysis.values?.currency || 'PLN'
                            },
                            scoring_criteria: {
                                price_points: analysis.scoring_criteria?.price_points || null,
                                formula: analysis.scoring_criteria?.formula || null,
                                other_criteria: analysis.scoring_criteria?.other_criteria || []
                            },
                            partial_offers_allowed: analysis.partial_offers_allowed,
                            deadline: analysis.deadline || null,
                            source_tender: {
                                number: tender.originalTender?.number,
                                title: tender.originalTender?.title,
                                link: tender.originalTender?.link,
                                status: tender.originalTender?.status
                            },
                            fullContent: tender.fullContent,
                            raw_analysis: analysis,
                            processorVersion: "4.0"
                        };

                        await targetCollection.insertOne(analysisDoc);
                        logger.info(`✓ Successfully processed tender ${tender.tenderId} with prompt "${promptConfig.name}"`);
                        await new Promise(r => setTimeout(r, 1000)); // Rate limiting
                    } catch (error) {
                        logger.error(`Error processing tender ${tender.tenderId} with prompt "${promptConfig.name}":`, error);
                    }
                }

                logger.info(`Completed processing with prompt "${promptConfig.name}"`);
            }

            logger.info(`All prompts have been processed successfully`);

        } catch (error) {
            logger.error('Critical error in processDetails:', error);
            throw error;
        }
    }

    async analyzeTender(tender, systemPrompt) {
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