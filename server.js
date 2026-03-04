const express = require('express');
const cors = require('cors');
const { connect } = require('puppeteer-real-browser');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Document type validation rules
const DOC_RULES = {
  '1': { name: 'DNI', length: 8 },
  '2': { name: 'RUC', length: 11 },
  '3': { name: 'Carné de Extranjería', minLength: 6, maxLength: 12 },
  '4': { name: 'Pasaporte', minLength: 6, maxLength: 12 },
  '5': { name: 'Doc. Legal de Identidad (SNM)', minLength: 6, maxLength: 15 },
};

app.post('/api/consulta', async (req, res) => {
  const { tipoDocumento, numeroDocumento } = req.body;

  // Validate inputs
  if (!tipoDocumento || !numeroDocumento) {
    return res.status(400).json({
      success: false,
      error: 'Tipo de documento y número de documento son requeridos.',
    });
  }

  const rule = DOC_RULES[tipoDocumento];
  if (!rule) {
    return res.status(400).json({
      success: false,
      error: 'Tipo de documento inválido.',
    });
  }

  console.log(`[CONSULTA] Tipo: ${rule.name}, Número: ${numeroDocumento}`);

  let browser;
  try {
    const connection = await connect({
      headless: false, // Core initialization needs false to apply evasions properly
      customConfig: {
        args: ['--headless=new', '--hide-scrollbars', '--mute-audio'] // Force native headless rendering purely in console
      },
      turnstile: true, // Specifically bypasses ReCAPTCHA v3 & Turnstile aggressively
      disableXvfb: true, // Windows compatible
      ignoreAllFlags: false
    });
    browser = connection.browser;
    const page = connection.page;

    // Navigate to OSIPTEL
    console.log('[NAVEGANDO] Accediendo a OSIPTEL...');
    await page.goto('https://checatuslineas.osiptel.gob.pe/', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // Wait for the form to be ready
    await page.waitForSelector('#IdTipoDoc', { timeout: 30000 });
    console.log('[LISTO] Página cargada, formulario encontrado.');

    // Select document type
    await page.select('#IdTipoDoc', tipoDocumento);
    await new Promise((r) => setTimeout(r, 1000));

    // Type document number
    await page.type('#NumeroDocumento', numeroDocumento, { delay: 100 });
    console.log('[DATOS] Documento ingresado.');

    // Wait a moment for reCAPTCHA to be ready
    await new Promise((r) => setTimeout(r, 1000));

    // Intercept network responses to capture the API response
    let apiResponseText = null;
    const responsePromise = new Promise((resolve) => {
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('GetAllCabeceraConsulta') || url.includes('apiConsulta')) {
          try {
            apiResponseText = await response.text();
            resolve(apiResponseText);
          } catch (e) {
          }
        }
      });
    });

    // Click the submit button
    console.log('[CONSULTA] Haciendo click en Consultar...');
    await page.click('#btnBuscar', { delay: 50 });

    // Wait for the API response or timeout
    try {
      await Promise.race([
        responsePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de API')), 10000))
      ]);
    } catch (e) { }

    await new Promise(r => setTimeout(r, 2000));
    console.log('[RESULTADO] Respuesta completada.');

    // Parse the result
    let result = null;
    if (apiResponseText) {
      try {
        result = JSON.parse(apiResponseText);
      } catch (e) { }
    }

    // Also try to get any error messages from the page
    const errorMessage = await page.evaluate(() => {
      const errorEl = document.querySelector('.alert-danger, .text-danger, #mensajeError, .swal2-html-container');
      return errorEl ? errorEl.textContent.trim() : null;
    });

    if (errorMessage && (!result || !result.aaData || result.aaData.length === 0)) {
      return res.json({
        success: false,
        error: errorMessage,
      });
    }

    // Parse the results
    if (result && result.aaData) {
      const lineas = result.aaData.map((row) => ({
        numero: typeof row[0] === 'string' ? row[0].replace(/(<([^>]+)>)/gi, "").trim() : row[0],
        modalidad: typeof row[1] === 'string' ? row[1].replace(/(<([^>]+)>)/gi, "").trim() : row[1],
        telefono: typeof row[2] === 'string' ? row[2].replace(/(<([^>]+)>)/gi, "").trim() : row[2],
        operador: typeof row[3] === 'string' ? row[3].replace(/(<([^>]+)>)/gi, "").trim() : row[3],
      }));

      return res.json({
        success: true,
        totalLineas: result.iTotalRecords || lineas.length,
        lineas,
      });
    } else {
      return res.json({
        success: true,
        totalLineas: 0,
        lineas: [],
        mensaje: 'No se encontraron líneas registradas.',
      });
    }
  } catch (error) {
    console.error('[ERROR]', error.message);
    return res.status(500).json({
      success: false,
      error: `Error al consultar OSIPTEL: ${error.message}`,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║   OSIPTEL Checker Server                     ║`);
  console.log(`║   Servidor corriendo en http://localhost:${PORT} ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});
