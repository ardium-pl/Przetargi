const {createLogger} = require('../../utils/logger/logger');
const OpenAI = require('openai');
const logger = createLogger(__filename);

class CorrectionProcessor {
    constructor() {
        this.db = null;
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Define multiple prompts
        this.prompts = [
            {
                name: "basic",
                collection: "tender_analysis_regex_test_1",
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
                collection: "tender_analysis_regex_test_2",
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
                name: "compact_section_specific",
                collection: "tender_analysis_regex_test_3",
                systemPrompt: `Analyze tender notices for Microsoft licensing and subscription services. Look for specific sections in Polish tender announcements: Section 1 contains basic information, Section 2 contains details about the contracting authority, Section 3 contains procurement details, and SECTION 4 CONTAINS PRICE AND CONTRACT INFORMATION. Focus primarily on Section 4 for pricing details and Section 5 for scoring criteria. Microsoft Services & Licensing to look for: Exchange Online, Microsoft 365/M365 (including E3/E5/Business variants), Entra ID (formerly Azure AD), Enterprise licensing agreements (EA, CSP, MPSA), Microsoft product subscriptions and licenses, Microsoft cloud services (Azure, Exchange Online, Teams). Keywords (case insensitive, including Polish variants): Licensing terms: "licencj", "subskrypcj", "subscription", "MPSA"; Product names: "Microsoft", "Exchange Online", "M365", "E3", "E5", "Entra", "Teams"; Service types: "cloud", "online", "Microsoft 365", "Azure". WHEN EXTRACTING PRICE: Look specifically in SECTION 4 where the price information is located, specifically subsections with headings like "Wartość zamówienia", "Szacunkowa wartość", or "Cena". Extract ONLY the total contract value/price, not unit prices or other monetary values. WHEN EXTRACTING SCORING CRITERIA: Look for sections titled "Kryteria oceny ofert" or "Kryteria wyboru oferty" in SECTION 5, extract the exact point value for price (e.g. "Cena - 60 pkt") and formula used for calculation and show all information about the scoring criteria. WHEN CHECKING FOR PARTIAL OFFERS: Look for phrases like "Czy dopuszcza się złożenie oferty częściowej" or "Zamówienie podzielone na części" in SECTION 4. Return JSON: {"save": boolean (true if clearly Microsoft-specific licensing/services), "message": string (reasoning), "products": array (specific Microsoft products/services found), "agreement_type": string (if specified: EA, CSP, MPSA etc), "license_counts": object (product:quantity pairs), "values": {"net": number | null, "gross": number | null, "currency": string}, "scoring_criteria": {"price_points": number | null, "formula": string | null, "other_criteria": array of objects with "name" and "points" properties}, "partial_offers_allowed": boolean | null, "duration": string (subscription/license period if specified), "deadline": string (submission deadline if specified)}. Exclude if: Generic IT/software mentions without Microsoft specifics, Hardware/devices is the main objective, Non-licensing Microsoft mentions, Contains: Microsoft edge/Edge, surface, xbox, hardware. For save=true, tender must clearly relate to Microsoft software/cloud licensing. Use null for missing values. Currency should be PLN if not specified otherwise.`
            },
            {
                name: "section_navigation_expert",
                collection: "tender_analysis_regex_test_4",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft z PRECYZYJNĄ NAWIGACJĄ PO SEKCJACH dokumentu. Polskie ogłoszenia przetargowe mają standardową strukturę, której MUSISZ ściśle przestrzegać:

                STRUKTURA POLSKIEGO OGŁOSZENIA PRZETARGOWEGO:
                - SEKCJA I: Zamawiający (dane organizacji zamawiającej)
                - SEKCJA II: Informacje podstawowe (rodzaj, nazwa zamówienia)
                - SEKCJA III: Udostępnianie dokumentów i komunikacja
                - SEKCJA IV: PRZEDMIOT ZAMÓWIENIA (w tym WARTOŚĆ ZAMÓWIENIA pod numerem 4.1.5 lub 4.1.6 i wartości poszczególnych części w 4.2.5)
                - PODSEKCJA 4.3: KRYTERIA OCENY OFERT (4.3.1 zawiera FORMUŁY obliczeniowe punktacji)
                - SEKCJA V: Kwalifikacja wykonawców
                - SEKCJA VI: Warunki zamówienia
                - SEKCJA VII: Projektowane postanowienia umowy
                - SEKCJA VIII: Procedura
            
                1. EKSTRAKCJA WARTOŚCI ZAMÓWIENIA - ŚCISŁE WSKAZÓWKI:
                - WARTOŚĆ ZAMÓWIENIA znajduje się ZAWSZE w SEKCJI IV, w podsekcji 4.1.5 lub 4.1.6 jako "Wartość zamówienia", lub w podsekcji 4.2.5 jako "Wartość części"
                - NIGDY nie sumuj żadnych wartości - zawsze wyodrębnij dokładnie te wartości, które są explicite podane w jednej z tych podsekcji
                - Wartość zamówienia podana jest jako jedna liczba, często z oznaczeniem waluty (zwykle PLN)
                - Nie mylić z "Łączna wartość poszczególnych części zamówienia" (ta wartość może być sumą, ale nas interesuje wartość konkretnej części)
                - Szukaj dokładnie sekcji 4.1.5, 4.1.6 lub 4.2.5, NIE interpretuj innych wartości liczbowych jako wartości zamówienia
            
                2. EKSTRAKCJA FORMUŁ PUNKTACJI - PRECYZYJNA INSTRUKCJA:
                - FORMUŁY PUNKTACJI znajdują się ZAWSZE w PODSEKCJI 4.3.1 oznaczonej jako "Sposób oceny ofert"
                - W tej sekcji znajduje się ZAWSZE kompletny opis formuły, często z przykładowym wzorem matematycznym
                - MUSISZ skopiować CAŁY opis formuły, łącznie z objaśnieniami zmiennych, tak jak jest on podany w dokumencie
                - Typowa formuła wygląda następująco: "C min. K1 = ------------ x 60 C bad."
                - Po formule zwykle znajduje się objaśnienie zmiennych, np. "gdzie: K1 – liczba punktów oferty badanej w tym kryterium, C min. – wartość minimalna (brutto) spośród wszystkich ofert niepodlegających odrzuceniu, C bad. – wartość oferty badanej (brutto), 60 – waga kryterium"
                - ZABRONIONE jest skracanie, parafrazowanie lub upraszczanie formuły - wymaganym jest podanie jej w PEŁNEJ formie
            
                3. USŁUGI I LICENCJONOWANIE MICROSOFT:
                - W SEKCJI II lub IV znajduje się opis przedmiotu zamówienia, gdzie szukaj produktów Microsoft
                - Szukaj produktów: Microsoft 365/M365, Office 365, Exchange Online, Teams, Azure, Windows Server, Entra ID
                - Sprawdź typy umów: EA, CSP, MPSA (informacja może być w jednej z tych sekcji)
            
                4. OFERTY CZĘŚCIOWE:
                - W SEKCJI IV, podsekcji 4.1.8 oznaczonej jako "Możliwe jest składanie ofert częściowych" znajduje się informacja Tak/Nie
            
                5. TERMIN REALIZACJI:
                - W SEKCJI IV, podsekcji 4.2.10 oznaczonej jako "Okres realizacji zamówienia" znajduje się informacja o terminie
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie, z precyzyjnym wskazaniem sekcji gdzie znaleziono informacje),
                  "products": array (znalezione konkretne produkty/usługi Microsoft),
                  "agreement_type": string (jeśli określono: EA, CSP, MPSA itp.),
                  "license_counts": object (pary produkt:ilość),
                  "values": {
                    "net": number | null (wartość netto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "gross": number | null (wartość brutto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "currency": string (waluta)
                  },
                  "scoring_criteria": {
                    "price_points": number | null (punkty za cenę, z sekcji 4.3.1),
                    "formula": string | null (KOMPLETNA formuła z sekcji 4.3.1, z zachowaniem całego opisu),
                    "other_criteria": array of objects with "name" and "points" properties (z sekcji 4.3.1)
                  },
                  "partial_offers_allowed": boolean | null (na podstawie sekcji 4.1.8),
                  "duration": string (z sekcji 4.2.10),
                  "deadline": string (termin składania ofert, z sekcji VIII)
                }
            
                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware
            
                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            },

            {
                name: "strict_section_mapping",
                collection: "tender_analysis_regex_test_5",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące licencjonowania i usług Microsoft, stosując ŚCISŁE MAPOWANIE SEKCJI. Ogłoszenia mają precyzyjną, przewidywalną strukturę, której NALEŻY bezwzględnie przestrzegać:
            
                MODEL ARCHITEKTURY DOKUMENTU:
                | Kod sekcji | Nazwa sekcji | Zawartość | Instrukcja ekstrakcji |
                |------------|--------------|-----------|------------------------|
                | SEKCJA I   | ZAMAWIAJĄCY  | Dane zamawiającego | - |
                | SEKCJA II  | INFORMACJE PODSTAWOWE | Nazwy/opisy zamówienia | Szukaj produktów Microsoft |
                | SEKCJA IV  | PRZEDMIOT ZAMÓWIENIA | Wartości, opisy części | GŁÓWNE ŹRÓDŁO CEN |
                | 4.1.5/4.1.6| Wartość zamówienia | OFICJALNA WARTOŚĆ | Wyodrębnij DOKŁADNIE tę liczbę |
                | 4.2.5      | Wartość części | WARTOŚĆ KONKRETNEJ CZĘŚCI | Wyodrębnij DOKŁADNIE tę liczbę |
                | 4.3.1      | Sposób oceny ofert | PEŁNE FORMUŁY OCENY | Skopiuj CAŁY opis, bez skrótów |
                | 4.3.2-4.3.6| Kryteria i wagi | Punktacja kryteriów | Wyodrębnij wagi kryteriów |
                | SEKCJA VIII| PROCEDURA | Terminy, daty | Znajdź deadline |
            
                PROTOKÓŁ EKSTRAKCJI WARTOŚCI:
                1. WARTOŚĆ ZAMÓWIENIA - ZAWSZE Z PODSEKCJI 4.1.5, 4.1.6 LUB 4.2.5:
                - NAJPIERW zlokalizuj DOKŁADNIE podsekcję 4.1.5 lub 4.1.6 oznaczoną jako "Wartość zamówienia" lub 4.2.5 oznaczoną jako "Wartość części"
                - NASTĘPNIE wyodrębnij DOKŁADNIE wartość liczbową tam podaną (np. "175927,96 PLN")
                - NIGDY nie sumuj różnych wartości, NIGDY nie interpretuj wartości z innych sekcji jako wartości zamówienia
                - ZAWSZE sprawdź, czy wartość opisana jest jako brutto czy netto (jeśli brak oznaczenia, klasyfikuj jako nieokreśloną)
                - Jeśli ogłoszenie jest podzielone na części, priorytetowo traktuj wartości dla części dotyczących Microsoft
            
                PROTOKÓŁ EKSTRAKCJI FORMUŁY:
                2. FORMUŁA PUNKTACJI - ZAWSZE Z PODSEKCJI 4.3.1:
                - NAJPIERW zlokalizuj DOKŁADNIE podsekcję 4.3.1 oznaczoną jako "Sposób oceny ofert"
                - NASTĘPNIE skopiuj CAŁY fragment opisujący obliczanie punktów, wraz z wzorem matematycznym i wszystkimi objaśnieniami
                - Typowa formuła ma postać: "C min. K1 = ------------ x 60 C bad." wraz z objaśnieniem "gdzie: K1 – liczba punktów..."
                - WYMAGANE jest zachowanie pełnego oryginalnego formatowania, wszystkich zmiennych i całkowitego opisu
                - ZABRONIONE jest parafrazowanie, skracanie lub omijanie jakiejkolwiek części formuły
            
                PROTOKÓŁ IDENTYFIKACJI MICROSOFT:
                3. IDENTYFIKACJA PRODUKTÓW MICROSOFT:
                - NAJPIERW przeszukaj SEKCJĘ II oraz SEKCJĘ IV pod kątem konkretnych nazw produktów
                - NASTĘPNIE utwórz listę znalezionych produktów Microsoft (M365, Office 365, Exchange, Teams, Azure, Windows Server)
                - Sprawdź typ umowy licencyjnej (EA, CSP, MPSA) - może być w różnych częściach dokumentu
                - Zidentyfikuj ilości licencji, jeśli są podane (zwykle w opisie części zamówienia)
            
                PROTOKÓŁ IDENTYFIKACJI PODZIAŁU NA CZĘŚCI:
                4. OFERTY CZĘŚCIOWE:
                - W podsekcji 4.1.8 oznaczonej jako "Możliwe jest składanie ofert częściowych" znajdź odpowiedź Tak/Nie
                - W podsekcji 4.1.9 oznaczonej jako "Liczba części" sprawdź ilość części
            
                PROTOKÓŁ IDENTYFIKACJI TERMINÓW:
                5. TERMIN REALIZACJI:
                - W podsekcji 4.2.10 oznaczonej jako "Okres realizacji zamówienia" znajdź informację o terminie
                - W SEKCJI VIII znajdź podsekcję "Termin składania ofert" dla deadline'u
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z PRECYZYJNYM wskazaniem kodów sekcji skąd pobrano informacje),
                  "products": array (znalezione konkretne produkty/usługi Microsoft),
                  "agreement_type": string (jeśli określono: EA, CSP, MPSA itp.),
                  "license_counts": object (pary produkt:ilość),
                  "values": {
                    "net": number | null (wartość netto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "gross": number | null (wartość brutto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "currency": string (waluta)
                  },
                  "scoring_criteria": {
                    "price_points": number | null (punkty za cenę, z sekcji 4.3.1),
                    "formula": string | null (KOMPLETNA formuła z sekcji 4.3.1, z zachowaniem całego opisu),
                    "other_criteria": array of objects with "name" and "points" properties (z sekcji 4.3.1-4.3.6)
                  },
                  "partial_offers_allowed": boolean | null (na podstawie sekcji 4.1.8),
                  "duration": string (z sekcji 4.2.10),
                  "deadline": string (termin składania ofert, z sekcji VIII)
                }
            
                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware
            
                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            },

            {
                name: "section_based_extraction",
                collection: "tender_analysis_regex_test_6",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące licencjonowania i usług Microsoft, stosując PRECYZYJNĄ EKSTRAKCJĘ BAZUJĄCĄ NA SEKCJACH. Każdą informację wyodrębnij WYŁĄCZNIE z właściwej sekcji:
            
                MAPA SEKCJI I PODSEKCJI DO PRECYZYJNEJ EKSTRAKCJI:
                1. WARTOŚĆ ZAMÓWIENIA:
                   - WYŁĄCZNE ŹRÓDŁO: Podsekcja 4.1.5, 4.1.6 (oznaczone jako "Wartość zamówienia") lub 4.2.5 (oznaczone jako "Wartość części")
                   - Format danych: Liczba + waluta (np. "175927,96 PLN")
                   - ZAKAZ interpretowania wartości z innych miejsc jako wartości zamówienia
                   - ZAKAZ sumowania jakichkolwiek wartości
            
                2. FORMUŁY PUNKTACJI:
                   - WYŁĄCZNE ŹRÓDŁO: Podsekcja 4.3.1 (oznaczona jako "Sposób oceny ofert")
                   - OBOWIĄZEK zachowania pełnego opisu formuły, w tym wzoru matematycznego i objaśnień wszystkich zmiennych
                   - Przykładowa formuła: "C min. K1 = ------------ x 60 C bad. gdzie: K1 – liczba punktów oferty badanej w tym kryterium, C min. – wartość minimalna (brutto)..."
                   - ZAKAZ skracania, parafrazowania lub upraszczania formułu
                
                3. WAGI KRYTERIÓW:
                   - WYŁĄCZNE ŹRÓDŁO: Podsekcje 4.3.2-4.3.6 (np. "Waga: 60")
                   - Ekstrakcja punktowej wartości dla każdego kryterium
               
                4. PRODUKTY MICROSOFT:
                   - ŹRÓDŁA: Sekcja II oraz Sekcja IV (zwłaszcza opisy części zamówienia w podsekcji 4.2.2)
                   - Poszukiwane produkty: Microsoft 365/M365, Office 365, Exchange Online, Teams, Azure, Windows Server, Entra ID
                   - Poszukiwane typy umów: EA, CSP, MPSA
                   - Poszukiwane ilości: liczby licencji dla każdego produktu
                
                5. PODZIAŁ NA CZĘŚCI:
                   - WYŁĄCZNE ŹRÓDŁO: Podsekcja 4.1.8 ("Możliwe jest składanie ofert częściowych: Tak/Nie")
                   - WYŁĄCZNE ŹRÓDŁO liczby części: Podsekcja 4.1.9 ("Liczba części: X")
                
                6. TERMINY:
                   - ŹRÓDŁO terminu realizacji: Podsekcja 4.2.10 ("Okres realizacji zamówienia")
                   - ŹRÓDŁO deadline: Sekcja VIII, podsekcja 8.1 ("Termin składania ofert")
            
                INSTRUKCJA WYMAGAJĄCA PRECYZYJNEJ EKSTRAKCJI WARTOŚCI ZAMÓWIENIA:
                1. NAJPIERW zlokalizuj DOKŁADNIE podsekcję 4.1.5, 4.1.6 lub 4.2.5 
                2. WYODRĘBNIJ DOSŁOWNIE wartość podaną w tej podsekcji
                3. NIGDY nie interpretuj innych liczb jako wartości zamówienia
                4. NIGDY nie sumuj wartości z różnych części
                5. Gdy zamówienie podzielone jest na części, a interesują nas części Microsoft, wyodrębnij wartości TYLKO dla tych części
            
                INSTRUKCJA WYMAGAJĄCA PRECYZYJNEJ EKSTRAKCJI FORMUŁY PUNKTACJI:
                1. NAJPIERW zlokalizuj DOKŁADNIE podsekcję 4.3.1
                2. SKOPIUJ KOMPLETNY opis formuły wraz ze wzorem i objaśnieniami zmiennych
                3. ZACHOWAJ oryginalne formatowanie, łącznie z podziałem na linie
                4. NIE POMIJAJ żadnej części formuły, nawet jeśli wydaje się powtarzalna
                5. Wyodrębnij wartości punktowe dla wszystkich kryteriów (cena, termin, inne)
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z precyzyjnym wskazaniem sekcji, z których pochodzą informacje),
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
                    "formula": string | null (KOMPLETNA formuła z sekcji 4.3.1, zachowując pełny opis),
                    "other_criteria": array of objects with "name" and "points" properties (z sekcji 4.3.2-4.3.6)
                  },
                  "partial_offers_allowed": boolean | null (na podstawie sekcji 4.1.8),
                  "duration": string (z sekcji 4.2.10),
                  "deadline": string (termin składania ofert, z sekcji VIII)
                }
            
                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware
            
                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            },

            {
                name: "exact_numeric_extraction",
                collection: "tender_analysis_regex_test_7",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft ze szczególnym naciskiem na PRECYZYJNĄ EKSTRAKCJĘ WARTOŚCI NUMERYCZNYCH. Celem jest uzyskanie dokładnych wartości bez interpretacji i sumowania.
            
                WARTOŚĆ ZAMÓWIENIA - PROTOKÓŁ EKSTRAKCJI:
                1. Zlokalizuj DOKŁADNIE jedną z poniższych podsekcji:
                   - Podsekcja 4.1.5 oznaczona jako "Wartość zamówienia" (np. "175927,96 PLN")
                   - Podsekcja 4.1.6 oznaczona jako "Wartość zamówienia stanowiącego przedmiot tego postępowania" (np. "175927,96 PLN")
                   - Podsekcja 4.2.5 oznaczona jako "Wartość części" (np. "94356,64 PLN")
                
                2. SKOPIUJ DOKŁADNIE liczbę podaną w tej sekcji:
                   - Zachowaj oryginalny format liczby (przecinki, kropki, spacje)
                   - Zachowaj oryginalną walutę (zwykle PLN)
                   - NIE MODYFIKUJ tej liczby w żaden sposób
                   - NIE SUMUJ różnych wartości, nawet jeśli logicznie się ze sobą wiążą
                   - NIGDY nie bierz wartości z innych sekcji niż wskazane
                
                3. Określ, czy wartość jest netto czy brutto:
                   - Szukaj określeń "netto", "brutto", "z VAT", "bez VAT"
                   - Jeśli nie ma jednoznacznego określenia, zaklasyfikuj jako "nieokreślona"
            
                FORMUŁA PUNKTACJI - PROTOKÓŁ EKSTRAKCJI:
                1. Zlokalizuj DOKŁADNIE podsekcję 4.3.1 oznaczoną jako "Sposób oceny ofert"
                
                2. SKOPIUJ CAŁĄ formułę obliczeniową:
                   - Zachowaj pełny wzór matematyczny (np. "C min. K1 = ------------ x 60 C bad.")
                   - Zachowaj wszystkie objaśnienia zmiennych (np. "gdzie: K1 – liczba punktów...")
                   - Zachowaj oryginalne formatowanie, łącznie z podziałem na linie
                   - NIE SKRACAJ formuły, nawet jeśli jest powtórzeniem standardowego wzoru
                   - NIE INTERPRETUJ formuły, podaj ją dokładnie tak, jak jest zapisana
                
                3. Wyodrębnij wagi punktowe dla wszystkich kryteriów:
                   - Z podsekcji 4.3.5-4.3.6 wyodrębnij nazwę kryterium i przypisaną mu wagę
                   - Typowo będzie to "Cena" z wagą np. 60% oraz inne kryteria
                   - Przeszukaj wszystkie podsekcje 4.3.X, aby znaleźć wszystkie kryteria
            
                PROTOKÓŁ IDENTYFIKACJI PRODUKTÓW MICROSOFT:
                1. Przeszukaj dokładnie:
                   - Podsekcję 4.2.2 "Krótki opis przedmiotu zamówienia"
                   - Nazwę zamówienia w SEKCJI II
                   - Inne opisy w SEKCJI IV
                
                2. Zidentyfikuj konkretne produkty Microsoft:
                   - Microsoft 365/M365 (z wariantami E3/E5/Business)
                   - Office 365
                   - Exchange Online
                   - Teams
                   - Azure
                   - Windows Server
                   - Entra ID (dawniej Azure AD)
                
                3. Określ liczby licencji:
                   - Wyodrębnij dokładne ilości dla każdego produktu
                   - Zachowaj powiązanie produkt-ilość
            
                PROTOKÓŁ IDENTYFIKACJI PODZIAŁU NA CZĘŚCI:
                1. Z podsekcji 4.1.8 wyodrębnij informację o możliwości składania ofert częściowych (Tak/Nie)
                2. Z podsekcji 4.1.9 wyodrębnij liczbę części
            
                PROTOKÓŁ IDENTYFIKACJI TERMINÓW:
                1. Z podsekcji 4.2.10 wyodrębnij okres realizacji zamówienia
                2. Z SEKCJI VIII, podsekcji 8.1 wyodrębnij termin składania ofert
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z podaniem DOKŁADNYCH numerów sekcji, z których wyodrębniono informacje),
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
                    "formula": string | null (KOMPLETNA formuła z sekcji 4.3.1, z zachowaniem pełnego opisu),
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
            },

            {
                name: "formula_preservation_expert",
                collection: "tender_analysis_regex_test_8",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft z ABSOLUTNYM PRIORYTETEM NA ZACHOWANIE PEŁNYCH FORMUŁ PUNKTACJI. Głównym celem jest dokładne skopiowanie formuł bez jakichkolwiek modyfikacji.
            
                FORMUŁA PUNKTACJI - PROTOKÓŁ EKSTRAKCJI ZE STUPROCENTOWĄ WIERNOŚCIĄ:
                1. ZNAJDŹ podsekcję 4.3.1 oznaczoną jako "Sposób oceny ofert"
                
                2. SKOPIUJ ABSOLUTNIE CAŁĄ FORMUŁĘ, znak po znaku:
                   - Włącznie z oryginalnymi spacjami, nową linią, wcięciami
                   - Włącznie ze wszystkimi symbolami matematycznymi (ułamki, znaki równości, etc.)
                   - Włącznie z pełnymi objaśnieniami wszystkich zmiennych
                   - Włącznie z numeracją punktów, jeśli występuje
                
                3. ZACHOWAJ PEŁNY KONTEKST formuły:
                   - Włącznie z wprowadzeniem do formuły (np. "Liczba punktów dla każdej oferty w tym kryterium zostanie wyliczona wg poniższego wzoru:")
                   - Włącznie z przykładami obliczeń, jeśli są podane
                   - Włącznie z dodatkowymi objaśnieniami po formule
                
                4. SKOPIUJ wzory matematyczne DOKŁADNIE tak, jak są zapisane:
                   - Z zachowaniem oryginalnego formatowania (np. "C min. K1 = ------------ x 60 C bad.")
                   - Nawet jeśli formuła zawiera nietypowe znaki lub formatowanie
            
                WARTOŚĆ ZAMÓWIENIA - PROTOKÓŁ EKSTRAKCJI Z BEZWZGLĘDNĄ PRECYZJĄ:
                1. ZNAJDŹ WYŁĄCZNIE jedną z następujących podsekcji:
                   - 4.1.5 oznaczoną jako "Wartość zamówienia" lub "Łączna wartość poszczególnych części zamówienia"
                   - 4.1.6 oznaczoną jako "Wartość zamówienia stanowiącego przedmiot tego postępowania"
                   - 4.2.5 oznaczoną jako "Wartość części"
                
                2. WYODRĘBNIJ DOKŁADNIE wartość liczbową podaną w tej sekcji:
                   - BEZ jakiejkolwiek modyfikacji (zachowaj oryginalny format liczby)
                   - NIGDY nie sumuj różnych wartości
                   - NIGDY nie bierz wartości z innych sekcji
                
                3. ZIDENTYFIKUJ, czy jest to wartość netto czy brutto:
                   - Szukaj określeń "netto", "brutto", "z VAT", "bez VAT"
                   - W przypadku wątpliwości zaklasyfikuj jako "nieokreślona"
            
                PRODUKTY MICROSOFT - PROTOKÓŁ SZCZEGÓŁOWEJ IDENTYFIKACJI:
                1. PRZESZUKAJ podsekcje:
                   - 2.3 (nazwa zamówienia)
                   - 4.2.2 (krótki opis przedmiotu zamówienia)
                
                2. ZIDENTYFIKUJ konkretne produkty i licencje Microsoft:
                   - Microsoft 365/M365 (z wariantami E3/E5/Business Premium)
                   - Office 365
                   - Exchange Online
                   - Teams
                   - Azure
                   - Windows Server
                   - Power BI, Power Automate, Power Apps
                   - Inne produkty z portfolio Microsoft
                
                3. OKREŚL ilości licencji:
                   - Dla każdego zidentyfikowanego produktu 
                   - Z zachowaniem powiązania produkt-ilość
            
                OGÓLNY PROTOKÓŁ ANALIZY:
                1. Dla każdej wartości podaj DOKŁADNY numer sekcji, z której została wyodrębniona
                2. Nigdy nie interpretuj ani nie modyfikuj wyodrębnionych wartości
                3. Zachowaj absolutną wierność oryginałowi, zwłaszcza dla formuł i wartości liczbowych
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z DOKŁADNYMI numerami sekcji),
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
                    "formula": string | null (ABSOLUTNIE PEŁNA formuła z sekcji 4.3.1, bez jakichkolwiek skrótów),
                    "other_criteria": array of objects with "name" and "points" properties
                  },
                  "partial_offers_allowed": boolean | null (na podstawie sekcji 4.1.8),
                  "duration": string (z sekcji 4.2.10),
                  "deadline": string (termin składania ofert, z sekcji VIII)
                }
            
                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware
            
                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            },

            {
                name: "sectional_extraction_pipeline",
                collection: "tender_analysis_regex_test_9",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft stosując ŚCISŁY PIPELINE EKSTRAKCJI SEKCYJNEJ. Przetwarzaj dokument systematycznie, sekcja po sekcji, z maksymalną precyzją i bez interpretacji.
            
                PIPELINE EKSTRAKCJI - RYGORYSTYCZNIE WYKONUJ KAŻDY KROK:
            
                KROK 1: IDENTYFIKACJA SEKCJI
                - Przeskanuj dokument i zidentyfikuj wszystkie główne sekcje (SEKCJA I, SEKCJA II, itd.)
                - Zidentyfikuj wszystkie podsekcje, zwłaszcza w SEKCJI IV (4.1.5, 4.1.6, 4.2.5, 4.3.1)
                - Zbuduj mapę dokumentu z precyzyjnymi lokalizacjami wszystkich istotnych sekcji
            
                KROK 2: EKSTRAKCJA WARTOŚCI ZAMÓWIENIA (TYLKO Z PODSEKCJI 4.1.5, 4.1.6 LUB 4.2.5)
                - ZNAJDŹ dokładnie podsekcję 4.1.5 oznaczoną jako "Wartość zamówienia" LUB
                - ZNAJDŹ dokładnie podsekcję 4.1.6 oznaczoną jako "Wartość zamówienia stanowiącego przedmiot tego postępowania" LUB
                - ZNAJDŹ dokładnie podsekcję 4.2.5 oznaczoną jako "Wartość części"
                - WYODRĘBNIJ dokładnie wartość liczbową z odpowiedniej podsekcji (np. "175927,96 PLN")
                - NIGDY nie sumuj różnych wartości, NIGDY nie interpretuj liczb z innych sekcji jako wartości zamówienia
                - ZWERYFIKUJ czy wartość jest określona jako netto czy brutto
            
                KROK 3: EKSTRAKCJA PEŁNEJ FORMUŁY PUNKTACJI (TYLKO Z PODSEKCJI 4.3.1)
                - ZNAJDŹ dokładnie podsekcję 4.3.1 oznaczoną jako "Sposób oceny ofert"
                - SKOPIUJ CAŁKOWITY opis formuły, znak po znaku, wraz z:
                  * Wprowadzeniem do formuły
                  * Pełnym wzorem matematycznym (np. "C min. K1 = ------------ x 60 C bad.")
                  * Wszystkimi objaśnieniami zmiennych (np. "gdzie: K1 – liczba punktów oferty badanej w tym kryterium")
                  * Wszystkimi przykładami i dodatkowymi objaśnieniami
                - ZACHOWAJ oryginalne formatowanie tekstu, w tym podziały na linie
                - NIE SKRACAJ, NIE PARAFRAZUJ, NIE MODYFIKUJ formuły w żaden sposób
            
                KROK 4: EKSTRAKCJA WAG KRYTERIÓW (Z PODSEKCJI 4.3.5 I 4.3.6)
                - ZNAJDŹ podsekcje 4.3.5 oznaczone jako "Nazwa kryterium" (np. "Cena")
                - ZNAJDŹ podsekcje 4.3.6 oznaczone jako "Waga" (np. "60")
                - WYODRĘBNIJ dokładne pary nazwa-waga dla wszystkich kryteriów oceny ofert
            
                KROK 5: IDENTYFIKACJA PRODUKTÓW MICROSOFT (Z SEKCJI II I IV)
                - PRZESZUKAJ nazwę zamówienia w SEKCJI II
                - PRZESZUKAJ podsekcję 4.2.2 "Krótki opis przedmiotu zamówienia"
                - ZIDENTYFIKUJ konkretne produkty Microsoft oraz ich ilości
                - SPRAWDŹ typ umowy licencyjnej (EA, CSP, MPSA)
            
                KROK 6: EKSTRAKCJA INFORMACJI O CZĘŚCIACH (Z PODSEKCJI 4.1.8 I 4.1.9)
                - SPRAWDŹ podsekcję 4.1.8 "Możliwe jest składanie ofert częściowych" (Tak/Nie)
                - SPRAWDŹ podsekcję 4.1.9 "Liczba części" (jeśli dotyczy)
            
                KROK 7: EKSTRAKCJA TERMINÓW (Z PODSEKCJI 4.2.10 I SEKCJI VIII)
                - ZNAJDŹ podsekcję 4.2.10 "Okres realizacji zamówienia"
                - ZNAJDŹ w SEKCJI VIII informację o terminie składania ofert
            
                KROK 8: ANALIZA CAŁOŚCIOWA
                - OCEŃ, czy ogłoszenie dotyczy licencjonowania/usług Microsoft
                - UZASADNIJ decyzję, podając dokładne numery sekcji, z których wyodrębniono kluczowe informacje
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z DOKŁADNYMI numerami sekcji),
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
                    "formula": string | null (ABSOLUTNIE PEŁNA formuła z sekcji 4.3.1),
                    "other_criteria": array of objects with "name" and "points" properties
                  },
                  "partial_offers_allowed": boolean | null (na podstawie sekcji 4.1.8),
                  "duration": string (z sekcji 4.2.10),
                  "deadline": string (termin składania ofert, z sekcji VIII)
                }
            
                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware
            
                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            },

            {
                name: "section_number_targeter",
                collection: "tender_analysis_regex_test_10",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft z wykorzystaniem PRECYZYJNYCH ADRESÓW SEKCJI. Obsługuj każdy dokument jako bazę danych z dokładnie określonymi adresami pól.
            
                INSTRUKCJA ADRESOWANIA PRECYZYJNEGO:
            
                1. WARTOŚĆ ZAMÓWIENIA - EKSTRAKCJA Z DOKŁADNYCH ADRESÓW:
                   - ADRES GŁÓWNY: Podsekcja 4.1.5 "Wartość zamówienia: [WARTOŚĆ] PLN" LUB
                   - ADRES ALTERNATYWNY 1: Podsekcja 4.1.6 "Wartość zamówienia stanowiącego przedmiot tego postępowania (bez VAT): [WARTOŚĆ] PLN" LUB
                   - ADRES ALTERNATYWNY 2: Podsekcja 4.2.5 "Wartość części: [WARTOŚĆ] PLN"
                   
                   INSTRUKCJA EKSTRAKCJI:
                   1. ZNAJDŹ dokładnie jedną z powyższych podsekcji
                   2. WYODRĘBNIJ precyzyjnie wartość liczbową wraz z walutą
                   3. NIGDY nie sumuj wartości z różnych podsekcji
                   4. NIGDY nie interpretuj innych liczb jako wartości zamówienia
                   5. SPRAWDŹ, czy wartość określona jest jako netto czy brutto
            
                2. FORMUŁA PUNKTACJI - EKSTRAKCJA Z DOKŁADNEGO ADRESU:
                   - ADRES GŁÓWNY: Podsekcja 4.3.1 "Sposób oceny ofert: [FORMUŁA]"
                   
                   INSTRUKCJA EKSTRAKCJI:
                   1. ZNAJDŹ dokładnie podsekcję 4.3.1
                   2. SKOPIUJ KOMPLETNY opis formuły, włącznie z:
                      - Wprowadzeniem
                      - Wzorem matematycznym (np. "C min. K1 = ------------ x 60 C bad.")
                      - Objaśnieniami wszystkich zmiennych
                   3. ZACHOWAJ oryginalne formatowanie, w tym podziały linii
                   4. NIE POMIJAJ żadnej części formuły
                   5. NIE PARAFRAZUJ ani NIE INTERPRETUJ formuły
            
                3. WAGI KRYTERIÓW - EKSTRAKCJA Z DOKŁADNYCH ADRESÓW:
                   - ADRES GŁÓWNY: Podsekcje 4.3.5 "Nazwa kryterium: [NAZWA]" i 4.3.6 "Waga: [WARTOŚĆ]"
                   
                   INSTRUKCJA EKSTRAKCJI:
                   1. ZNAJDŹ wszystkie pary podsekcji 4.3.5 i 4.3.6
                   2. WYODRĘBNIJ dokładne pary nazwa-waga dla wszystkich kryteriów
            
                4. PRODUKTY MICROSOFT - EKSTRAKCJA Z DOKŁADNYCH ADRESÓW:
                   - ADRES GŁÓWNY: Podsekcja 4.2.2 "Krótki opis przedmiotu zamówienia: [OPIS]"
                   - ADRES UZUPEŁNIAJĄCY: Sekcja 2.3 "Nazwa zamówienia: [NAZWA]"
                   
                   INSTRUKCJA EKSTRAKCJI:
                   1. PRZESZUKAJ oba adresy pod kątem produktów Microsoft
                   2. ZIDENTYFIKUJ konkretne produkty i ich ilości
                   3. SZUKAJ słów kluczowych: Microsoft, M365, Office, Exchange, Teams, Azure, Windows Server
            
                5. CZĘŚCI ZAMÓWIENIA - EKSTRAKCJA Z DOKŁADNYCH ADRESÓW:
                   - ADRES GŁÓWNY: Podsekcja 4.1.8 "Możliwe jest składanie ofert częściowych: [TAK/NIE]"
                   - ADRES UZUPEŁNIAJĄCY: Podsekcja 4.1.9 "Liczba części: [LICZBA]"
                   
                   INSTRUKCJA EKSTRAKCJI:
                   1. SPRAWDŹ podsekcję 4.1.8 dla informacji Tak/Nie
                   2. SPRAWDŹ podsekcję 4.1.9 dla liczby części (jeśli dotyczy)
            
                6. TERMINY - EKSTRAKCJA Z DOKŁADNYCH ADRESÓW:
                   - ADRES GŁÓWNY REALIZACJI: Podsekcja 4.2.10 "Okres realizacji zamówienia: [OKRES]"
                   - ADRES DEADLINE'U: Podsekcja 8.1 "Termin składania ofert: [DATA I GODZINA]"
                   
                   INSTRUKCJA EKSTRAKCJI:
                   1. WYODRĘBNIJ dokładne wartości z obu adresów
            
                KOMPLETNY PROTOKÓŁ EKSTRAKCJI:
                1. MAPOWANIE: Przeskanuj dokument i zbuduj mapę wszystkich sekcji z ich dokładnymi adresami
                2. EKSTRAKCJA Z ADRESÓW: Wyodrębnij dane TYLKO z precyzyjnie określonych adresów
                3. WERYFIKACJA: Dla każdej wartości zanotuj dokładny adres źródłowy
                4. ANALIZA: Oceń, czy ogłoszenie dotyczy licencjonowania/usług Microsoft
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z PRECYZYJNYMI adresami sekcji),
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
                    "formula": string | null (KOMPLETNA formuła z sekcji 4.3.1),
                    "other_criteria": array of objects with "name" and "points" properties
                  },
                  "partial_offers_allowed": boolean | null (na podstawie sekcji 4.1.8),
                  "duration": string (z sekcji 4.2.10),
                  "deadline": string (termin składania ofert, z sekcji 8.1)
                }
            
                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware
            
                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            },

            {
                name: "direct_content_extractor",
                collection: "tender_analysis_regex_test_11",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft poprzez BEZPOŚREDNIĄ EKSTRAKCJĘ ZAWARTOŚCI. Zamiast interpretować dane, kopiuj je DOKŁADNIE tak, jak są zapisane w dokumencie.
            
                INSTRUKCJA BEZPOŚREDNIEJ EKSTRAKCJI:
            
                1. WARTOŚĆ ZAMÓWIENIA - DOSŁOWNA EKSTRAKCJA:
                   - ŹRÓDŁO: Podsekcja 4.1.5 "Wartość zamówienia" LUB 4.1.6 "Wartość zamówienia stanowiącego przedmiot tego postępowania" LUB 4.2.5 "Wartość części"
                   - METODOLOGIA: Skopiuj DOKŁADNIE tekst wartości, tak jak jest zapisany (np. "175927,96 PLN")
                   - ZAKAZY: 
                     * NIE sumuj wartości 
                     * NIE modyfikuj formatu liczby
                     * NIE zaokrąglaj
                     * NIE interpretuj wartości z innych miejsc
                   - WERYFIKACJA: Sprawdź, czy wartość jest oznaczona jako netto/brutto
            
                2. FORMUŁA PUNKTACJI - DOSŁOWNA EKSTRAKCJA:
                   - ŹRÓDŁO: Podsekcja 4.3.1 "Sposób oceny ofert"
                   - METODOLOGIA: Skopiuj DOSŁOWNIE całą treść opisu formuły, tak jak jest zapisana, włącznie z:
                     * Wszystkimi wprowadzeniami i wstępami
                     * Dokładnym wzorem matematycznym (np. "C min. K1 = ------------ x 60 C bad.")
                     * Wszystkimi objaśnieniami zmiennych
                     * Wszystkimi przykładami i dodatkowymi wyjaśnieniami
                   - ZAKAZY:
                     * NIE skracaj formuły
                     * NIE parafrazuj
                     * NIE interpretuj
                     * NIE pomijaj żadnej części, nawet jeśli wydaje się redundantna
                   - WERYFIKACJA: Upewnij się, że skopiowano formułę w całości, bez pomijania jakiejkolwiek części
            
                3. PRODUKTY MICROSOFT - BEZPOŚREDNIA IDENTYFIKACJA:
                   - ŹRÓDŁO: Podsekcja 4.2.2 "Krótki opis przedmiotu zamówienia" i nazwa zamówienia w SEKCJI II
                   - METODOLOGIA: Zidentyfikuj i wymień DOKŁADNIE te produkty Microsoft, które są WYRAŹNIE wymienione
                   - ZAKAZY:
                     * NIE domyślaj się produktów, które nie są wyraźnie wymienione
                     * NIE interpretuj ogólnych kategorii jako konkretnych produktów
                   - WERYFIKACJA: Wymień tylko produkty, które są jednoznacznie i bezpośrednio wymienione
            
                4. INNE INFORMACJE - BEZPOŚREDNIA EKSTRAKCJA:
                   - Oferty częściowe: Podsekcja 4.1.8 "Możliwe jest składanie ofert częściowych" - skopiuj DOKŁADNIE "Tak" lub "Nie"
                   - Okres realizacji: Podsekcja 4.2.10 "Okres realizacji zamówienia" - skopiuj DOKŁADNIE pełną treść
                   - Deadline: SEKCJA VIII, podsekcja "Termin składania ofert" - skopiuj DOKŁADNIE datę i godzinę
            
                INSTRUKCJA OGÓLNA:
                - Traktuj dokument jak bazę danych, z której wyodrębnisz DOKŁADNIE to, co jest zapisane
                - NIE interpretuj, NIE parafrazuj, NIE modyfikuj wyodrębnionych wartości
                - Dla każdej wartości podaj DOKŁADNY numer sekcji źródłowej
                - Jeśli w dokumencie nie ma informacji w podanej sekcji, użyj wartości null
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie WYRAŹNIE dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z DOKŁADNYMI numerami sekcji, z których wyodrębniono informacje),
                  "products": array (DOKŁADNIE zacytowane produkty/usługi Microsoft),
                  "agreement_type": string (DOKŁADNIE zacytowany typ umowy, jeśli określono: EA, CSP, MPSA),
                  "license_counts": object (DOKŁADNIE zacytowane pary produkt:ilość),
                  "values": {
                    "net": number | null (DOKŁADNIE zacytowana wartość netto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "gross": number | null (DOKŁADNIE zacytowana wartość brutto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "currency": string (DOKŁADNIE zacytowana waluta)
                  },
                  "scoring_criteria": {
                    "price_points": number | null (DOKŁADNIE zacytowana wartość punktowa ceny),
                    "formula": string | null (DOSŁOWNIE zacytowana, KOMPLETNA formuła z sekcji 4.3.1),
                    "other_criteria": array of objects with "name" and "points" properties (DOKŁADNIE zacytowane)
                  },
                  "partial_offers_allowed": boolean | null (na podstawie DOKŁADNIE zacytowanej wartości z sekcji 4.1.8),
                  "duration": string (DOKŁADNIE zacytowany okres z sekcji 4.2.10),
                  "deadline": string (DOKŁADNIE zacytowany termin z SEKCJI VIII)
                }
            
                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware
            
                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            },

            {
                name: "dual_priority_extractor",
                collection: "tender_analysis_regex_test_12",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft, stosując ekstrakcję z PODWÓJNYM PRIORYTETEM: Absolutna precyzja dla WARTOŚCI ZAMÓWIENIA i PEŁNA WIERNOŚĆ dla FORMUŁ PUNKTACJI.
            
                PRIORYTET 1: PRECYZYJNA EKSTRAKCJA WARTOŚCI ZAMÓWIENIA
                
                WARTOŚĆ ZAMÓWIENIA - PROCEDURA EKSTRAKCJI O NAJWYŻSZYM PRIORYTECIE:
                1. ZNAJDŹ dokładnie jedną z tych podsekcji:
                   - 4.1.5 "Wartość zamówienia" lub "Łączna wartość poszczególnych części zamówienia"
                   - 4.1.6 "Wartość zamówienia stanowiącego przedmiot tego postępowania"
                   - 4.2.5 "Wartość części"
                
                2. WYODRĘBNIJ DOKŁADNIE wartość liczbową:
                   - Skopiuj dokładnie liczbę bez żadnych modyfikacji (np. "175927,96 PLN")
                   - Zachowaj oryginalny format (separatory, spacje, walutę)
                   - NIGDY nie sumuj różnych wartości
                   - NIGDY nie interpretuj innych liczb jako wartości zamówienia
                
                3. OKREŚL, czy to wartość netto czy brutto:
                   - Szukaj określeń "netto", "bez VAT" dla wartości netto
                   - Szukaj określeń "brutto", "z VAT" dla wartości brutto
                
                4. PRZYPISZ wartość z najwyższą pewnością:
                   - Jeśli znaleziono wartość netto, przypisz ją do "net"
                   - Jeśli znaleziono wartość brutto, przypisz ją do "gross"
                   - Jeśli nie ma jednoznacznego określenia, zaklasyfikuj zgodnie z najprawdopodobniejszym oznaczeniem
            
                PRIORYTET 2: WIERNA EKSTRAKCJA FORMUŁY PUNKTACJI
                
                FORMUŁA PUNKTACJI - PROCEDURA EKSTRAKCJI O NAJWYŻSZYM PRIORYTECIE:
                1. ZNAJDŹ dokładnie podsekcję 4.3.1 "Sposób oceny ofert"
                
                2. SKOPIUJ ABSOLUTNIE CAŁĄ formułę:
                   - Włącznie z wprowadzeniem (np. "Liczba punktów dla każdej oferty w tym kryterium zostanie wyliczona wg poniższego wzoru:")
                   - Włącznie z pełnym wzorem matematycznym (np. "C min. K1 = ------------ x 60 C bad.")
                   - Włącznie z kompletnym objaśnieniem wszystkich zmiennych (np. "gdzie: K1 – liczba punktów...")
                   - Włącznie z wszelkimi przykładami i dodatkowymi wyjaśnieniami
                
                3. ZACHOWAJ:
                   - Oryginalne formatowanie, włącznie z podziałami na linie
                   - Wszystkie symbole i znaki specjalne
                   - Pełną strukturę tekstu
                
                4. ABSOLUTNIE ZAKAZANE jest:
                   - Skracanie formuły
                   - Parafrazowanie jakiejkolwiek części
                   - Pomijanie objaśnień, nawet jeśli są obszerne
                   - Jakiekolwiek upraszczanie oryginalnego tekstu
            
                WAGI KRYTERIÓW - EKSTRAKCJA UZUPEŁNIAJĄCA:
                1. Z podsekcji 4.3.5 i 4.3.6 wyodrębnij dokładne wartości punktowe dla wszystkich kryteriów
                2. Zapisz pary nazwa-waga dla każdego kryterium
            
                PRODUKTY MICROSOFT - EKSTRAKCJA Z NAJWYŻSZĄ DOKŁADNOŚCIĄ:
                1. Z SEKCJI II (nazwa zamówienia) i podsekcji 4.2.2 (krótki opis) zidentyfikuj wszystkie produkty Microsoft
                2. Wypisz DOKŁADNIE nazwy produktów, tak jak są zapisane w dokumencie
                3. Dla każdego produktu określ ilość licencji, jeśli jest podana
            
                SYNTEZA KOŃCOWA - OBOWIĄZKOWA WERYFIKACJA:
                1. Dla każdej wartości podaj DOKŁADNY numer sekcji źródłowej
                2. ZWERYFIKUJ, czy wartości i formuły są skopiowane z absolutną wiernością
                3. UPEWNIJ się, że nie dokonano żadnej interpretacji ani modyfikacji
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z DOKŁADNYMI numerami sekcji),
                  "products": array (DOKŁADNIE zidentyfikowane produkty/usługi Microsoft),
                  "agreement_type": string (jeśli określono: EA, CSP, MPSA itp.),
                  "license_counts": object (pary produkt:ilość),
                  "values": {
                    "net": number | null (wartość netto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "gross": number | null (wartość brutto, WYŁĄCZNIE z sekcji 4.1.5/4.1.6/4.2.5),
                    "currency": string (waluta)
                  },
                  "scoring_criteria": {
                    "price_points": number | null (punkty za cenę, z sekcji 4.3.5-4.3.6),
                    "formula": string | null (ABSOLUTNIE KOMPLETNA formuła z sekcji 4.3.1),
                    "other_criteria": array of objects with "name" and "points" properties
                  },
                  "partial_offers_allowed": boolean | null (na podstawie sekcji 4.1.8),
                  "duration": string (z sekcji 4.2.10),
                  "deadline": string (termin składania ofert, z sekcji VIII)
                }
            
                Wyklucz jeśli:
                - Ogólne wzmianki o IT/oprogramowaniu bez konkretnego odniesienia do Microsoft
                - Sprzęt/urządzenia są głównym celem zakupu, a nie licencjonowanie
                - Wzmianki o Microsoft niezwiązane z licencjonowaniem
                - Zawiera: Microsoft Edge/Edge, Surface, Xbox, hardware
            
                Dla save=true, przetarg musi wyraźnie dotyczyć licencjonowania oprogramowania/chmury Microsoft.
                Użyj null dla brakujących wartości. Waluta powinna być PLN, jeśli nie określono inaczej.`
            },

            {
                name: "comprehensive_extraction_system",
                collection: "tender_analysis_regex_test_13",
                systemPrompt: `Analizuj ogłoszenia przetargowe dotyczące Microsoft z wykorzystaniem KOMPLEKSOWEGO SYSTEMU EKSTRAKCJI, który łączy najskuteczniejsze techniki precyzyjnego wyodrębniania wartości i formuł.
            
                SYSTEM EKSTAKCJI WARTOŚCI ZAMÓWIENIA:
                
                KROK 1: LOKALIZACJA PRECYZYJNA
                - Znajdź DOKŁADNIE podsekcję 4.1.5 "Wartość zamówienia" LUB 4.1.6 "Wartość zamówienia stanowiącego przedmiot tego postępowania" LUB 4.2.5 "Wartość części"
                - Nie pomyl z innymi sekcjami zawierającymi wartości liczbowe
                
                KROK 2: EKSTRAKCJA DOSŁOWNA
                - Skopiuj DOKŁADNIE wartość liczbową wraz z walutą (np. "175927,96 PLN")
                - Zachowaj oryginalny format liczby (przecinki, kropki, spacje)
                
                KROK 3: KLASYFIKACJA NET/GROSS
                - Zidentyfikuj, czy wartość jest określona jako netto ("bez VAT", "netto") czy brutto ("z VAT", "brutto")
                - Przypisz wartość do odpowiedniego pola (net/gross)
                
                KROK 4: WERYFIKACJA INTEGRALNOŚCI
                - NIGDY nie sumuj wartości, nawet jeśli są powiązane
                - NIGDY nie interpretuj innych liczb jako wartości zamówienia
                - Użyj WYŁĄCZNIE wartości z określonych podsekcji
            
                SYSTEM EKSTRAKCJI FORMUŁY PUNKTACJI:
                
                KROK 1: LOKALIZACJA PRECYZYJNA
                - Znajdź DOKŁADNIE podsekcję 4.3.1 "Sposób oceny ofert"
                
                KROK 2: EKSTRAKCJA PEŁNEGO KONTEKSTU
                - Skopiuj wprowadzenie do formuły (np. "Liczba punktów dla każdej oferty w tym kryterium zostanie wyliczona wg poniższego wzoru:")
                - Skopiuj pełny wzór matematyczny (np. "C min. K1 = ------------ x 60 C bad.")
                - Skopiuj wszystkie objaśnienia zmiennych (np. "gdzie: K1 – liczba punktów...")
                
                KROK 3: ZACHOWANIE STRUKTURY
                - Zachowaj oryginalne formatowanie, włącznie z podziałami na linie
                - Zachowaj wszystkie symbole i znaki specjalne
                
                KROK 4: WERYFIKACJA KOMPLETNOŚCI
                - Upewnij się, że skopiowano CAŁĄ formułę, bez pomijania jakiejkolwiek części
                - Sprawdź, czy wszystkie objaśnienia zmiennych są kompletne
            
                SYSTEM EKSTRAKCJI PRODUKTÓW MICROSOFT:
                
                KROK 1: LOKALIZACJA ŹRÓDEŁ
                - Przeszukaj nazwę zamówienia w SEKCJI II
                - Przeszukaj opis przedmiotu zamówienia w podsekcji 4.2.2
                
                KROK 2: IDENTYFIKACJA PRODUKTÓW
                - Zidentyfikuj konkretne produkty Microsoft (M365, Office 365, Exchange, Teams, Azure, Windows Server)
                - Wyodrębnij dokładne nazwy, tak jak są zapisane w dokumencie
                
                KROK 3: EKSTRAKCJA ILOŚCI
                - Dla każdego produktu zidentyfikuj ilość licencji, jeśli jest podana
                - Zachowaj powiązanie produkt-ilość
                
                KROK 4: IDENTYFIKACJA TYPU UMOWY
                - Sprawdź, czy jest określony typ umowy licencyjnej (EA, CSP, MPSA)
            
                SYSTEM EKSTRAKCJI DODATKOWYCH INFORMACJI:
                
                1. Oferty częściowe:
                   - Z podsekcji 4.1.8 "Możliwe jest składanie ofert częściowych" wyodrębnij wartość Tak/Nie
                
                2. Terminy:
                   - Z podsekcji 4.2.10 "Okres realizacji zamówienia" wyodrębnij informację o czasie trwania
                   - Z SEKCJI VIII wyodrębnij termin składania ofert
            
                KOMPLEKSOWA SYNTEZA:
                
                1. Dla każdej wyodrębnionej wartości podaj DOKŁADNY numer sekcji źródłowej
                2. Oceń, czy ogłoszenie dotyczy licencjonowania/usług Microsoft
                3. Uzasadnij decyzję, podając konkretne produkty i usługi znalezione w dokumencie
            
                Zwróć JSON:
                {
                  "save": boolean (true tylko jeśli ogłoszenie dotyczy licencjonowania/usług Microsoft),
                  "message": string (uzasadnienie z DOKŁADNYMI numerami sekcji),
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
                    "formula": string | null (KOMPLETNA formuła z sekcji 4.3.1),
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

            // Create indexes for all collections
            for (const prompt of this.prompts) {
                const collection = this.db.db.collection(prompt.collection);
                await collection.createIndexes([
                    {key: {tenderId: 1}, unique: true},
                    {key: {save: 1}},
                    {key: {"values.net": 1}},
                    {key: {"values.gross": 1}},
                    {key: {deadline: 1}},
                    {key: {processedAt: 1}},
                    {key: {"source_tender.number": 1}}
                ]);
                logger.info(`Created indexes for collection: ${prompt.collection}`);
            }

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
                logger.info(`Starting processing with prompt "${promptConfig.name}" to collection "${promptConfig.collection}"`);
                const newCollection = this.db.db.collection(promptConfig.collection);

                for (const tender of tenders) {
                    try {
                        // Skip if already processed in this collection
                        const existing = await newCollection.findOne({tenderId: tender.tenderId});
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
                            processorVersion: "3.0"
                        };

                        await newCollection.insertOne(analysisDoc);
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
                    {role: "system", content: systemPrompt},
                    {role: "user", content: tender.fullContent}
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
                values: {net: null, gross: null, currency: 'PLN'},
                scoring_criteria: {price_points: null, formula: null, other_criteria: []},
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
                values: {net: null, gross: null, currency: 'PLN'},
                scoring_criteria: {price_points: null, formula: null, other_criteria: []},
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