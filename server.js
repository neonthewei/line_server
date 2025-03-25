require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const routes = require("./routes");
const { PORT } = require("./config");

// Ensure templates directory exists
const templatesDir = path.join(__dirname, "templates");
if (!fs.existsSync(templatesDir)) {
  console.log("Creating templates directory...");
  fs.mkdirSync(templatesDir, { recursive: true });
}

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Routes
app.use("/", routes);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
