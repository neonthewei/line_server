# LINE Chatbot with Dify Integration

This is a Node.js application that integrates LINE Messaging API with Dify AI to create an intelligent chatbot.

## Prerequisites

- Node.js (v14 or higher)
- LINE Messaging API credentials
- Dify API credentials

## Setup

1. Clone this repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure environment variables:

   - Copy `.env.example` to `.env`
   - Fill in your credentials:
     - LINE_CHANNEL_SECRET: Your LINE Channel Secret
     - LINE_ACCESS_TOKEN: Your LINE Channel Access Token
     - DIFY_API_KEY: Your Dify API Key
     - DIFY_APP_ID: Your Dify Application ID

4. Start the server:

   ```bash
   node server.js
   ```

5. Set up LINE Webhook:
   - Go to LINE Developers Console
   - Set Webhook URL to your server URL + /webhook
     (e.g., https://your-domain.com/webhook)
   - Enable webhook

## Features

- Receives messages from LINE
- Processes messages through Dify AI
- Sends AI-generated responses back to LINE
- Includes signature verification for security
- Error handling and logging

## API Endpoints

- POST /webhook: LINE webhook endpoint
- GET /health: Health check endpoint

## Error Handling

The application includes error handling for:

- LINE API errors
- Dify API errors
- Invalid webhook signatures
- General server errors

## Deployment

You can deploy this application to any Node.js hosting platform like:

- Render
- Railway
- Heroku
- Google Cloud Run

Make sure to set up your environment variables on your hosting platform.
