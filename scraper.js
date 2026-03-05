const fs = require('fs');
const xlsx = require('xlsx');
const { connect } = require('puppeteer-real-browser');

const INPUT_FILE = 'input.txt';
const CHUNK_SIZE = 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function saveExcel(data, chunkIndex, isFinal = false) {
    if (data.length === 0) return;

    const exportData = data.map(linea => ({
        "Documento Relacionado": linea.documento || '-',
        "Número N°": linea.numero,
        "Operador": linea.operador,
        "Modalidad": linea.modalidad,
        "Teléfono": linea.telefono
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(exportData);

    ws['!cols'] = [{ wch: 15 }, { wch: 10 }, { wch: 25 }, { wch: 15 }, { wch: 20 }];

    xlsx.utils.book_append_sheet(wb, ws, "Líneas OSIPTEL");

    const fileName = isFinal ? `OSIPTEL_Resultados_Final.xlsx` : `OSIPTEL_Resultados_Parte_${chunkIndex}.xlsx`;
    xlsx.writeFile(wb, fileName);
    console.log(`[+] Archivo guardado con éxito: ${fileName} con ${data.length} registros telefónicos.`);
}

(async () => {
    console.log("=== INICIANDO BOT EXTERNO DE EXTRACCIÓN MASIVA ===");

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Error: No se encontró el archivo ${INPUT_FILE}. Por favor créalo y añade los documentos línea por línea.`);
        process.exit(1);
    }

    const rawInput = fs.readFileSync(INPUT_FILE, 'utf-8');
    const documentos = rawInput.split('\n').map(d => d.trim()).filter(d => d.length > 0);

    if (documentos.length === 0) {
        console.log("El archivo de entrada está vacío.");
        process.exit(0);
    }

    console.log(`[INFO] Se cargaron ${documentos.length} documentos para consultar.`);

    let globalFoundLineas = [];
    let currentChunkLineas = [];
    let currentChunkIndex = 1;
    let browser;
    let page;

    try {
        console.log("[INFO] Levantando Stealth Browser en la máquina virtual...");
        const connection = await connect({
            headless: false, // Required false for puppeteer-real-browser core
            customConfig: {
                args: ['--headless=new', '--hide-scrollbars', '--mute-audio', '--no-sandbox', '--disable-setuid-sandbox']
            },
            turnstile: true,
            disableXvfb: false, // We'll be on Linux github runners, so we need xvfb simulation
            ignoreAllFlags: false
        });

        browser = connection.browser;
        page = connection.page;

        for (let i = 0; i < documentos.length; i++) {
            const numero = documentos[i];
            console.log(`\n[${i + 1}/${documentos.length}] Consultando DNI: ${numero}...`);

            let apiResponseText = null;
            let capturedData = null;

            try {
                await page.goto('https://checatuslineas.osiptel.gob.pe/', { waitUntil: 'networkidle2', timeout: 30000 });
                await page.waitForSelector('#IdTipoDoc', { timeout: 10000 });

                await page.select('#IdTipoDoc', '1'); // Fixed to DNI for this massive scan
                await sleep(500 + Math.random() * 500);

                await page.type('#NumeroDocumento', numero, { delay: 50 + Math.random() * 50 });
                await sleep(500 + Math.random() * 500);

                const responsePromise = new Promise((resolve) => {
                    const handler = async (response) => {
                        const url = response.url();
                        if (url.includes('GetAllCabeceraConsulta') || url.includes('apiConsulta')) {
                            // Only capture successful responses with body data to dodge pre-flight OPTIONS requests
                            if (response.status() === 200) {
                                try {
                                    apiResponseText = await response.text();
                                    if (apiResponseText.length > 20) {
                                        capturedData = JSON.parse(apiResponseText);
                                        page.off('response', handler);
                                        resolve();
                                    }
                                } catch (e) { resolve(); }
                            }
                        }
                    };
                    page.on('response', handler);
                });

                await page.click('#btnBuscar', { delay: 30 });

                try {
                    await Promise.race([
                        responsePromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout API')), 10000))
                    ]);
                } catch (e) { }

                await sleep(1500);

                if (capturedData && capturedData.success && capturedData.data && capturedData.data.length > 0) {
                    // Adapt OSIPTEL's raw array array format (if it matches server.js structure we need to clean HTML tags like in server.js)
                    // The site uses an array of arrays under aaData or direct objects if updated. 
                    // To be safe we'll use same logic as server.js
                    // Actually, let's look at server.js to mimic the parsing accurately
                }

                // Parsing exact same way as server.js
                let lineasFormateadas = [];
                if (capturedData && capturedData.aaData) {
                    lineasFormateadas = capturedData.aaData.map((row) => {
                        let originalPhone = row[2];
                        let cleanPhone = typeof originalPhone === 'string' ? originalPhone.replace(/(<([^>]+)>)/gi, "").trim() : originalPhone;
                        let cleanOperador = typeof row[3] === 'string' ? row[3].replace(/(<([^>]+)>)/gi, "").trim() : row[3];
                        let cleanModalidad = typeof row[1] === 'string' ? row[1].replace(/(<([^>]+)>)/gi, "").trim() : row[1];

                        return {
                            documento: numero,
                            numero: row[0],
                            operador: cleanOperador,
                            telefono: cleanPhone,
                            modalidad: cleanModalidad
                        };
                    });
                } else if (capturedData && capturedData.lineas) {
                    lineasFormateadas = capturedData.lineas.map(l => ({ ...l, documento: numero }));
                }

                if (lineasFormateadas.length > 0) {
                    console.log(`   └─ ¡Éxito! Se encontraron ${lineasFormateadas.length} líneas.`);
                    globalFoundLineas.push(...lineasFormateadas);
                    currentChunkLineas.push(...lineasFormateadas);
                } else {
                    console.log(`   └─ Sin resultados o bloqueado.`);
                }

                // Check point to export chunk
                if ((i + 1) % CHUNK_SIZE === 0) {
                    console.log(`\n[INFO] Límite de ${CHUNK_SIZE} consultas alcanzado. Exportando Chunk parcial...`);
                    saveExcel(currentChunkLineas, currentChunkIndex);
                    currentChunkIndex++;
                    currentChunkLineas = []; // Reset current chunk
                }

            } catch (err) {
                console.error(`   └─ Fallo general consultando ${numero}: ${err.message}`);
            }

            // Anti-bot delay between each document
            if (i < documentos.length - 1) {
                await sleep(1000 + Math.random() * 2000); // 1 to 3 seconds wait
            }
        }

    } catch (error) {
        console.error("[CRITICAL] Fallo en la inicialización o ejecución principal:", error);
    } finally {
        if (browser) await browser.close();

        // Export remaining elements 
        console.log("\n[INFO] Scraping finalizado. Exportando datos finales...");
        saveExcel(globalFoundLineas, 0, true);
        console.log(`=== PROCESO TERMINADO. TOTAL ENCONTRADOS: ${globalFoundLineas.length} ===`);
    }
})();
