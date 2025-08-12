function mapSimpleParams({ sectors, roles, countries, companySizes }) {
  const sectorMapping = {
    tech: "technology",
    finance: "financial-services",
    health: "hospital-health-care",
    education: "education-management",
    retail: "retail",
  };

  const roleMapping = {
    ceo: "Chief Executive Officer",
    cto: "Chief Technology Officer",
    operations: "Operations Manager",
    sales: "Sales Manager",
    manager: "Manager",
  };

  const countryMapping = {
    fr: "France",
    de: "Germany",
    es: "Spain",
    it: "Italy",
    nl: "Netherlands",
  };

  const sectorList = Array.isArray(sectors)
    ? sectors
    : sectors.split(",").map((s) => s.trim());
  const roleList = Array.isArray(roles)
    ? roles
    : roles.split(",").map((r) => r.trim());
  const countryList = Array.isArray(countries)
    ? countries
    : countries.split(",").map((c) => c.trim());
  const companySizeList = companySizes
    ? Array.isArray(companySizes)
      ? companySizes
      : companySizes.split(",").map((cs) => cs.trim())
    : [];

  const jobTitles = roleList
    .map((role) => roleMapping[role] || role)
    .join(" OR ");
  const locations = countryList
    .map((country) => countryMapping[country] || country)
    .join(" OR ");
  const industryCodes = sectorList.map(
    (sector) => sectorMapping[sector] || sector
  );

  return {
    job_title: jobTitles,
    location: locations,
    industry_codes: industryCodes,
    connection_degree: ["1", "2", "3+"],
    results_per_launch: 200,
    total_results: 200,
  };
}

function getLeadTypeFromDegree(degree) {
  const mapping = {
    1: "1st",
    2: "2nd",
    "3+": "3rd+",
    "1st": "1st",
    "2nd": "2nd",
    "3rd+": "3rd+",
  };
  return mapping[degree] || "3rd+";
}

function calculateDistributionByPriority(urls, totalProfiles = 1000) {
  const priorities = {
    "1st": { multiplier: 1.5, weight: 0.4 },
    "2nd": { multiplier: 1.2, weight: 0.35 },
    "3rd+": { multiplier: 1.0, weight: 0.25 },
  };

  const distribution = {};
  let remainingProfiles = totalProfiles;

  Object.keys(priorities).forEach((priority) => {
    const priorityUrls = urls.filter((url) => {
      const degree = extractConnectionDegreeFromUrl(url);
      return getLeadTypeFromDegree(degree) === priority;
    });

    const allocatedProfiles = Math.floor(
      totalProfiles *
        priorities[priority].weight *
        priorities[priority].multiplier
    );
    distribution[priority] = {
      urls: priorityUrls,
      allocatedProfiles: Math.min(allocatedProfiles, priorityUrls.length),
      multiplier: priorities[priority].multiplier,
    };

    remainingProfiles -= distribution[priority].allocatedProfiles;
  });

  return distribution;
}

function extractConnectionDegreeFromUrl(url) {
  // Implementación simplificada - en producción usaría análisis más complejo
  if (url.includes("1st")) return "1st";
  if (url.includes("2nd")) return "2nd";
  return "3rd+";
}

module.exports = {
  mapSimpleParams,
  getLeadTypeFromDegree,
  calculateDistributionByPriority,
  extractConnectionDegreeFromUrl,
};
