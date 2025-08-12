const authenticateApiKey = (req, res, next) => {
  const apiKey =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "");

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      message: "API key inválida o faltante",
      error: "UNAUTHORIZED",
    });
  }

  next();
};

module.exports = { authenticateApiKey };
