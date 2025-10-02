import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, KeyValueStore, log } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() || {
    query: "dentists in Manchester",  // niche + city
    limit: 20                          // max results to return
};

// Key-Value Store to remember scraped businesses (so no duplicates across runs)
const store = await KeyValueStore.open('NO_WEBSITE_BUSINESSES');
let alreadyScraped = (await store.getValue('SCRAPED')) || [];

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 200, // safety limit
    headless: true,

    async requestHandler({ page, request }) {
        log.info(`Scraping: ${request.url}`);

        // Business name
        const name = await page.textContent('h1.DUwDvf span') || null;

        // GMB link (unique business ID)
        const gmbLink = request.url;

        // Address
        const address = await page.textContent('button[data-item-id="address"] div span') || null;

        // Phone
        const phone = await page.textContent('button[data-item-id*="phone"] div span') || null;

        // Website (we only want businesses without this)
        const website = await page.getAttribute('a[data-item-id="authority"]', 'href');

        // Try to grab email if shown (Google rarely shows this)
        let email = null;
        try {
            email = await page.textContent('a[href^="mailto:"]') || null;
        } catch (e) {}

        // Only save if NO website and not scraped before
        if ((!website || website.trim() === "") && !alreadyScraped.includes(gmbLink)) {
            const business = { name, gmbLink, address, phone, email };

            await Dataset.pushData(business);

            // Save ID to memory
            alreadyScraped.push(gmbLink);
            await store.setValue('SCRAPED', alreadyScraped);

            log.info(`✅ Saved business: ${name}`);
        }

        // Stop if we hit the user limit
        if (input.limit && Dataset.getInfo().itemCount >= input.limit) {
            log.info(`Reached limit of ${input.limit}, stopping crawler.`);
            await crawler.teardown();
        }
    },
});

// Start search
await crawler.run([`https://www.google.com/maps/search/${encodeURIComponent(input.query)}`]);

await Actor.exit();