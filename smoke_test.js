const { connect } = require("puppeteer-real-browser");

(async () => {
    const tipoDocumento = '1';
    const numeroDocumento = '48213083';

    console.log(`[CONSULTA] Tipo: DNI, Número: ${numeroDocumento} (Usando puppeteer-real-browser headless=new)`);

    try {
        const { browser, page } = await connect({
            headless: false, // Must be false to let puppeteer-real-browser logic run, but we override in args
            customConfig: {
                args: ['--headless=new', '--hide-scrollbars', '--mute-audio']
            },
            turnstile: true,
            disableXvfb: true, // We are on windows
            ignoreAllFlags: false
        });

        await page.goto('https://checatuslineas.osiptel.gob.pe/', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        await page.waitForSelector('#IdTipoDoc', { timeout: 10000 });

        await page.select('#IdTipoDoc', tipoDocumento);
        await new Promise(r => setTimeout(r, 1000));

        await page.type('#NumeroDocumento', numeroDocumento, { delay: 100 });
        await new Promise(r => setTimeout(r, 1000));

        let scoreReceived = null;
        let dataReceived = false;
        let apiResponseText = null;

        const responsePromise = new Promise((resolve) => {
            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('GetAllCabeceraConsulta') || url.includes('apiConsulta')) {
                    try {
                        apiResponseText = await response.text();
                        try {
                            const json = JSON.parse(apiResponseText);
                            if (json.score !== undefined) {
                                scoreReceived = json.score;
                            }
                            if (json.aaData && json.aaData.length > 0) {
                                dataReceived = true;
                            }
                        } catch (e) { }
                        resolve(apiResponseText);
                    } catch (e) { }
                }
            });
        });

        await page.click('#btnBuscar', { delay: 50 });

        try {
            await Promise.race([
                responsePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de API')), 10000))
            ]);
        } catch (e) { }

        await new Promise(r => setTimeout(r, 2000));

        if (dataReceived || (scoreReceived !== null && scoreReceived >= 0.5)) {
            try {
                const resultData = JSON.parse(apiResponseText);
                if (resultData && resultData.aaData && resultData.aaData.length > 0) {
                    console.log('\n--- RESULTADO FINAL SOLICITADO ---\n');
                    resultData.aaData.forEach((row, i) => {
                        let phone = row[2];
                        if (typeof phone === 'string') {
                            phone = phone.replace(/(<([^>]+)>)/gi, "").trim();
                        }
                        console.log(phone);
                    });
                    console.log('\n----------------------------------\n');
                } else {
                    console.log('API respondió pero la lista está vacía. Score:', scoreReceived);
                }
            } catch (err) { }
        } else {
            console.log(`Fallo por score reCAPTCHA bajo. Score: ${scoreReceived}`);
        }

        await browser.close();

    } catch (error) {
        console.error('ERROR:', error.message);
    }
})();
