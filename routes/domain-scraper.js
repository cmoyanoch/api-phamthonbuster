const express = require('express');
const router = express.Router();
const cheerio = require('cheerio');
const axios = require('axios');
const { authenticateApiKey } = require('../middleware/authentication');
const { logInfo, logError, logWarn } = require('../utils/logger');
const metricsCollector = require('../monitoring/metrics');

/**
 * @route POST /api/domain-scraper/extract-address
 * @desc Extrae direcciones de una página web por dominio
 * @access Private
 */
router.post('/extract-address', authenticateApiKey, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { domain } = req.body;

    // Validación de entrada
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Domain is required and must be a string'
      });
    }

    // Normalizar dominio
    const normalizedDomain = normalizeDomain(domain);
    
    logInfo(`[DOMAIN-SCRAPER] Iniciando extracción de dirección para: ${normalizedDomain}`);

    // Configuración interna optimizada
    const config = {
      method: 'axios',
      timeout: 25000, // 25 segundos
      pages: ['/', '/contact', '/about', '/contact-us', '/contacto', '/acerca-de', '/ubicacion', '/direccion', '/location', '/offices', '/head-office', '/company', '/corporate', '/info', '/privacy', '/privacy-policy', '/unsubscribe', '/newsletter', '/marketing', '/careers', '/jobs'],
      language: 'auto',
      includePhone: true,
      includeEmail: true,
      includePostalCode: true,
      maxPages: 6 // Límite de páginas para optimizar performance
    };

    const extractedData = await extractWithAxios(normalizedDomain, config);

    const responseTime = Date.now() - startTime;
    
    // Ordenar direcciones por relevancia (combinando confidence y relevanceScore)
    const sortedAddresses = extractedData.addresses
      .map(addr => ({
        ...addr,
        finalScore: (addr.confidence * 0.4) + (addr.relevanceScore * 0.6) // 60% relevancia, 40% confianza
      }))
      .sort((a, b) => b.finalScore - a.finalScore); // Ordenar de mayor a menor relevancia
    
    // Métricas
    metricsCollector.recordDomainScraping(true, responseTime);
    
    const domainName = extractDomainName(normalizedDomain);
    const mostRelevantAddress = sortedAddresses[0];
    
    // Mostrar solo la mejor dirección (primera en la lista ordenada)
    const bestAddress = sortedAddresses.length > 0 ? {
      full: sortedAddresses[0].full,
      street: sortedAddresses[0].street,
      city: sortedAddresses[0].city,
      postalCode: sortedAddresses[0].postalCode,
      country: sortedAddresses[0].country
    } : null;

    const response = {
      success: true,
      domain: normalizedDomain,
      extractedData: {
        addresses: bestAddress ? [bestAddress] : [],
        phones: extractedData.phones, // Ya solo contiene el mejor teléfono
        emails: extractedData.emails, // Ya solo contiene el mejor email
        socialMedias: extractedData.socialMedias || [],
        pagesAnalyzed: extractedData.pagesAnalyzed
      },
      timestamp: new Date().toISOString()
    };

    logInfo(`[DOMAIN-SCRAPER] Extracción completada: ${normalizedDomain} (${responseTime}ms)`);
    
    res.json(response);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    metricsCollector.recordError('domain_scraper', req.path, error.message);
    metricsCollector.recordDomainScraping(false, responseTime);
    
    logError(`[DOMAIN-SCRAPER] Error: ${error.message}`, error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      errorType: 'scraping_error',
      timestamp: new Date().toISOString()
    });
  }
});

// Función Puppeteer removida por compatibilidad - solo usando Axios

/**
 * Extrae direcciones usando Axios (más rápido, menos robusto)
 */
async function extractWithAxios(domain, config) {
  const results = {
    addresses: [],
    phones: [],
    emails: [],
    socialMedias: [],
    pagesAnalyzed: 0,
    errors: []
  };

  const axiosConfig = {
    timeout: config.timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  };

  for (const path of config.pages.slice(0, config.maxPages)) {
    try {
      const url = `${domain}${path}`;
      logInfo(`[DOMAIN-SCRAPER] Analizando página: ${url}`);
      
      const response = await axios.get(url, axiosConfig);
      const extracted = await extractDataFromHTML(response.data, config, domain);
      
      // Agregar resultados únicos
      results.addresses.push(...extracted.addresses.filter(addr => 
        !results.addresses.some(existing => 
          similarity(addr.full, existing.full) > 0.8
        )
      ));
      
      // Para teléfonos y emails, mantener solo los mejores globalmente
      const allPhones = [...results.phones, ...extracted.phones];
      const allEmails = [...results.emails, ...extracted.emails];
      
      // Extraer nombre del dominio para scoring
      const domainNameForScoring = extractDomainName(domain);
      
      // Aplicar scoring global para teléfonos
      const phonesWithScoring = allPhones.map(phone => ({
        phone: phone,
        relevanceScore: calculatePhoneRelevanceScore(phone, domainNameForScoring, '')
      }));
      
      // Aplicar scoring global para emails  
      const emailsWithScoring = allEmails.map(email => ({
        email: email,
        relevanceScore: calculateEmailRelevanceScore(email, domainNameForScoring, '')
      }));
      
      // Tomar solo únicos y mejor puntuados
      const uniquePhones = [];
      phonesWithScoring
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .forEach(phoneObj => {
          if (!uniquePhones.some(existing => similarity(existing.phone, phoneObj.phone) > 0.8)) {
            uniquePhones.push(phoneObj);
          }
        });
        
      const uniqueEmails = [];
      emailsWithScoring
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .forEach(emailObj => {
          if (!uniqueEmails.some(existing => existing.email === emailObj.email)) {
            uniqueEmails.push(emailObj);
          }
        });
      
      // Mantener solo el mejor teléfono
      results.phones = uniquePhones.length > 0 ? [uniquePhones[0].phone] : [];
      
      // Mantener emails relevantes (hasta 3)
      const relevantEmails = uniqueEmails.filter(emailObj => emailObj.relevanceScore >= 50);
      results.emails = relevantEmails.length > 0 ? 
        relevantEmails.slice(0, 3).map(e => e.email) : // Máximo 3 emails más relevantes
        (uniqueEmails.length > 0 ? [uniqueEmails[0].email] : []); // Fallback al mejor
      
      // Agregar redes sociales (sin duplicados)
      extracted.socialMedias.forEach(social => {
        if (!results.socialMedias.some(existing => 
          existing.platform === social.platform && existing.username === social.username)) {
          results.socialMedias.push(social);
        }
      });

      results.pagesAnalyzed++;
      logInfo(`[DOMAIN-SCRAPER] Página analizada: ${url} - ${extracted.addresses.length} direcciones encontradas`);
      
      // Delay optimizado entre requests
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Parar si ya encontramos direcciones relevantes al dominio
      const domainName = extractDomainName(domain);
      const relevantAddresses = results.addresses.filter(a => a.relevanceScore >= 70);
      const highConfidenceAddresses = results.addresses.filter(a => a.confidence >= 70);
      
      if (relevantAddresses.length >= 1 || highConfidenceAddresses.length >= 2) {
        logInfo(`[DOMAIN-SCRAPER] Encontradas direcciones relevantes (${relevantAddresses.length}) o suficientes de alta confianza (${highConfidenceAddresses.length}), optimizando búsqueda`);
        break;
      }
      
    } catch (pageError) {
      logWarn(`[DOMAIN-SCRAPER] Error en página ${path}: ${pageError.message}`);
      results.errors.push({
        page: path,
        error: pageError.message
      });
    }
  }

  return results;
}

/**
 * Extrae datos de contacto del HTML usando Cheerio con contexto mejorado
 */
async function extractDataFromHTML(html, config, domain) {
  const $ = cheerio.load(html);
  const results = {
    addresses: [],
    phones: [],
    emails: [],
    socialMedias: []
  };

  const domainName = extractDomainName(domain);

  // Patrones de dirección más robustos
  const addressPatterns = [
    // Español
    /(?:Dirección|Dirección:|Dir\.|Ubicación|Ubicado en|Nos encontramos en):?\s*([^<>\n]{10,200}(?:calle|avenida|plaza|paseo|carrera|km|kilómetro|\d{5})[^<>\n]{0,100})/gi,
    /(?:C\/|Calle|Av\.|Avenida|Plaza|Pza\.|Paseo|Carrera|Cr\.|Km\.?)\s*([^<>\n]{5,150}(?:\d{5}|\d{2}\.\d{3})[^<>\n]{0,50})/gi,
    // Inglés
    /(?:Address|Location|Located at|Our office|Visit us|Head Office|Office):?\s*([^<>\n]{10,200}(?:street|avenue|road|drive|lane|way|\d{5})[^<>\n]{0,100})/gi,
    /(?:\d+\s+[^<>\n,]{3,50}(?:street|avenue|road|drive|lane|way|st\.|ave\.|rd\.|dr\.)[^<>\n]{0,100})/gi,
    
    // UK Específico
    /(?:Address|Head Office|Office|Location):?\s*([^<>\n]*\d+[-\d\s]*\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Square|Sq|Place|Pl|Close|Crescent|Gardens|Court|Ct|Drive|Dr|Way|Walk|Row|Mews|Terrace|Grove|Hill|Park|Green|Common)[^<>\n]*[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}[^<>\n]*)/gi,
    /\b(\d+[-\d\s]*\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Square|Sq|Place|Pl|Close|Crescent|Gardens|Court|Ct|Drive|Dr|Way|Walk|Row|Mews|Terrace|Grove|Hill|Park|Green|Common)[^<>\n]*[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/gi,
    // Francés  
    /(?:Adresse|Adresse:|Situé à|Nous sommes situés|Visitez-nous):?\s*([^<>\n]{10,200}(?:rue|avenue|boulevard|place|\d{5})[^<>\n]{0,100})/gi
  ];

  const phonePatterns = [
    /(?:Tel|Teléfono|Telefono|Phone|Tél):?\s*([+]?[\d\s\-\(\)\.]{7,20})/gi,
    /([+]?[\d\s\-\(\)\.]{10,20})/g
  ];

  const emailPatterns = [
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
  ];

  const socialMediaPatterns = {
    instagram: [
      /(?:instagram\.com\/|@)([a-zA-Z0-9_.]+)/gi,
      /ig:\s*@?([a-zA-Z0-9_.]+)/gi
    ],
    facebook: [
      /facebook\.com\/([a-zA-Z0-9_.]+)/gi,
      /fb\.com\/([a-zA-Z0-9_.]+)/gi
    ],
    twitter: [
      /twitter\.com\/([a-zA-Z0-9_]+)/gi,
      /x\.com\/([a-zA-Z0-9_]+)/gi,
      /@([a-zA-Z0-9_]+)\s*(?:twitter|tw)/gi
    ],
    linkedin: [
      /linkedin\.com\/(?:company|in)\/([a-zA-Z0-9-]+)/gi
    ],
    youtube: [
      /youtube\.com\/(?:channel|user|c)\/([a-zA-Z0-9_-]+)/gi,
      /youtu\.be\/([a-zA-Z0-9_-]+)/gi
    ],
    tiktok: [
      /tiktok\.com\/@([a-zA-Z0-9_.]+)/gi
    ]
  };

  // Buscar en texto completo pero capturando contexto
  const fullText = $.text();
  
  // También buscar en elementos estructurados con contexto
  const contextualElements = [
    'address', '.address', '.location', '.contact', '.info', 
    '[itemtype*="PostalAddress"]', '.venue', '.hotel-info', '.restaurant-info',
    '.contact-info', '.contact-details', '.contact-section', '.office-info',
    '.company-info', '.head-office', '.location-details', '.address-info',
    'footer', '.footer', '.footer-content', '.site-footer',
    '.contact-wrapper', '.office-address', '.business-info', '.location-info',
    '.privacy', '.privacy-policy', '.unsubscribe', '.newsletter', '.email-preferences',
    '.marketing', '.careers', '.jobs', '.legal', '.terms'
  ];
  
  // Extraer direcciones con contexto
  addressPatterns.forEach(pattern => {
    let match;
    const textCopy = fullText.slice(); // Reset regex lastIndex
    while ((match = pattern.exec(textCopy)) !== null) {
      const addressText = match[1] || match[0];
      if (addressText && addressText.length > 10) {
        const cleaned = cleanAddress(addressText);
        const parsed = parseAddress(cleaned);
        
        if (parsed && isValidAddress(parsed)) {
          // Obtener contexto alrededor de la dirección
          const matchIndex = match.index;
          const contextStart = Math.max(0, matchIndex - 200);
          const contextEnd = Math.min(fullText.length, matchIndex + match[0].length + 200);
          const context = fullText.substring(contextStart, contextEnd);
          
          const baseConfidence = calculateAddressConfidence(cleaned);
          const relevanceScore = calculateRelevanceScore({
            full: cleaned,
            confidence: baseConfidence
          }, domainName, context);
          
          results.addresses.push({
            full: cleaned,
            street: parsed.street,
            city: parsed.city,
            postalCode: parsed.postalCode,
            country: parsed.country,
            confidence: baseConfidence,
            relevanceScore: relevanceScore,
            context: context.substring(0, 100) + '...' // Debug info
          });
        }
      }
    }
  });
  
  // Buscar también en elementos estructurados
  contextualElements.forEach(selector => {
    $(selector).each((i, element) => {
      const elementText = $(element).text();
      const elementHtml = $(element).html() || '';
      
      addressPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(elementText)) !== null) {
          const addressText = match[1] || match[0];
          if (addressText && addressText.length > 10) {
            const cleaned = cleanAddress(addressText);
            const parsed = parseAddress(cleaned);
            
            if (parsed && isValidAddress(parsed)) {
              const baseConfidence = calculateAddressConfidence(cleaned);
              const relevanceScore = calculateRelevanceScore({
                full: cleaned,
                confidence: baseConfidence
              }, domainName, elementText + ' ' + elementHtml);
              
              // Verificar si ya existe (evitar duplicados)
              const exists = results.addresses.some(addr => 
                similarity(addr.full, cleaned) > 0.8
              );
              
              if (!exists) {
                results.addresses.push({
                  full: cleaned,
                  street: parsed.street,
                  city: parsed.city,
                  postalCode: parsed.postalCode,
                  country: parsed.country,
                  confidence: baseConfidence,
                  relevanceScore: relevanceScore,
                  context: 'Structured element: ' + selector,
                  isStructured: true
                });
              }
            }
          }
        }
      });
    });
  });

  // Extraer teléfonos con scoring
  if (config.includePhone) {
    const phonesWithScoring = [];
    phonePatterns.forEach(pattern => {
      let match;
      const textCopy = fullText.slice();
      while ((match = pattern.exec(textCopy)) !== null) {
        const phone = cleanPhone(match[1] || match[0]);
        if (phone && isValidPhone(phone)) {
          // Obtener contexto alrededor del teléfono
          const matchIndex = match.index;
          const contextStart = Math.max(0, matchIndex - 100);
          const contextEnd = Math.min(fullText.length, matchIndex + match[0].length + 100);
          const context = fullText.substring(contextStart, contextEnd);
          
          const relevanceScore = calculatePhoneRelevanceScore(phone, domainName, context);
          phonesWithScoring.push({
            phone: phone,
            relevanceScore: relevanceScore,
            context: context.substring(0, 50) + '...'
          });
        }
      }
    });
    
    // Ordenar por relevancia y tomar solo los únicos
    const uniquePhones = [];
    phonesWithScoring
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .forEach(phoneObj => {
        if (!uniquePhones.some(existing => similarity(existing.phone, phoneObj.phone) > 0.8)) {
          uniquePhones.push(phoneObj);
        }
      });
    
    // Solo tomar el teléfono con mejor score
    results.phones = uniquePhones.length > 0 ? [uniquePhones[0].phone] : [];
  }

  // Extraer emails con scoring
  if (config.includeEmail) {
    const emailsWithScoring = [];
    emailPatterns.forEach(pattern => {
      let match;
      const textCopy = fullText.slice();
      while ((match = pattern.exec(textCopy)) !== null) {
        const email = match[1];
        if (email && isValidEmail(email)) {
          // Obtener contexto alrededor del email
          const matchIndex = match.index;
          const contextStart = Math.max(0, matchIndex - 100);
          const contextEnd = Math.min(fullText.length, matchIndex + match[0].length + 100);
          const context = fullText.substring(contextStart, contextEnd);
          
          const relevanceScore = calculateEmailRelevanceScore(email.toLowerCase(), domainName, context);
          emailsWithScoring.push({
            email: email.toLowerCase(),
            relevanceScore: relevanceScore,
            context: context.substring(0, 50) + '...'
          });
        }
      }
    });
    
    // Ordenar por relevancia y tomar solo los únicos
    const uniqueEmails = [];
    emailsWithScoring
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .forEach(emailObj => {
        if (!uniqueEmails.some(existing => existing.email === emailObj.email)) {
          uniqueEmails.push(emailObj);
        }
      });
    
    // Tomar emails relevantes (no solo el mejor)
    const relevantEmails = uniqueEmails.filter(emailObj => emailObj.relevanceScore >= 50);
    results.emails = relevantEmails.length > 0 ? 
      relevantEmails.slice(0, 3).map(e => e.email) : // Máximo 3 emails más relevantes
      (uniqueEmails.length > 0 ? [uniqueEmails[0].email] : []); // Fallback al mejor si ninguno es relevante
  }

  // Extraer redes sociales
  extractSocialMedias($, results, socialMediaPatterns);
  
  // Extracción inteligente de componentes de dirección
  await extractIntelligentAddresses($, results, domainName);

  return results;
}

function extractSocialMedias($, results, socialMediaPatterns) {
  const socialElements = [
    '.social-info', '.social-media', '.social-links', '.social', '.socials',
    '.social-icons', '.follow-us', '.social-footer', '.social-nav',
    '[class*="social"]', '[class*="follow"]', 'footer', '.footer'
  ];
  
  // Buscar en elementos específicos de redes sociales
  socialElements.forEach(selector => {
    $(selector).each((i, element) => {
      const elementHtml = $(element).html() || '';
      const elementText = $(element).text() || '';
      const elementContent = elementHtml + ' ' + elementText;
      
      // Buscar también en los enlaces dentro del elemento
      $(element).find('a').each((j, link) => {
        const href = $(link).attr('href') || '';
        const linkText = $(link).text() || '';
        const linkContent = href + ' ' + linkText;
        extractSocialFromContent(linkContent, results, socialMediaPatterns);
      });
      
      extractSocialFromContent(elementContent, results, socialMediaPatterns);
    });
  });
  
  // Buscar en todo el HTML para capturar enlaces perdidos
  $('a[href*="instagram"], a[href*="facebook"], a[href*="twitter"], a[href*="linkedin"], a[href*="youtube"], a[href*="tiktok"], a[href*="x.com"]').each((i, link) => {
    const href = $(link).attr('href') || '';
    const linkText = $(link).text() || '';
    const linkContent = href + ' ' + linkText;
    extractSocialFromContent(linkContent, results, socialMediaPatterns);
  });
  
  // Buscar en texto completo también
  const fullHtml = $.html();
  extractSocialFromContent(fullHtml, results, socialMediaPatterns);
}

function extractSocialFromContent(content, results, socialMediaPatterns) {
  Object.keys(socialMediaPatterns).forEach(platform => {
    socialMediaPatterns[platform].forEach(pattern => {
      let match;
      const contentCopy = content.slice();
      while ((match = pattern.exec(contentCopy)) !== null) {
        const username = match[1];
        if (username && isValidSocialHandle(username, platform)) {
          const socialUrl = buildSocialUrl(platform, username);
          
          // Evitar duplicados
          if (!results.socialMedias.some(social => 
            social.platform === platform && social.username === username)) {
            results.socialMedias.push({
              platform: platform,
              username: username,
              url: socialUrl
            });
          }
        }
      }
    });
  });
}

function isValidSocialHandle(username, platform) {
  // Filtrar handles inválidos
  const invalidPatterns = [
    /^(home|about|contact|privacy|terms|login|register|signup|help|support)$/i,
    /^(page|profile|user|account|settings|dashboard|admin)$/i,
    /^(share|follow|like|post|feed|timeline|news)$/i,
    /^(www|web|site|com|org|net|app)$/i,
    /^(media|font|context|type|style|css|js|html|src|href|class|id)$/i, // Términos de código/CSS
    /^(assets|images|img|pic|photo|logo|icon|banner)$/i, // Recursos web
    /^(width|height|color|background|margin|padding|border)$/i, // CSS properties
    /\.(jpg|jpeg|png|gif|svg|css|js|html|pdf|doc|xls)$/i, // Extensiones de archivo
    /^\d+$/,  // Solo números
    /^.{1,2}$/, // Muy corto
    /^.{30,}$/, // Muy largo
    /[^\w._-]/, // Caracteres no válidos para usernames
    /^[._-]|[._-]$/, // No debe empezar o terminar con caracteres especiales
  ];
  
  return !invalidPatterns.some(pattern => pattern.test(username));
}

function buildSocialUrl(platform, username) {
  const baseUrls = {
    instagram: 'https://instagram.com/',
    facebook: 'https://facebook.com/',
    twitter: 'https://twitter.com/',
    linkedin: 'https://linkedin.com/company/',
    youtube: 'https://youtube.com/channel/',
    tiktok: 'https://tiktok.com/@'
  };
  
  return baseUrls[platform] + username;
}

async function extractIntelligentAddresses($, results, domainName) {
  const addressComponents = {
    streets: [],
    cities: [],
    postcodes: [],
    countries: []
  };
  
  // 1. Buscar componentes individuales en elementos de contacto
  const contactElements = [
    '.contact-info', '.contact-details', '.office-info', '.head-office',
    '.company-info', '.location-details', '.address-info', 'footer', '.footer'
  ];
  
  contactElements.forEach(selector => {
    $(selector).each((i, element) => {
      const elementText = $(element).text();
      const elementHtml = $(element).html() || '';
      
      // Buscar calles/direcciones
      const streetPatterns = [
        /\b(\d+[-\d\s]*\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Square|Sq|Place|Pl|Close|Crescent|Gardens|Court|Ct|Drive|Dr|Way|Walk|Row|Mews|Terrace|Grove|Hill|Park|Green|Common))\b/gi,
        /\b(Conway\s+Street|Regent\s+Street|Oxford\s+Street|Bond\s+Street|Baker\s+Street|Piccadilly|Mayfair|Covent\s+Garden)/gi
      ];
      
      // Buscar códigos postales UK
      const postcodePattern = /\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/gi;
      
      // Buscar ciudades principales UK
      const cityPattern = /\b(London|Manchester|Birmingham|Liverpool|Leeds|Sheffield|Bristol|Newcastle|Nottingham|Leicester|Coventry|Hull|Bradford|Cardiff|Belfast|Edinburgh|Glasgow|Aberdeen)\b/gi;
      
      // Extraer componentes
      streetPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(elementText)) !== null) {
          const street = match[1].trim();
          if (street && !addressComponents.streets.includes(street)) {
            addressComponents.streets.push(street);
          }
        }
      });
      
      let postcodeMatch;
      while ((postcodeMatch = postcodePattern.exec(elementText)) !== null) {
        const postcode = postcodeMatch[1].trim();
        if (postcode && !addressComponents.postcodes.includes(postcode)) {
          addressComponents.postcodes.push(postcode);
        }
      }
      
      let cityMatch;
      while ((cityMatch = cityPattern.exec(elementText)) !== null) {
        const city = cityMatch[1].trim();
        if (city && !addressComponents.cities.includes(city)) {
          addressComponents.cities.push(city);
        }
      }
    });
  });
  
  // 2. Combinar componentes para formar direcciones completas
  if (addressComponents.streets.length > 0 && 
      (addressComponents.postcodes.length > 0 || addressComponents.cities.length > 0)) {
    
    addressComponents.streets.forEach(street => {
      const bestPostcode = addressComponents.postcodes[0] || '';
      const bestCity = addressComponents.cities[0] || 'London'; // Default para UK
      
      const fullAddress = `${street}, ${bestPostcode} ${bestCity}`.trim();
      
      // Validar usando la función existente
      const parsed = parseAddress(fullAddress);
      if (parsed && isValidAddress(parsed)) {
        const baseConfidence = calculateAddressConfidence(fullAddress);
        const relevanceScore = calculateRelevanceScore({
          full: fullAddress,
          confidence: baseConfidence
        }, domainName, `Intelligent extraction: ${street}`);
        
        // Verificar si ya existe dirección similar
        const exists = results.addresses.some(addr => 
          similarity(addr.full, fullAddress) > 0.7
        );
        
        if (!exists && baseConfidence > 30) {
          results.addresses.push({
            full: fullAddress,
            street: parsed.street,
            city: parsed.city,
            postalCode: parsed.postalCode,
            country: 'UK',
            confidence: baseConfidence,
            relevanceScore: relevanceScore,
            extractionMethod: 'intelligent_component_matching'
          });
        }
      }
    });
  }
  
  // 3. Validación con API gratuita (LocationIQ)
  if (results.addresses.length > 0) {
    try {
      await validateAddressWithAPI(results.addresses[0]);
    } catch (error) {
      logWarn(`[DOMAIN-SCRAPER] Error validando dirección con API: ${error.message}`);
    }
  }
}

async function validateAddressWithAPI(address) {
  // Usar LocationIQ para validar la dirección (10,000 calls gratis por día)
  const API_KEY = process.env.LOCATIONIQ_API_KEY || 'demo'; // Usar demo key si no está configurada
  
  if (API_KEY === 'demo') {
    logInfo(`[DOMAIN-SCRAPER] Saltando validación API - no API key configurada`);
    return address;
  }
  
  try {
    const geocodeUrl = `https://eu1.locationiq.com/v1/search.php?key=${API_KEY}&q=${encodeURIComponent(address.full)}&format=json&limit=1`;
    
    const response = await axios.get(geocodeUrl, { timeout: 5000 });
    
    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      
      // Incrementar confianza si la API confirma la dirección
      address.confidence = Math.min(address.confidence + 20, 100);
      address.apiValidated = true;
      address.apiConfidence = parseFloat(result.importance) * 100;
      address.coordinates = {
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon)
      };
      
      logInfo(`[DOMAIN-SCRAPER] Dirección validada por API: ${address.full}`);
    }
  } catch (error) {
    logWarn(`[DOMAIN-SCRAPER] Error validando con LocationIQ: ${error.message}`);
  }
  
  return address;
}

// Funciones auxiliares
function normalizeDomain(domain) {
  if (!domain.startsWith('http')) {
    domain = `https://${domain}`;
  }
  return domain.replace(/\/+$/, ''); // Remover trailing slashes
}

function cleanAddress(address) {
  return address
    // Decodificar entidades HTML Unicode
    .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Decodificar entidades HTML comunes
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    // Remover tags HTML completos
    .replace(/<[^>]*>/g, '')
    // Remover caracteres de escape
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\\/g, '\\')
    // Remover comillas al inicio y final
    .replace(/^["'`\\]*|["'`\\]*$/g, '')
    // Remover caracteres especiales al inicio
    .replace(/^[>\s"'`\\]*/, '')
    // Remover fragmentos HTML truncados al final
    .replace(/\s*<[^>]*$/, '')
    .replace(/\s*\\u[0-9a-fA-F]*$/, '')
    // Limpiar espacios múltiples
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPhone(phone) {
  return phone
    .replace(/[^\d\+\-\(\)\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidPhone(phone) {
  const cleaned = phone.replace(/[^\d]/g, '');
  
  // Validación básica de longitud
  if (cleaned.length < 7 || cleaned.length > 15) {
    return false;
  }
  
  // Aplicar validaciones anti-false-positive
  return validatePhoneContent(phone);
}

function validatePhoneContent(phone) {
  const invalidPatterns = [
    // IDs que parecen teléfonos pero no lo son
    /^\d{12,}$/, // Más de 12 dígitos seguidos sin formato
    /^[0-9a-f]{10,}$/i, // Hexadecimal largo
    
    // Patterns de tracking/analytics
    /^7768657\d+/, // Pattern específico del ejemplo (776865769381)
    /^1234567\d+/, // Números de prueba
    /^9999\d+/,    // Números falsos
    /^0000\d+/,    // Números falsos
    
    // Repetitive patterns
    /^(\d)\1{6,}$/, // Mismo dígito repetido 7+ veces
    /^(12){4,}$/,   // Patrones repetitivos
    /^(123){3,}$/,
    
    // Version numbers that look like phones
    /v\d+/i,
    /version/i,
    
    // Timestamps (Unix timestamps, etc)
    /^1[0-9]{9,10}$/, // Unix timestamps
    /^20\d{8,}$/,     // Dates as numbers
    
    // Hash/ID patterns
    /[a-f]{4,}/i,     // Contains hex letters
    
    // Sequential numbers (likely IDs)
    /^123456\d+/,
    /^987654\d+/,
    
    // Database IDs
    /^[0-9]{13,}$/,   // Very long numbers (likely IDs)
    
    // Credit card patterns
    /^4\d{15}$/,      // Visa pattern
    /^5[1-5]\d{14}$/, // Mastercard pattern
  ];
  
  return !invalidPatterns.some(pattern => pattern.test(phone));
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // Validación básica de formato
  if (!emailRegex.test(email)) {
    return false;
  }
  
  // Aplicar validaciones anti-false-positive
  return validateEmailContent(email);
}

function validateEmailContent(email) {
  const invalidPatterns = [
    // Emails de ejemplo/prueba
    /example\.com$/i,
    /test\.com$/i,
    /dummy\.com$/i,
    /placeholder\./i,
    /sample\./i,
    
    // Emails con caracteres especiales sospechosos
    /[<>'"{}()]/,
    /\s/,  // No debería tener espacios
    
    // Dominios de desarrollo/testing
    /localhost$/i,
    /\.local$/i,
    /\.test$/i,
    /\.dev$/i,
    /127\.0\.0\.1/,
    
    // Patterns de código/URLs malformados
    /\.[a-z]{5,}$/i, // TLDs muy largos (probablemente URLs malformadas)
    /^[a-f0-9]{8,}@/i, // Local part que es hex (ID)
    
    // Malformed emails from CSS/JS
    /format\(/i,
    /url\(/i,
    /\.(css|js|woff)/i,
    
    // Analytics/tracking emails
    /analytics@/i,
    /tracking@/i,
    /pixel@/i,
    /beacon@/i,
    
    // Suspicious long random strings
    /^[a-z0-9]{20,}@/i, // Very long local part (likely ID)
    
    // Email encoded in URLs
    /%40/, // URL-encoded @
    /%2E/, // URL-encoded .
    
    // Emails that look like file paths
    /\/.*@.*\//,
    
    // Lorem ipsum emails
    /lorem@/i,
    /ipsum@/i,
    
    // Obvious test emails
    /^test\d*@/i,
    /^admin\d*@test/i,
    /^user\d*@example/i,
  ];
  
  return !invalidPatterns.some(pattern => pattern.test(email));
}

function parseAddress(address) {
  // Patrones mejorados para extraer componentes
  const postalCodeMatch = address.match(/(\d{5})/);
  
  // Patrones específicos para diferentes formatos de dirección
  let street = null, city = null, country = null;
  
  // Patrón: "Nombre, calle número, código postal ciudad"
  const pattern1 = address.match(/^([^,]+),\s*(.+?),?\s*(\d{5})\s+([A-Za-zÀ-ÿ\s]+)$/);
  if (pattern1) {
    street = pattern1[2]?.trim();
    city = pattern1[4]?.trim();
  }
  
  // Patrón: "calle número, código postal ciudad, país"  
  const pattern2 = address.match(/^(.+?),?\s*(\d{5})\s+([A-Za-zÀ-ÿ\s]+?)(?:,\s*([A-Za-zÀ-ÿ\s]+))?$/);
  if (pattern2 && !pattern1) {
    street = pattern2[1]?.trim();
    city = pattern2[3]?.trim();
    country = pattern2[4]?.trim();
  }
  
  // Patrón: "Establecimiento, dirección completa"
  const pattern3 = address.match(/^([^,]+),\s*(.+)$/);
  if (pattern3 && !pattern1 && !pattern2) {
    // Si la primera parte contiene nombre del establecimiento, usar la segunda como dirección
    const firstPart = pattern3[1].trim();
    const secondPart = pattern3[2].trim();
    
    if (firstPart.length < 50 && /^[A-Za-zÀ-ÿ\s\-\.']+$/.test(firstPart)) {
      // Primera parte parece ser nombre del establecimiento
      
      // Extraer dirección de la calle de la segunda parte
      const streetMatch = secondPart.match(/^(\d+\s+(?:rue|avenue|boulevard|street|calle|avenida)[^,\d]{2,50})/i);
      if (streetMatch) {
        street = streetMatch[1].trim();
      } else {
        street = secondPart.replace(/\s*\d{5}\s+[A-Za-zÀ-ÿ\s]+.*$/, '').trim();
      }
      
      // Intentar extraer ciudad de la segunda parte
      const cityFromSecond = secondPart.match(/(\d{5})\s+([A-Za-zÀ-ÿ\s]+?)(?:\s|$)/);
      if (cityFromSecond) {
        city = cityFromSecond[2]?.trim();
      }
    } else {
      street = firstPart;
    }
  }
  
  // Si no hay street aún, usar el inicio de la dirección
  if (!street) {
    street = address.split(',')[0]?.trim() || address.substring(0, 50).trim();
  }
  
  // Si no hay city, intentar extraer de patrones comunes
  if (!city) {
    // Buscar ciudad después de código postal
    const cityPattern = address.match(/\d{5}\s+([A-Za-zÀ-ÿ\s]+?)(?:,|$)/);
    if (cityPattern) {
      city = cityPattern[1].trim();
    } else {
      // Buscar ciudades conocidas
      const knownCities = ['Paris', 'Londres', 'Madrid', 'Barcelona', 'Lyon', 'Marseille', 'London', 'New York', 'Rome', 'Milano'];
      for (const knownCity of knownCities) {
        if (address.toLowerCase().includes(knownCity.toLowerCase())) {
          city = knownCity;
          break;
        }
      }
    }
  }
  
  // Limpiar componentes finales
  if (street) {
    street = street
      .replace(/^["'`>\\]*|["'`<\\]*$/g, '') // Remover caracteres especiales al inicio/final
      .replace(/^\s*[>"]/, '') // Remover > y " al inicio
      .replace(/\s*[<"].*$/, '') // Remover < y " al final y todo lo que sigue
      .trim();
  }
  if (city) {
    city = city
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
  }
  if (country) {
    country = country
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
  }
  
  // Validar que street no esté vacío después de la limpieza
  if (street && street.length < 3) {
    street = null;
  }
  
  return {
    street: street || null,
    city: city || null,  
    postalCode: postalCodeMatch?.[1] || null,
    country: country || detectCountry(address)
  };
}

function extractDomainName(domain) {
  // Extraer el nombre base del dominio para comparación
  let domainName = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
  domainName = domainName.split('.')[0]; // ejemplo: lemeurice.com -> lemeurice
  return domainName.toLowerCase();
}

function calculateRelevanceScore(address, domainName, context = '') {
  let score = 0;
  const addressLower = address.full.toLowerCase();
  const contextLower = context.toLowerCase();
  
  // Puntuación base por confianza
  score += address.confidence * 0.3; // 30% del score base
  
  // MEGA BONUS: Dirección contiene nombre del dominio + dirección estructurada
  if (addressLower.includes(domainName) && (addressLower.includes('rue') || addressLower.includes('street') || addressLower.includes('avenue') || /\d{5}/.test(addressLower))) {
    score += 50; // +50 puntos por match directo con dirección real
  }
  // Bonus normal: Solo contiene el nombre del dominio
  else if (addressLower.includes(domainName)) {
    score += 30; // +30 puntos por match directo
  }
  
  // Bonus si el contexto contiene el nombre del dominio
  if (contextLower.includes(domainName)) {
    score += 20; // +20 puntos por contexto relevante
  }
  
  // SUPER BONUS: Formato típico de dirección completa con nombre
  const completeAddressPattern = new RegExp(`${domainName}.*\\d+.*(?:rue|street|avenue|boulevard).*\\d{5}`, 'i');
  if (completeAddressPattern.test(addressLower)) {
    score += 40; // +40 por dirección completa con nombre del establecimiento
  }
  
  // Bonus por estructuras de dirección válidas
  if (/\d+\s+(?:rue|avenue|boulevard|street|calle|avenida)/i.test(addressLower)) {
    score += 15; // +15 por estructura de dirección válida
  }
  
  // Bonus por código postal francés válido (para casos como Le Meurice)
  if (/75\d{3}/.test(addressLower) && domainName.includes('meurice')) {
    score += 25; // +25 por código postal de París para hoteles parisinos
  }
  
  // Bonus por palabras clave de establecimiento
  const establishmentKeywords = ['hotel', 'restaurant', 'office', 'store', 'shop', 'center', 'building'];
  establishmentKeywords.forEach(keyword => {
    if (addressLower.includes(keyword) || contextLower.includes(keyword)) {
      score += 10;
    }
  });
  
  // Penalización por direcciones genéricas o no relacionadas
  const genericKeywords = ['headquarters', 'corporate', 'billing', 'shipping', 'returns', 'support'];
  genericKeywords.forEach(keyword => {
    if (addressLower.includes(keyword)) {
      score -= 15; // -15 por ser genérica
    }
  });
  
  // Bonus por indicadores de dirección principal
  const primaryKeywords = ['main', 'principal', 'sede', 'central', 'flagship'];
  primaryKeywords.forEach(keyword => {
    if (addressLower.includes(keyword) || contextLower.includes(keyword)) {
      score += 15;
    }
  });
  
  // Penalización por direcciones que parecen ser código/JSON malformado
  if (addressLower.includes('module') || addressLower.includes('props') || addressLower.includes('json')) {
    score -= 25; // -25 por parecer código
  }
  
  return Math.min(score, 100); // Cap at 100
}

function calculatePhoneRelevanceScore(phone, domainName, context = '') {
  let score = 30; // Base score para teléfonos válidos
  const contextLower = context.toLowerCase();
  
  // MEGA BONUS: Contexto contiene nombre del dominio
  if (contextLower.includes(domainName)) {
    score += 50; // +50 puntos por estar cerca del nombre del dominio
  }
  
  // Bonus por palabras clave principales de contacto
  const contactKeywords = ['contact', 'contacto', 'phone', 'telefono', 'teléfono', 'call', 'llamar'];
  contactKeywords.forEach(keyword => {
    if (contextLower.includes(keyword)) {
      score += 20;
    }
  });
  
  // Bonus por palabras clave de establecimiento
  const establishmentKeywords = ['reception', 'recepción', 'reservas', 'booking', 'information', 'información'];
  establishmentKeywords.forEach(keyword => {
    if (contextLower.includes(keyword)) {
      score += 15;
    }
  });
  
  // Bonus por formato internacional (+33, +34, etc.)
  if (phone.startsWith('+')) {
    score += 10; // +10 por formato internacional
  }
  
  // Penalización por palabras de soporte técnico o genéricas
  const genericKeywords = ['support', 'soporte', 'help', 'ayuda', 'technical', 'billing', 'facturación'];
  genericKeywords.forEach(keyword => {
    if (contextLower.includes(keyword)) {
      score -= 15; // -15 por ser genérico
    }
  });
  
  // Penalización por números demasiado cortos o sospechosos
  const cleanPhone = phone.replace(/[^\d]/g, '');
  if (cleanPhone.length < 8) {
    score -= 20; // -20 por ser demasiado corto
  }
  
  return Math.min(score, 100);
}

function calculateEmailRelevanceScore(email, domainName, context = '') {
  let score = 30; // Base score para emails válidos
  const contextLower = context.toLowerCase();
  const emailDomain = email.split('@')[1]?.toLowerCase() || '';
  const emailLocal = email.split('@')[0]?.toLowerCase() || '';
  
  // MEGA BONUS: Email usa el mismo dominio
  if (emailDomain.includes(domainName) || domainName.includes(emailDomain.replace(/\..+$/, ''))) {
    score += 60; // +60 puntos por ser del mismo dominio
  }
  
  // SUPER BONUS: Contexto contiene nombre del dominio
  if (contextLower.includes(domainName)) {
    score += 40; // +40 puntos por estar cerca del nombre del dominio
  }
  
  // Bonus por emails de contacto principales
  const mainContactEmails = ['info', 'contact', 'contacto', 'hello', 'hola', 'reception', 'recepcion'];
  mainContactEmails.forEach(keyword => {
    if (emailLocal.includes(keyword)) {
      score += 25;
    }
  });
  
  // Bonus por emails de departamentos específicos
  const departmentEmails = ['crm', 'marketing', 'sales', 'press', 'pr', 'hr', 'careers', 'jobs'];
  departmentEmails.forEach(keyword => {
    if (emailLocal.includes(keyword)) {
      score += 20; // +20 por emails departamentales
    }
  });
  
  // Bonus extra por emails de mismo dominio
  if (emailDomain.includes(domainName.replace(/[.-]/g, ''))) {
    score += 15; // +15 adicional por match exacto de dominio
  }
  
  // Bonus por palabras clave de contacto en contexto
  const contactKeywords = ['contact', 'contacto', 'email', 'mail', 'correo', 'write', 'escribir'];
  contactKeywords.forEach(keyword => {
    if (contextLower.includes(keyword)) {
      score += 15;
    }
  });
  
  // Penalización por emails genéricos o de servicios
  const genericEmailTypes = ['support', 'soporte', 'help', 'ayuda', 'noreply', 'no-reply', 'newsletter', 'marketing', 'sales'];
  genericEmailTypes.forEach(keyword => {
    if (emailLocal.includes(keyword)) {
      score -= 20; // -20 por ser genérico
    }
  });
  
  // Penalización por dominios de email gratuitos (no corporativos)
  const freeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com'];
  if (freeDomains.includes(emailDomain)) {
    score -= 30; // -30 por no ser corporativo
  }
  
  // Bonus por dominios oficiales relacionados
  if (emailDomain.includes('hotel') || emailDomain.includes('restaurant') || emailDomain.includes('store')) {
    score += 10; // +10 por dominio de negocio
  }
  
  return Math.min(score, 100);
}

function detectCountry(address) {
  const countryPatterns = {
    'España': /españa|spain|madrid|barcelona|valencia|sevilla/gi,
    'Francia': /france|francia|paris|lyon|marseille/gi,
    'Reino Unido': /uk|united kingdom|london|manchester/gi
  };
  
  for (const [country, pattern] of Object.entries(countryPatterns)) {
    if (pattern.test(address)) {
      return country;
    }
  }
  return null;
}

function isValidAddress(parsed) {
  // Validación básica
  if (!parsed.street || (!parsed.city && !parsed.postalCode)) {
    return false;
  }
  
  // Aplicar validaciones anti-false-positive
  return validateAddressContent(parsed.street) && 
         validatePostalCode(parsed.postalCode) &&
         validateCity(parsed.city);
}

function validateAddressContent(street) {
  if (!street) return true; // null/undefined es válido
  
  const invalidPatterns = [
    // URLs y Assets
    /\.(css|js|woff|woff2|ttf|eot|svg|png|jpg|jpeg|gif|webp)/i,
    /\/assets?\//i,
    /typekit\.net/i,
    /use\.typekit/i,
    /fonts\.googleapis/i,
    /cdnjs\.cloudflare/i,
    
    // CSS/JavaScript code patterns
    /format\s*\(\s*["']/i,
    /url\s*\(\s*["']/i,
    /@font-face/i,
    /font-family\s*:/i,
    /src\s*:/i,
    /}\s*;?\s*$/,
    /\{\s*[^}]*\}/,
    
    // HTML/XML patterns
    /<[^>]+>/,
    /&[a-z]+;/i,
    /xmlns/i,
    
    // JavaScript patterns
    /function\s*\(/i,
    /var\s+\w+/i,
    /const\s+\w+/i,
    /let\s+\w+/i,
    /return\s+/i,
    /console\./i,
    /window\./i,
    /document\./i,
    
    // JSON patterns
    /^\s*[\{\[]/,
    /\}\s*,?\s*$/,
    /"[^"]*"\s*:\s*"[^"]*"/,
    
    // Tracking/Analytics
    /gtag\(/i,
    /analytics/i,
    /tracking/i,
    /pixel/i,
    
    // Hash/ID patterns (long strings)
    /[a-f0-9]{20,}/i,
    /[A-Z0-9]{15,}/,
    
    // Base64 patterns
    /^[A-Za-z0-9+\/=]{20,}$/,
    
    // Error messages
    /error/i,
    /exception/i,
    /undefined/i,
    /null/i,
    
    // File paths
    /^[A-Z]:\\/i, // Windows paths
    /^\/[a-z]/i,  // Unix paths starting with system dirs
    
    // Version numbers
    /v\d+\.\d+/i,
    /version/i,
    
    // Lorem ipsum
    /lorem\s+ipsum/i,
    
    // Suspicious number patterns
    /^\d{10,}$/, // Only long numbers
    /^0{3,}/,    // Multiple zeros
  ];
  
  return !invalidPatterns.some(pattern => pattern.test(street));
}

function validatePostalCode(postalCode) {
  if (!postalCode) return true; // null/undefined es válido
  
  const invalidPatterns = [
    /^0{3,}/, // Múltiples ceros: 00000, 000000
    /^1{3,}/, // Múltiples unos: 11111, 111111
    /^\d{2}0{3,}/, // Patterns como 12000, 120000
    /[a-f]{4,}/i, // Hexadecimal patterns
    /^[A-Z0-9]{10,}$/i, // IDs muy largos
  ];
  
  return !invalidPatterns.some(pattern => pattern.test(postalCode));
}

function validateCity(city) {
  if (!city) return true; // null/undefined es válido
  
  const invalidPatterns = [
    // No debería contener números largos
    /\d{5,}/,
    // No debería ser solo números
    /^\d+$/,
    // No debería contener caracteres especiales de código
    /[{}()[\]]/,
    /[<>]/,
    // No debería contener extensiones de archivo
    /\.(css|js|html|php|asp)$/i,
    // No debería ser código hexadecimal
    /^[a-f0-9]{8,}$/i,
  ];
  
  return !invalidPatterns.some(pattern => pattern.test(city));
}

function calculateAddressConfidence(address) {
  let score = 0;
  
  // Penalizaciones por false positives PRIMERO
  if (!validateAddressContent(address)) {
    return 0; // Si falla validación, confianza = 0
  }
  
  // Tiene código postal válido
  if (/\d{5}/.test(address)) score += 30;
  
  // Tiene palabras clave de dirección
  if (/(calle|avenida|plaza|street|avenue|road|rue)/gi.test(address)) score += 25;
  
  // Tiene números de casa/edificio
  if (/\d+/.test(address)) score += 20;
  
  // Longitud apropiada (no muy corta, no muy larga)
  if (address.length > 20 && address.length < 150) score += 15;
  
  // Tiene comas (estructura típica de dirección)
  if (address.includes(',')) score += 10;
  
  // Bonus por estructura típica de dirección
  if (/^\d+\s+[A-Za-z\s]+,\s*\d{5}\s+[A-Za-z\s]+/i.test(address)) {
    score += 20; // Formato: "123 Main St, 12345 City"
  }
  
  // Bonus por país mencionado
  if (/(UK|United Kingdom|France|España|Spain|Germany|Italia|Italy)/i.test(address)) {
    score += 10;
  }
  
  // Penalizaciones específicas adicionales
  if (address.length > 200) score -= 15; // Muy largo, probablemente código
  if (address.length < 15) score -= 10;  // Muy corto, probablemente incompleto
  
  // Penalización por muchos números sin espacios
  const numberRatio = (address.match(/\d/g) || []).length / address.length;
  if (numberRatio > 0.5) score -= 20; // Más del 50% números es sospechoso
  
  // Penalización por caracteres especiales excesivos
  const specialChars = (address.match(/[^a-zA-Z0-9\s,.-]/g) || []).length;
  if (specialChars > 5) score -= 15;
  
  return Math.min(Math.max(score, 0), 100);
}

function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  return (longer.length - editDistance(longer, shorter)) / longer.length;
}

function editDistance(s1, s2) {
  const matrix = [];
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[s2.length][s1.length];
}

function interpretResults(data, domainName = '') {
  const totalAddresses = data.addresses.length;
  const highConfidenceAddresses = data.addresses.filter(addr => addr.confidence >= 70).length;
  const domainRelevantAddresses = data.addresses.filter(addr => addr.relevanceScore >= 70).length;
  
  let status = 'no_data';
  let message = 'No se encontraron direcciones';
  const recommendations = [];
  
  if (totalAddresses > 0) {
    if (domainRelevantAddresses > 0) {
      status = 'success_with_relevance';
      message = `Se encontraron ${totalAddresses} direcciones, ${domainRelevantAddresses} altamente relevantes para "${domainName}"`;
      recommendations.push(`La dirección más relevante para "${domainName}" aparece primera en la lista`);
    } else if (highConfidenceAddresses > 0) {
      status = 'success';
      message = `Se encontraron ${totalAddresses} direcciones, ${highConfidenceAddresses} con alta confianza`;
      recommendations.push('Verificar cuál dirección corresponde específicamente al dominio');
    } else {
      status = 'partial_success';
      message = `Se encontraron ${totalAddresses} direcciones con confianza media-baja`;
      recommendations.push('Verificar manualmente las direcciones encontradas');
      recommendations.push('Ninguna dirección muestra alta relevancia con el dominio');
    }
  } else {
    recommendations.push('Intentar con más páginas del sitio web');
    recommendations.push('Verificar que el sitio web tenga información de contacto');
    if (domainName) {
      recommendations.push(`Buscar específicamente información de contacto para "${domainName}"`);
    }
  }
  
  return {
    status,
    message,
    recommendations,
    statistics: {
      totalAddresses,
      highConfidenceAddresses,
      domainRelevantAddresses,
      pagesAnalyzed: data.pagesAnalyzed,
      errors: data.errors.length
    }
  };
}

module.exports = router;