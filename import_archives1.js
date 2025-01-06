const { chromium, firefox, webkit } = require('playwright');
const mysql = require('mysql2/promise');
const { execSync } = require('child_process');

// Lista User-Agent
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
];

(async () => {
    // Restart Tor przed przetwarzaniem każdego bloga
    const restartTor = () => {
        try {
            console.log("Restartowanie Tora...");
            execSync('sudo systemctl restart tor');
            console.log("Tor został zrestartowany.");
        } catch (error) {
            console.error("Błąd podczas restartowania Tora:", error.message);
        }
    };

    // Konfiguracja bazy danych
    const dbConfig = {
        host: 'localhost',
        user: 'root',
        password: 'Blogger123!',
        database: 'blog_database'
    };

    const connection = await mysql.createConnection(dbConfig);

    // Pobierz wszystkie blogi z tabeli Blogs
    const [blogs] = await connection.execute('SELECT id, url FROM Blogs');
    console.log(`Znaleziono ${blogs.length} blogów do przetworzenia.`);

    for (const blog of blogs) {
        const { id: blogId, url: blogUrl } = blog;
        console.log(`Przetwarzanie bloga ID: ${blogId}, URL: ${blogUrl}`);

        restartTor(); // Restart Tor przed każdym blogiem

        // Losuj przeglądarkę i User-Agent
        const browserType = [chromium, firefox, webkit][Math.floor(Math.random() * 3)];
        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

        let browser, context, page;

        try {
            // Inicjalizacja przeglądarki
            browser = await browserType.launch({
                headless: false,
                proxy: { server: 'socks5://127.0.0.1:9050' }
            });
            context = await browser.newContext({
                userAgent: userAgent,
                viewport: { width: 1920, height: 1080 },
                locale: 'pl-PL',
                timezoneId: 'Europe/Warsaw'
            });
            page = await context.newPage();

            // Otwieranie strony bloga
            await page.goto(blogUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            console.log(`Załadowano stronę bloga ID: ${blogId}`);

            // Pobieranie postów
            const posts = await page.evaluate(() => {
                const archive = document.querySelector('#BlogArchive1');
                if (!archive) return [];
                const postElements = archive.querySelectorAll('ul.posts li a');
                return Array.from(postElements).map(post => ({
                    title: post.textContent.trim(),
                    url: post.href
                }));
            });
            console.log(`Pobrano ${posts.length} postów dla bloga ID: ${blogId}`);

            // Iteracja przez posty i zapis do bazy danych
            for (const post of posts) {
                const [existingPost] = await connection.execute(
                    'SELECT id FROM Posts WHERE blog_id = ? AND url = ? LIMIT 1',
                    [blogId, post.url]
                );

                if (existingPost.length > 0) {
                    console.log(`Post już istnieje: ${post.title}`);
                    continue;
                }

                const mobileUrl = post.url.includes('?') ? `${post.url}&m=1` : `${post.url}?m=1`;

                await connection.execute(
                    'INSERT INTO Posts (blog_id, url, title, mobile_url) VALUES (?, ?, ?, ?)',
                    [blogId, post.url, post.title, mobileUrl]
                );
                console.log(`Zapisano nowy post: ${post.title}`);
            }
        } catch (error) {
            console.error(`Błąd podczas przetwarzania bloga ID: ${blogId}:`, error.message);
        } finally {
            // Zamknięcie zasobów w finally
            if (page) await page.close();
            if (context) await context.close();
            if (browser) await browser.close();
        }
    }

    // Zamknięcie połączenia z bazą danych
    await connection.end();
    console.log("Zakończono przetwarzanie blogów.");
})();

