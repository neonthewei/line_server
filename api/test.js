module.exports = async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Test API endpoint working!",
    timestamp: new Date().toISOString(),
  });
};
