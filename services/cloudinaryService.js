const cloudinary = require("cloudinary").v2;
const { CLOUDINARY_CONFIG } = require("../config");

// Configure Cloudinary with the settings from config
cloudinary.config(CLOUDINARY_CONFIG);

/**
 * Upload image to Cloudinary and get URL
 */
async function uploadImageToCloudinary(imageBuffer) {
  try {
    console.log("Uploading image to Cloudinary...");
    // Convert buffer to base64
    const base64Image = imageBuffer.toString("base64");

    // Upload to Cloudinary with public access settings
    const result = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${base64Image}`,
      {
        folder: "line-bot-uploads",
        resource_type: "auto",
        public_id: `line_image_${Date.now()}`, // 確保唯一的文件名
        access_mode: "public", // 確保公開訪問
        overwrite: true,
      }
    );

    console.log("Image uploaded to Cloudinary:", result.secure_url);
    return result.secure_url;
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    throw error;
  }
}

/**
 * Upload audio to Cloudinary and get URL
 */
async function uploadAudioToCloudinary(audioBuffer) {
  try {
    console.log("Uploading audio to Cloudinary...");
    // Convert buffer to base64
    const base64Audio = audioBuffer.toString("base64");

    // Upload to Cloudinary with public access settings
    // Use the correct audio/m4a MIME type
    const result = await cloudinary.uploader.upload(
      `data:audio/m4a;base64,${base64Audio}`,
      {
        folder: "line-bot-audio",
        resource_type: "auto",
        public_id: `line_audio_${Date.now()}`, // 確保唯一的文件名
        access_mode: "public", // 確保公開訪問
        overwrite: true,
      }
    );

    console.log("Audio uploaded to Cloudinary:", result.secure_url);
    return result.secure_url;
  } catch (error) {
    console.error("Error uploading audio to Cloudinary:", error);
    throw error;
  }
}

module.exports = {
  uploadImageToCloudinary,
  uploadAudioToCloudinary,
};
