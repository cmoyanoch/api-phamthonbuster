const authenticateApiKey = (req, res, next) => {
  const apiKey =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "");

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      message: "Clé API invalide ou manquante",
      error: "UNAUTHORIZED",
    });
  }

  next();
};

module.exports = { authenticateApiKey };
