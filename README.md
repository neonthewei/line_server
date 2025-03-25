# LINE Bot Server

A modular LINE bot server with Dify integration, Cloudinary for media handling, and OpenAI Transcription API for audio transcription.

## Project Structure

The project uses a modular architecture for better maintainability and separation of concerns:

```
.
├── app.js                      # Express app setup
├── config.js                   # Configuration settings and constants
├── controllers/                # API endpoint controllers
│   ├── adminController.js      # Admin operations
│   └── webhookController.js    # Webhook endpoint logic
├── middleware/                 # Express middleware
│   └── lineVerification.js     # LINE message signature verification
├── routes/                     # API routes
│   └── index.js                # Route definitions
├── services/                   # External API integrations
│   ├── cloudinaryService.js    # Cloudinary media handling
│   ├── difyService.js          # Dify API integration
│   ├── lineService.js          # LINE API integration
│   └── audioService.js         # OpenAI 語音轉文字 API integration
├── templates/                  # Message templates
│   ├── transaction_record.json         # Transaction record template
│   ├── tutorial_part1.json             # Tutorial part 1 template
│   ├── tutorial_part2.json             # Tutorial part 2 template
│   ├── expense_record.json             # Basic expense record template
│   ├── product_carousel.json           # Product carousel template
│   └── savings_jar.json                # Savings jar template
├── utils/                      # Utility functions
│   ├── difyMessageProcessor.js # Dify message processing
│   ├── flexMessage.js          # Flex Message creation
│   ├── messageProcessing.js    # Message processing utilities
│   └── tutorialMessage.js      # Tutorial message creation
├── server.js                   # Entry point
├── package.json                # Project metadata and dependencies
└── .env                        # Environment variables (not committed)
```

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with the following variables:
   ```
   PORT=3000
   LINE_CHANNEL_SECRET=your_line_channel_secret
   LINE_ACCESS_TOKEN=your_line_access_token
   ADMIN_USER_ID=your_admin_user_id
   DIFY_API_URL=your_dify_api_url
   DIFY_API_KEY=your_dify_api_key
   DIFY_APP_ID=your_dify_app_id
   LIFF_ID=your_liff_id
   CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
   CLOUDINARY_API_KEY=your_cloudinary_api_key
   CLOUDINARY_API_SECRET=your_cloudinary_api_secret
   OPENAI_API_KEY=your_openai_api_key
   ```
4. Start the server:
   ```
   npm start
   ```
   Or for development with auto-restart:
   ```
   npm run dev
   ```

## Features

- **LINE Integration**: Processes LINE webhook events and sends replies
- **Dify Integration**: Processes user messages with Dify AI
- **Media Handling**: Processes image and audio attachments
- **Audio Transcription**: Converts audio to text using OpenAI Transcription API
- **Flex Messages**: Creates interactive record cards for expenses/income
- **Admin Controls**: Special commands for administrators
- **Tutorial Support**: Provides in-app tutorials

## API Endpoints

- `POST /webhook`: LINE webhook endpoint
- `GET /health`: Health check endpoint

## Working with the Code

- To add new API endpoints, update `routes/index.js`
- To modify webhook logic, update `controllers/webhookController.js`
- To change how messages are processed, update the utilities in `utils/`
- For template changes, modify templates in the `templates/` directory
