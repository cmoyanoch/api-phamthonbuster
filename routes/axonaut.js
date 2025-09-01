const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../middleware/authentication');
const { logInfo, logError } = require('../utils/logger');
const metricsCollector = require('../monitoring/metrics');
const axios = require('axios');

// Configuración de Axonaut
const AXONAUT_API_KEY = process.env.AXONAUT_API_KEY || 'a4d43e886dd21377765b30e649c368e8';
const AXONAUT_BASE_URL = 'https://axonaut.com/api/v2';

/**
 * Función helper para hacer requests a Axonaut
 */
async function makeAxonautRequest(endpoint, method = 'GET', data = null, contentType = 'application/json') {
  try {
    const url = `${AXONAUT_BASE_URL}${endpoint}`;
    const headers = {
      'userApiKey': AXONAUT_API_KEY,
      'Accept': 'application/json'
    };

    if (contentType !== 'multipart/form-data') {
      headers['Content-Type'] = contentType;
    }

    const config = {
      method,
      url,
      headers,
      timeout: 30000
    };

    if (data && method !== 'GET' && method !== 'DELETE') {
      if (contentType === 'multipart/form-data') {
        const formData = new FormData();
        Object.entries(data).forEach(([key, value]) => {
          formData.append(key, value);
        });
        config.data = formData;
      } else {
        config.data = data;
      }
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    logError('Error en request a Axonaut', {
      endpoint,
      method,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

/**
 * POST /api/axonaut/companies
 * Crear empresa en Axonaut
 */
router.post('/companies', authenticateApiKey, async (req, res) => {
  try {
    const {
      name,
      address_street,
      address_zip_code,
      address_city,
      address_country,
      address_region,
      industry,
      linkedin_url,
      headcount,
      headline
    } = req.body;

    // Validar campos requeridos
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'El nombre de la empresa es requerido',
        error: 'MISSING_REQUIRED_FIELD'
      });
    }

    // Preparar datos para Axonaut con valores por defecto
    const axonautData = {
      name,
      address_street: address_street || '',
      address_zip_code: address_zip_code || '',
      address_city: address_city || '',
      address_country: address_country || '',
      address_region: address_region || '',
      is_prospect: true,
      is_customer: false,
      isB2C: false,
      currency: "EUR",
      language: "fr",
      comments: "Lead importado desde LinkedIn",
      categories: industry ? [industry] : [],
      custom_fields: {
        source_du_contact: "n8n automation",
        statut: headline || '',
        headcount: headcount || '0',
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 23) + '000',
        profile_url: linkedin_url || ''
      }
    };

    const result = await makeAxonautRequest('/companies', 'POST', axonautData);

    // Registrar métrica
    metricsCollector.recordApiCall('axonaut', 'create_company', 'success');

    logInfo('Empresa creada en Axonaut', {
      companyId: result.id,
      companyName: name
    });

    res.json({
      success: true,
      message: 'Empresa creada exitosamente en Axonaut',
      data: {
        id: result.id,
        name: result.name || name,
        industry,
        address: {
          street: address_street,
          postalCode: address_zip_code,
          city: address_city,
          country: address_country,
          region: address_region
        },
        customFields: axonautData.custom_fields
      }
    });

  } catch (error) {
    metricsCollector.recordApiCall('axonaut', 'create_company', 'error');

    logError('Error creando empresa en Axonaut', {
      error: error.message,
      data: req.body
    });

    res.status(500).json({
      success: false,
      message: 'Error creando empresa en Axonaut',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/axonaut/employees
 * Crear empleado en Axonaut
 */
router.post('/employees', authenticateApiKey, async (req, res) => {
  try {
    const {
      company_id,
      firstname,
      lastname,
      email,
      phone_number,
      job,
      linkedin_url
    } = req.body;

    // Validar campos requeridos
    if (!company_id || !firstname || !lastname) {
      return res.status(400).json({
        success: false,
        message: 'company_id, firstname y lastname son requeridos',
        error: 'MISSING_REQUIRED_FIELDS'
      });
    }

    // Preparar datos para Axonaut con valores por defecto
    const employeeData = {
      company_id: company_id.toString(),
      firstname,
      lastname,
      email: email || ' ',
      phone_number: phone_number || ' ',
      job: job || '',
      is_billing_contact: 'true',
      cellphone_number: phone_number || ' ',
      'custom_fields[linkedin_profile]': linkedin_url ? `${linkedin_url}/` : ''
    };

    const result = await makeAxonautRequest('/employees', 'POST', employeeData, 'multipart/form-data');

    // Registrar métrica
    metricsCollector.recordApiCall('axonaut', 'create_employee', 'success');

    logInfo('Empleado creado en Axonaut', {
      employeeId: result.id,
      employeeName: `${firstname} ${lastname}`,
      companyId: company_id
    });

    res.json({
      success: true,
      message: 'Empleado creado exitosamente en Axonaut',
      data: {
        id: result.id,
        firstname: result.firstname || firstname,
        lastname: result.lastname || lastname,
        email: result.email || email,
        phone: result.phone_number || phone_number,
        job: result.job || job,
        company_id: result.company_id || company_id,
        linkedin_url
      }
    });

  } catch (error) {
    metricsCollector.recordApiCall('axonaut', 'create_employee', 'error');

    logError('Error creando empleado en Axonaut', {
      error: error.message,
      data: req.body
    });

    res.status(500).json({
      success: false,
      message: 'Error creando empleado en Axonaut',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/axonaut/opportunities
 * Crear oportunidad en Axonaut
 */
router.post('/opportunities', authenticateApiKey, async (req, res) => {
  try {
    const {
      company_id,
      full_name,
      company,
      job_title,
      industry,
      profile_url,
      lead_id,
      campaigns,
      first_name,
      last_name,
      email,
      phone,
      pipe_step_name = 'LinkedIn Profile Visitor'
    } = req.body;

    // Validar campos requeridos
    if (!company_id || !full_name || !company) {
      return res.status(400).json({
        success: false,
        message: 'company_id, full_name y company son requeridos',
        error: 'MISSING_REQUIRED_FIELDS'
      });
    }

    // Determinar probabilidad basada en el paso del pipeline
    let probability = 5; // Default
    if (pipe_step_name === 'LinkedIn Autoconnect') {
      probability = 30;
    } else if (pipe_step_name === 'LinkedIn Message Sender') {
      probability = 40;
    }

    // Preparar datos para Axonaut con valores por defecto
    const opportunityData = {
      company_id: parseInt(company_id),
      amount: 0,
      probability,
      name: `${full_name}-${company}`,
      comments: `Lead détecté via l'automatisation PhantomBuster. Target: ${job_title} dans ${industry || ''}`,
      pipe_name: "Prospection",
      pipe_step_name,
      business_manager_email: "julien.degorgue@europbots.com",
      employees: [
        {
          employee_firstname: first_name || full_name.split(' ')[0],
          employee_lastname: last_name || full_name.split(' ').slice(1).join(' '),
          employee_email: email || '',
          employee_phone: phone || '',
          employee_cellphone: phone || ''
        }
      ],
      custom_fields: {
        source: "phantombuster",
        profile_url: profile_url || '',
        lead_id: lead_id || '',
        campaign: campaigns || ''
      }
    };

    const result = await makeAxonautRequest('/opportunities', 'POST', opportunityData);

    // Registrar métrica
    metricsCollector.recordApiCall('axonaut', 'create_opportunity', 'success');

    logInfo('Oportunidad creada en Axonaut', {
      opportunityId: result.id,
      opportunityName: opportunityData.name,
      companyId: company_id,
      probability
    });

    res.json({
      success: true,
      message: 'Oportunidad creada exitosamente en Axonaut',
      data: {
        id: result.id,
        name: result.name || opportunityData.name,
        company_id: result.company_id || company_id,
        probability: result.probability || probability,
        pipe_step_name: result.pipe_step_name || pipe_step_name,
        custom_fields: result.custom_fields || opportunityData.custom_fields
      }
    });

  } catch (error) {
    metricsCollector.recordApiCall('axonaut', 'create_opportunity', 'error');

    logError('Error creando oportunidad en Axonaut', {
      error: error.message,
      data: req.body
    });

    res.status(500).json({
      success: false,
      message: 'Error creando oportunidad en Axonaut',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * PATCH /api/axonaut/opportunities/:id
 * Actualizar oportunidad en Axonaut
 */
router.patch('/opportunities/:id', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      pipe_step_name,
      probability,
      status,
      last_action = 'autoconnect_completed'
    } = req.body;

    // Validar campos requeridos
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'ID de oportunidad es requerido',
        error: 'MISSING_OPPORTUNITY_ID'
      });
    }

    // Preparar datos para actualización con valores por defecto
    const updateData = {
      pipe_step_name: pipe_step_name || 'LinkedIn Profile Visitor',
      probability: probability || 5,
      custom_fields: {
        source: "phantombuster",
        last_action,
        last_update: new Date().toISOString(),
        autoconnect_status: status || ''
      }
    };

    const result = await makeAxonautRequest(`/opportunities/${id}`, 'PATCH', updateData);

    // Registrar métrica
    metricsCollector.recordApiCall('axonaut', 'update_opportunity', 'success');

    logInfo('Oportunidad actualizada en Axonaut', {
      opportunityId: id,
      pipe_step_name: updateData.pipe_step_name,
      probability: updateData.probability
    });

    res.json({
      success: true,
      message: 'Oportunidad actualizada exitosamente en Axonaut',
      data: {
        id: result.id,
        pipe_step_name: result.pipe_step_name || updateData.pipe_step_name,
        probability: result.probability || updateData.probability,
        custom_fields: result.custom_fields || updateData.custom_fields
      }
    });

  } catch (error) {
    metricsCollector.recordApiCall('axonaut', 'update_opportunity', 'error');

    logError('Error actualizando oportunidad en Axonaut', {
      error: error.message,
      opportunityId: req.params.id,
      data: req.body
    });

    res.status(500).json({
      success: false,
      message: 'Error actualizando oportunidad en Axonaut',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/axonaut/companies/:id
 * Eliminar empresa en Axonaut
 */
router.delete('/companies/:id', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'ID de empresa es requerido',
        error: 'MISSING_COMPANY_ID'
      });
    }

    await makeAxonautRequest(`/companies/${id}`, 'DELETE');

    // Registrar métrica
    metricsCollector.recordApiCall('axonaut', 'delete_company', 'success');

    logInfo('Empresa eliminada en Axonaut', {
      companyId: id
    });

    res.json({
      success: true,
      message: 'Empresa eliminada exitosamente en Axonaut',
      data: {
        id: id
      }
    });

  } catch (error) {
    metricsCollector.recordApiCall('axonaut', 'delete_company', 'error');

    logError('Error eliminando empresa en Axonaut', {
      error: error.message,
      companyId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Error eliminando empresa en Axonaut',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/axonaut/test-connection
 * Probar conexión con Axonaut
 */
router.get('/test-connection', authenticateApiKey, async (req, res) => {
  try {
    // Intentar obtener la lista de empresas para probar la conexión
    await makeAxonautRequest('/companies', 'GET');

    logInfo('Conexión con Axonaut exitosa');

    res.json({
      success: true,
      message: 'Conexión con Axonaut exitosa',
      data: {
        status: 'connected',
        timestamp: new Date().toISOString(),
        api_key: AXONAUT_API_KEY ? 'configured' : 'missing'
      }
    });

  } catch (error) {
    logError('Error probando conexión con Axonaut', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Error conectando con Axonaut',
      error: error.message,
      data: {
        status: 'disconnected',
        timestamp: new Date().toISOString(),
        api_key: AXONAUT_API_KEY ? 'configured' : 'missing'
      }
    });
  }
});

module.exports = router;
